// src/lib/automations/ghl-reengagement/runner.ts
// Phase 32 (v1.9): GHL Lost-Lead Reengagement SMS Runner.
// Pure orchestration: pre-flight → list → JS date guard → anti-loop bulk skip →
// per-contact claim-first INSERT → sendSmsViaGhl → on success logAction(success);
// on failure DELETE claim + logAction(error). Promise.allSettled for the batch.
// Env-agnostic: caller (Plan 04 route) parses env and injects RunnerConfig.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { GhlCredentials } from '@/lib/ghl/client'
import { listOpportunities, type GhlOpportunity } from '@/lib/ghl/list-opportunities'
import { renderMessage } from './render-template'
import { sendSmsViaGhl } from '@/lib/ghl/send-sms'
import { logAction } from '@/lib/action-engine/log-action'
import { decrypt } from '@/lib/crypto'

export interface RunnerConfig {
  integrationId: string
  locationId: string
  messageTemplate: string
  thresholdDays: number
  batchLimit: number
  fromNumberOverride?: string
  runStartedAtIso?: string
}

export interface RunnerError {
  ghl_contact_id: string
  message: string
}

export interface RunnerResult {
  processed: number
  sent: number
  skipped: number
  failed: number
  errors: RunnerError[]
}

const TOOL_NAME = 'ghl_reengagement_sms'
const BODY_LOG_TRUNCATE = 40

interface IntegrationRow {
  id: string
  organization_id: string
  provider: string | null
  is_active: boolean | null
  encrypted_api_key: string
}

function opportunityTimestamp(opp: GhlOpportunity): number | null {
  const raw = opp.updatedAt ?? opp.statusChangeDate
  if (!raw) return null
  const t = Date.parse(raw)
  return Number.isFinite(t) ? t : null
}

export async function runReengagement(
  cfg: RunnerConfig,
  supabase: SupabaseClient<Database>,
): Promise<RunnerResult> {
  const runStartedAtIso = cfg.runStartedAtIso ?? new Date().toISOString()
  const vapiCallId = `cron:ghl-reengagement:${runStartedAtIso}`

  // ---- 1. Pre-flight: load + assert the GHL integration row (D-32-04) ----
  const { data: integrationRow, error: integrationErr } = await supabase
    .from('integrations')
    .select('id, organization_id, provider, is_active, encrypted_api_key')
    .eq('id', cfg.integrationId)
    .single()
  if (integrationErr || !integrationRow) {
    throw new Error(
      `GHL integration not found for id=${cfg.integrationId} (check GHL_REENGAGEMENT_INTEGRATION_ID)`,
    )
  }
  const row = integrationRow as unknown as IntegrationRow
  if (row.provider !== 'gohighlevel') {
    throw new Error(
      `GHL integration provider mismatch: expected 'gohighlevel', got '${row.provider}'`,
    )
  }
  if (row.is_active !== true) {
    throw new Error(`GHL integration is inactive for id=${cfg.integrationId}`)
  }

  const apiKey = await decrypt(row.encrypted_api_key)
  const ghlCredentials: GhlCredentials = {
    apiKey,
    locationId: cfg.locationId,
  }
  const orgId = row.organization_id

  // ---- 2. List Lost opportunities older than threshold ----
  const thresholdCutoff = new Date(
    Date.now() - cfg.thresholdDays * 24 * 60 * 60 * 1000,
  )
  const opportunities = await listOpportunities(ghlCredentials, {
    status: 'lost',
    updatedBefore: thresholdCutoff,
    // GHL page size — independent of cfg.batchLimit (which caps NEW dispatches per run).
    // Always page-max; the slice on `toDispatch` further down enforces batchLimit.
    limit: 100,
  })

  // ---- 3. JS-side date guard (Pitfall 1 — defense in depth) ----
  const cutoffMs = thresholdCutoff.getTime()
  const dateFiltered = opportunities.filter(opp => {
    const t = opportunityTimestamp(opp)
    return t !== null && t < cutoffMs
  })

  const processed = dateFiltered.length
  if (processed === 0) {
    return { processed: 0, sent: 0, skipped: 0, failed: 0, errors: [] }
  }

  // ---- 4. Bulk anti-loop pre-filter (one SELECT, not N) ----
  const ghlContactIds = dateFiltered.map(o => o.contact.id)
  const { data: already } = await supabase
    .from('ghl_reengagement_sent')
    .select('ghl_contact_id')
    .eq('org_id', orgId)
    .in('ghl_contact_id', ghlContactIds)
  const alreadySet = new Set((already ?? []).map(r => r.ghl_contact_id))

  // ---- 5. Split into already-skipped vs to-dispatch ----
  let skippedAntiLoop = 0
  const toDispatch: GhlOpportunity[] = []
  for (const opp of dateFiltered) {
    if (alreadySet.has(opp.contact.id)) {
      skippedAntiLoop++
      continue
    }
    toDispatch.push(opp)
  }

  // ---- 6. Enforce batchLimit on actual dispatches ----
  const batch = toDispatch.slice(0, cfg.batchLimit)

  // ---- 7. Per-contact dispatch with claim-first (D-32-10) + Promise.allSettled ----
  let sent = 0
  let failed = 0
  let skippedConflict = 0
  const errors: RunnerError[] = []

  await Promise.allSettled(
    batch.map(async opp => {
      const startMs = Date.now()
      const contactId = opp.contact.id

      // ---- Claim BEFORE send (D-32-10) ----
      let claimedRowId: string | null = null
      let claimConflict = false
      try {
        const { data: claim, error: claimErr } = await supabase
          .from('ghl_reengagement_sent')
          .insert({
            org_id: orgId,
            location_id: cfg.locationId,
            ghl_contact_id: contactId,
          })
          .select('id')
          .single()
        if (claimErr) {
          claimConflict = true
        } else {
          claimedRowId = (claim as { id: string } | null)?.id ?? null
        }
      } catch {
        claimConflict = true
      }

      if (claimConflict || !claimedRowId) {
        skippedConflict++
        return
      }

      // ---- Render + dispatch via GHL Conversations API (D-32-02) ----
      const rendered = renderMessage(cfg.messageTemplate, opp.contact.firstName)
      const truncatedBody = rendered.substring(0, BODY_LOG_TRUNCATE)
      const baseRequestPayload: Record<string, unknown> = {
        ghl_contact_id: contactId,
        body: truncatedBody,
      }

      const smsParams: Record<string, unknown> = {
        contactId,
        body: rendered,
      }
      if (cfg.fromNumberOverride) {
        smsParams.fromNumber = cfg.fromNumberOverride
      }

      try {
        const result = await sendSmsViaGhl(smsParams, ghlCredentials)
        const elapsed = Date.now() - startMs
        sent++
        await logAction(
          {
            organization_id: orgId,
            tool_config_id: null,
            vapi_call_id: vapiCallId,
            tool_name: TOOL_NAME,
            status: 'success',
            execution_ms: elapsed,
            request_payload: baseRequestPayload as Json,
            response_payload: { result } as Json,
            error_detail: null,
          },
          supabase,
        )
      } catch (err) {
        const elapsed = Date.now() - startMs
        const message = err instanceof Error ? err.message : String(err)
        failed++
        errors.push({ ghl_contact_id: contactId, message })
        // ---- Rollback the claim (D-32-10) ----
        await supabase
          .from('ghl_reengagement_sent')
          .delete()
          .eq('org_id', orgId)
          .eq('ghl_contact_id', contactId)
        await logAction(
          {
            organization_id: orgId,
            tool_config_id: null,
            vapi_call_id: vapiCallId,
            tool_name: TOOL_NAME,
            status: 'error',
            execution_ms: elapsed,
            request_payload: baseRequestPayload as Json,
            response_payload: {} as Json,
            error_detail: message,
          },
          supabase,
        )
      }
    }),
  )

  const skipped = skippedAntiLoop + skippedConflict

  return { processed, sent, skipped, failed, errors }
}

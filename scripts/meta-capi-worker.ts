#!/usr/bin/env tsx
// scripts/meta-capi-worker.ts
// Drains the Meta Conversions API outbox (meta_capi_events). Runs frequently
// (GitHub Actions every 5 min, or Hetzner crontab — not both). Idempotent:
// Meta dedups by event_id, so re-sending after a crash is safe.
//
// Usage (from repo root):
//   tsx scripts/meta-capi-worker.ts
//   tsx scripts/meta-capi-worker.ts --org <org-id>
//   tsx scripts/meta-capi-worker.ts --test       # send with test_event_code
//   tsx scripts/meta-capi-worker.ts --dry-run    # log, do not POST
//
// Required env vars:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//   ENCRYPTION_SECRET            (to decrypt stored tokens)
//   META_SYSTEM_USER_TOKEN       (fallback token when no per-org token stored)

import { createClient } from '@supabase/supabase-js'
import type { Database } from '../src/types/database'
import { decrypt } from '../src/lib/crypto'
import { sendCapiEvents, type CapiEvent } from '../src/lib/meta/capi'

const args = process.argv.slice(2)
const DRY_RUN = args.includes('--dry-run')
const TEST = args.includes('--test')
const SINGLE_ORG = args.includes('--org') ? args[args.indexOf('--org') + 1] : null

const BATCH = 200            // rows pulled per run
const MAX_ATTEMPTS = 8       // dead-letter threshold
const BASE_BACKOFF_S = 60    // 1m, 2m, 4m, ... capped
const MAX_BACKOFF_S = 6 * 60 * 60

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient<Database>(url, key, { auth: { persistSession: false } }) as any
}

interface OrgTarget {
  datasetId: string | null
  token: string | null
  testEventCode: string | null
}

// Resolve the dataset + token for an org once per run.
async function resolveOrgTarget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
): Promise<OrgTarget> {
  const { data: config } = await supabase
    .from('meta_capi_config')
    .select('dataset_id, encrypted_capi_token, test_event_code, enabled, meta_ad_account_id')
    .eq('org_id', orgId)
    .maybeSingle()

  if (!config || !config.enabled || !config.dataset_id) {
    return { datasetId: null, token: null, testEventCode: null }
  }

  let token: string | null = null
  if (config.encrypted_capi_token) {
    try { token = await decrypt(config.encrypted_capi_token) } catch { token = null }
  }
  if (!token) {
    // Fall back to the org's active Meta ads connection token.
    const { data: conn } = await supabase
      .from('ads_connections')
      .select('encrypted_access_token')
      .eq('org_id', orgId)
      .eq('platform', 'meta')
      .eq('status', 'active')
      .maybeSingle()
    if (conn?.encrypted_access_token) {
      try { token = await decrypt(conn.encrypted_access_token) } catch { token = null }
    }
  }
  if (!token) token = process.env.META_SYSTEM_USER_TOKEN ?? null

  return {
    datasetId: config.dataset_id,
    token,
    testEventCode: TEST ? (config.test_event_code ?? null) : null,
  }
}

function backoffSeconds(attempts: number): number {
  return Math.min(BASE_BACKOFF_S * 2 ** attempts, MAX_BACKOFF_S)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toCapiEvent(row: any): CapiEvent {
  const payload = row.payload ?? {}
  return {
    event_name: row.event_name,
    event_id: row.event_id,
    event_time: Math.floor(new Date(row.event_time).getTime() / 1000),
    action_source: row.action_source,
    event_source_url: payload.event_source_url,
    user_data: payload.user_data ?? {},
    custom_data: payload.custom_data,
  }
}

async function main() {
  const supabase = getSupabase()
  console.log(`[meta-capi-worker] ${DRY_RUN ? 'DRY-RUN ' : ''}${TEST ? 'TEST ' : ''}start ${new Date().toISOString()}`)

  let query = supabase
    .from('meta_capi_events')
    .select('id, org_id, event_name, event_id, event_time, action_source, payload, attempts')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', new Date().toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(BATCH)

  if (SINGLE_ORG) query = query.eq('org_id', SINGLE_ORG)

  const { data: rows, error } = await query
  if (error) {
    console.error('[meta-capi-worker] load error:', error.message)
    process.exit(1)
  }
  if (!rows || rows.length === 0) {
    console.log('[meta-capi-worker] nothing due')
    return
  }

  const targets = new Map<string, OrgTarget>()
  const stats = { sent: 0, failed: 0, dead: 0, skipped: 0 }

  for (const row of rows) {
    if (!targets.has(row.org_id)) targets.set(row.org_id, await resolveOrgTarget(supabase, row.org_id))
    const target = targets.get(row.org_id)!

    // Misconfigured / disabled org → leave pending, don't burn attempts.
    if (!target.datasetId || !target.token) {
      stats.skipped++
      continue
    }

    if (DRY_RUN) {
      console.log(`  [${row.org_id}] would send ${row.event_name} (${row.event_id})`)
      stats.sent++
      continue
    }

    try {
      const result = await sendCapiEvents(target.datasetId, target.token, [toCapiEvent(row)], {
        testEventCode: target.testEventCode,
      })
      await supabase
        .from('meta_capi_events')
        .update({ status: 'sent', sent_at: new Date().toISOString(), fb_trace_id: result.fbtrace_id, last_error: null })
        .eq('id', row.id)
      stats.sent++
    } catch (err) {
      const attempts = (row.attempts ?? 0) + 1
      const dead = attempts >= MAX_ATTEMPTS
      const next = new Date(Date.now() + backoffSeconds(attempts) * 1000).toISOString()
      await supabase
        .from('meta_capi_events')
        .update({
          status: dead ? 'dead' : 'failed',
          attempts,
          next_attempt_at: next,
          last_error: err instanceof Error ? err.message : String(err),
        })
        .eq('id', row.id)
      if (dead) stats.dead++; else stats.failed++
      console.error(`  [${row.org_id}] ${row.event_name} failed (attempt ${attempts}):`, err instanceof Error ? err.message : err)
    }
  }

  console.log(`[meta-capi-worker] done — sent=${stats.sent} failed=${stats.failed} dead=${stats.dead} skipped=${stats.skipped}`)
}

main().catch((err) => {
  console.error('[meta-capi-worker] fatal:', err)
  process.exit(1)
})

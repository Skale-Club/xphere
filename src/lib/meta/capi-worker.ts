// Drains the Meta Conversions API outbox (meta_capi_events).
// Moved here from scripts/meta-capi-worker.ts so the in-app cron route
// (/api/cron/meta-capi-worker) and the dev script share one implementation.
// Idempotent: Meta dedups by event_id, so re-sending after a crash is safe.

import { decrypt } from '@/lib/crypto'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { sendCapiEvents, type CapiEvent, type SendResult } from '@/lib/meta/capi'

export const CAPI_BATCH = 200            // rows pulled per run
export const CAPI_MAX_ATTEMPTS = 8       // dead-letter threshold
const BASE_BACKOFF_S = 60                // 1m, 2m, 4m, ... capped
const MAX_BACKOFF_S = 6 * 60 * 60
/** Default wall-clock budget. Requests pass Cloudflare, which cuts at 100s. */
export const CAPI_DEFAULT_BUDGET_MS = 60_000

export interface CapiDrainOptions {
  orgId?: string | null
  /** Send with each org's test_event_code. */
  test?: boolean
  /** Log, do not POST to Meta and do not touch rows. */
  dryRun?: boolean
  /** Stop starting new sends after this many ms (default 60s). */
  budgetMs?: number
  // --- injection points (tests) ---
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase?: any
  send?: (
    datasetId: string,
    token: string,
    events: CapiEvent[],
    opts: { testEventCode?: string | null },
  ) => Promise<SendResult>
  decryptToken?: (encrypted: string) => Promise<string>
  now?: () => number
  log?: (line: string) => void
}

/** Counts only, no customer data. */
export interface CapiDrainReport {
  /** Rows pulled this run (<= 200). */
  due: number
  sent: number
  failed: number
  dead: number
  /** Org disabled / no dataset / no token: left pending, no attempt burned. */
  skipped: number
  /** Rows pulled but not attempted because the time budget ran out. */
  deferred: number
  timedOut: boolean
  dryRun: boolean
}

interface OrgTarget {
  datasetId: string | null
  token: string | null
  testEventCode: string | null
}

function backoffSeconds(attempts: number): number {
  return Math.min(BASE_BACKOFF_S * 2 ** attempts, MAX_BACKOFF_S)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function toCapiEvent(row: any): CapiEvent {
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

// Resolve the dataset + token for an org once per run.
async function resolveOrgTarget(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  orgId: string,
  test: boolean,
  decryptToken: (encrypted: string) => Promise<string>,
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
    try { token = await decryptToken(config.encrypted_capi_token) } catch { token = null }
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
      try { token = await decryptToken(conn.encrypted_access_token) } catch { token = null }
    }
  }
  if (!token) token = process.env.META_SYSTEM_USER_TOKEN ?? null

  return {
    datasetId: config.dataset_id,
    token,
    testEventCode: test ? (config.test_event_code ?? null) : null,
  }
}

export async function runCapiDrain(options: CapiDrainOptions = {}): Promise<CapiDrainReport> {
  const dryRun = options.dryRun === true
  const test = options.test === true
  const budgetMs = options.budgetMs ?? CAPI_DEFAULT_BUDGET_MS
  const now = options.now ?? Date.now
  const log = options.log ?? ((line: string) => console.log(line))
  const send = options.send ?? sendCapiEvents
  const decryptToken = options.decryptToken ?? decrypt
  const supabase = options.supabase ?? createServiceRoleClient()

  const startedAt = now()
  log(`[meta-capi-worker] ${dryRun ? 'DRY-RUN ' : ''}${test ? 'TEST ' : ''}start ${new Date(startedAt).toISOString()}`)

  const report: CapiDrainReport = {
    due: 0, sent: 0, failed: 0, dead: 0, skipped: 0, deferred: 0, timedOut: false, dryRun,
  }

  let query = supabase
    .from('meta_capi_events')
    .select('id, org_id, event_name, event_id, event_time, action_source, payload, attempts')
    .in('status', ['pending', 'failed'])
    .lte('next_attempt_at', new Date(startedAt).toISOString())
    .order('next_attempt_at', { ascending: true })
    .limit(CAPI_BATCH)

  if (options.orgId) query = query.eq('org_id', options.orgId)

  const { data: rows, error } = await query
  if (error) {
    console.error('[meta-capi-worker] load error:', error.message)
    throw new Error('Could not load the Meta CAPI outbox')
  }
  if (!rows || rows.length === 0) {
    log('[meta-capi-worker] nothing due')
    return report
  }
  report.due = rows.length

  const targets = new Map<string, OrgTarget>()

  for (let i = 0; i < rows.length; i++) {
    // Stop before starting a new send once the budget is spent. Unattempted rows
    // stay pending/failed with next_attempt_at in the past, so the next tick
    // (oldest first) picks them up.
    if (now() - startedAt >= budgetMs) {
      report.timedOut = true
      report.deferred = rows.length - i
      break
    }
    const row = rows[i]

    if (!targets.has(row.org_id)) {
      targets.set(row.org_id, await resolveOrgTarget(supabase, row.org_id, test, decryptToken))
    }
    const target = targets.get(row.org_id)!

    // Misconfigured / disabled org -> leave pending, don't burn attempts.
    if (!target.datasetId || !target.token) {
      report.skipped++
      continue
    }

    if (dryRun) {
      log(`  [${row.org_id}] would send ${row.event_name} (${row.event_id})`)
      report.sent++
      continue
    }

    try {
      const result = await send(target.datasetId, target.token, [toCapiEvent(row)], {
        testEventCode: target.testEventCode,
      })
      await supabase
        .from('meta_capi_events')
        .update({ status: 'sent', sent_at: new Date(now()).toISOString(), fb_trace_id: result.fbtrace_id, last_error: null })
        .eq('id', row.id)
      report.sent++
    } catch (err) {
      const attempts = (row.attempts ?? 0) + 1
      const dead = attempts >= CAPI_MAX_ATTEMPTS
      const next = new Date(now() + backoffSeconds(attempts) * 1000).toISOString()
      await supabase
        .from('meta_capi_events')
        .update({
          status: dead ? 'dead' : 'failed',
          attempts,
          next_attempt_at: next,
          last_error: err instanceof Error ? err.message : String(err),
        })
        .eq('id', row.id)
      if (dead) report.dead++; else report.failed++
      console.error(`  [${row.org_id}] ${row.event_name} failed (attempt ${attempts}):`, err instanceof Error ? err.message : err)
    }
  }

  log(
    `[meta-capi-worker] done - sent=${report.sent} failed=${report.failed} dead=${report.dead} ` +
    `skipped=${report.skipped} deferred=${report.deferred}`,
  )
  return report
}

// src/app/api/cron/prospect-verify-tick/route.ts
//
// Problem this closes: the daily prospecting engine (Xmail's cron -> Xcraper)
// creates ~30-60 new prospects/day with an email, but NOTHING calls email
// verification automatically. `prospects_verify` (src/lib/mcp/tools/
// prospects.ts) does the real work — it already exists and already notifies
// Xmail — but it only runs when the Hermes agent is dispatched with MCP
// access, and Hermes has had no MCP access since 2026-08-30. Measured on
// 2026-09-30: 27 Xmail runs, 1044 prospect_rows, 219 with an email, 121 of
// those NEVER verified. This tick is the missing trigger.
//
// It does NOT reimplement verification. It reuses the exact same engine
// (`verifyProspectsBatch`) and the exact same Xmail notification call
// (`xmailNotifyVerificationComplete`) that `prospects_verify` uses — see
// docs/prospects-integrations.md#email-verification. This file only adds:
// discovery (which prospects need checking, across every org, not just one),
// grouping by originating external run (so Xmail still gets one notification
// per run, exactly like a manual `prospects_verify` call would produce), and
// two safety rails a human would otherwise have to apply by hand.
//
// ── Auto-import of the verified 'ok' ones (Item 1, 2026-09-30) ─────────────
// Before this, verification and import were two separate manual steps —
// `prospects_verify` (or this tick) would leave freshly-verified
// email_status='ok' prospects sitting in Xphere until a human ran
// `prospects_import_to_xmail` by hand. After each run group is verified and
// Xmail is notified below, this tick also calls
// `importVerifiedProspectsToXmail` (src/lib/mcp/tools/prospects.ts) for that
// same external_run_id — the exact same function `prospects_import_to_xmail`
// itself calls, so the rules are identical: only email_status='ok' is ever
// imported, catch_all/unknown/unverified/invalid are retained for a human,
// and nothing is ever enrolled in a campaign or activated. Gated by the same
// PROSPECTING_AUTO_VERIFY flag as the rest of this tick — disabled means no
// verification AND no import, not one without the other. Import failures
// are logged and reported per-run but never abort the tick (the verification
// + notification for that run already succeeded and stands on its own).
//
// ── OFF BY DEFAULT (this is deliberate) ─────────────────────────────────────
// This is the first automation in the codebase that can spend real money
// (MillionVerifier/NeverBounce credits) with nobody in the loop. It does
// NOTHING unless `PROSPECTING_AUTO_VERIFY=1` is set — no DB write, no
// provider call, not even the discovery query runs. The owner opts in
// explicitly; this tick never does so on its own.
//
// ── Daily spend cap ──────────────────────────────────────────────────────
// `PROSPECTING_AUTO_VERIFY_MAX_PER_DAY` (default 100, see DEFAULT_MAX_PER_DAY
// below for where that number comes from). Before verifying anything, this
// counts how many contacts+accounts (ANY org, ANY trigger — see the comment
// on countVerifiedToday) already have `email_verified_at` today and only
// spends the remainder. No new table: the existing `email_verified_at`
// column IS the ledger, because every verification path (this tick,
// `prospects_verify`, `prospect_send_message`) writes it through the same
// `verifyProspectEmail` (src/lib/email-verification/verify.ts).
//
// ── Credit balance visibility ───────────────────────────────────────────
// Xphere has never persisted the provider credit balance anywhere (see
// src/lib/email-verification/credits.ts's own comment: it is always read
// live). This tick keeps that contract — no new table — and instead returns
// the balance in its JSON response and logs it every run, so an alert can be
// built on top of the log/response without touching Hermes.
//
// ── No credits ───────────────────────────────────────────────────────────
// If neither provider has a usable balance, this tick stops before touching
// any prospect and says so loudly (`stopped_reason: 'no_credits'`, an
// error-level log line, and a captured Sentry event) — never a silent no-op.
// If credits run out PARTWAY through a run's batch (verifyProspectsBatch
// reports `aggregate.blocked > 0`), it stops picking up further runs for the
// rest of THIS invocation for the same reason, but still notifies Xmail for
// the run that was in flight (the blocked count itself is real, useful data).
//
// Auth: Authorization: Bearer $CRON_SECRET, fail-closed — this spends money,
// same posture as /api/cron/campaign-tick and /api/cron/ads-tick.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  verifyProspectsBatch,
  type BatchAggregate,
  type ProspectKind,
} from '@/lib/email-verification/verify'
import { getMillionVerifierCredits, getVerificationCreditStatus, type VerificationCreditStatus } from '@/lib/email-verification/credits'
import { isXmailConfigured, xmailNotifyVerificationComplete } from '@/lib/xmail/client'
import {
  emailFromCustomFields,
  verifyOutputCounts,
  resolveVerificationProvider,
  importVerifiedProspectsToXmail,
} from '@/lib/mcp/tools/prospects'
import { captureApiError } from '@/lib/api-error'
import { createLogger } from '@/lib/obs/logger'

const CRON_SECRET = process.env.CRON_SECRET

// Measured 2026-09-30 (see file header): daily new-prospect-with-email volume
// is ~30-60/day, and MillionVerifier costs $0.0037/credit (1 credit/check).
// 100/day clears a full day of new volume with ~2x headroom to also chip
// away at the 121-prospect backlog over a few days, while capping worst-case
// spend at 100 * $0.0037 = $0.37/day — deliberately conservative because this
// is the first mechanism in the codebase allowed to spend money unattended.
// Raise via PROSPECTING_AUTO_VERIFY_MAX_PER_DAY once the real pattern is
// observed; recalibrate the same way TELEGRAM-ALERTS.md's error-spike
// threshold was — from measured data, not a guess.
const DEFAULT_MAX_PER_DAY = 100

// Independent of the daily cap: no single invocation processes more than this
// many prospects, mirroring VERIFY_HARD_MAX in src/lib/mcp/tools/prospects.ts.
// Guards against a misconfigured PROSPECTING_AUTO_VERIFY_MAX_PER_DAY (or a
// large backlog on first enable) turning one tick into an unbounded batch.
const HARD_MAX_PER_TICK = 500

function isEnabled(): boolean {
  return process.env.PROSPECTING_AUTO_VERIFY === '1'
}

function maxPerDay(): number {
  const raw = process.env.PROSPECTING_AUTO_VERIFY_MAX_PER_DAY
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : DEFAULT_MAX_PER_DAY
}

function todayStartUtcIso(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(): any {
  return createServiceRoleClient()
}

/**
 * How many contacts+accounts (every org) already got `email_verified_at`
 * stamped today. Deliberately NOT scoped to "verified by this cron" — there
 * is no column recording who triggered a verification, and adding one would
 * be a schema change (out of scope; see file header). Every verification
 * path (this tick, `prospects_verify`, `prospect_send_message`) updates the
 * same column through the same `verifyProspectEmail`, and the daily cap is a
 * spend cap on the shared MillionVerifier/NeverBounce balance, not a
 * per-caller quota — so counting ALL of today's stamps, not just this tick's,
 * is the more correct reading of "don't spend more than $X worth today," and
 * it only ever makes this tick MORE conservative (it never under-counts
 * someone else's spend and over-spends as a result).
 */
async function countVerifiedToday(sinceIso: string): Promise<number> {
  const [contacts, accounts] = await Promise.all([
    db().from('contacts').select('id', { count: 'exact', head: true }).gte('email_verified_at', sinceIso),
    db().from('accounts').select('id', { count: 'exact', head: true }).gte('email_verified_at', sinceIso),
  ])
  return (contacts.count ?? 0) + (accounts.count ?? 0)
}

interface Candidate {
  kind: ProspectKind
  id: string
  orgId: string
  email: string
  createdAt: string
  prospectSourceId: string
}

/**
 * Up to `limit` prospects (contacts + accounts, any org) with a usable email,
 * never verified (`email_status IS NULL` — "unknown" is a real prior result
 * and is left alone here; it already got a provider answer, just an
 * inconclusive one), and linked to a `prospect_sources` row via
 * `prospect_source_id` (migration 1298) — unlinked rows can never be
 * attributed to an external run, so `groupByExternalRun` would only have to
 * drop them again. Oldest first, same ordering `prospects_verify`'s
 * `loadVerifiableProspects` uses.
 */
async function loadCandidates(limit: number): Promise<Candidate[]> {
  if (limit <= 0) return []
  const [{ data: contactRows }, { data: accountRows }] = await Promise.all([
    db()
      .from('contacts')
      .select('id, org_id, email, created_at, prospect_source_id')
      .eq('lifecycle_stage', 'prospect')
      .is('email_status', null)
      .not('email', 'is', null)
      .not('prospect_source_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(limit),
    db()
      .from('accounts')
      .select('id, org_id, custom_fields, created_at, prospect_source_id')
      .eq('lifecycle_stage', 'prospect')
      .is('email_status', null)
      .not('prospect_source_id', 'is', null)
      .order('created_at', { ascending: true })
      .limit(limit),
  ])

  const out: Candidate[] = []
  for (const row of (contactRows ?? []) as Array<{
    id: string
    org_id: string
    email: string | null
    created_at: string
    prospect_source_id: string
  }>) {
    if (row.email) {
      out.push({ kind: 'contact', id: row.id, orgId: row.org_id, email: row.email, createdAt: row.created_at, prospectSourceId: row.prospect_source_id })
    }
  }
  for (const row of (accountRows ?? []) as Array<{
    id: string
    org_id: string
    custom_fields: unknown
    created_at: string
    prospect_source_id: string
  }>) {
    const email = emailFromCustomFields(row.custom_fields)
    if (email) {
      out.push({ kind: 'account', id: row.id, orgId: row.org_id, email, createdAt: row.created_at, prospectSourceId: row.prospect_source_id })
    }
  }

  out.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  return out.slice(0, limit)
}

/**
 * Prospects with an email but no `prospect_source_id` at all (pre-migration
 * 1298 rows, or a non-xcraper import) — never fetched by `loadCandidates`, so
 * they'd otherwise vanish from this tick's output with no trace. Counted
 * here purely for visibility in the response/log; never processed — there is
 * no run to attribute them to.
 */
async function countUnlinkable(): Promise<number> {
  const [contacts, accounts] = await Promise.all([
    db()
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('lifecycle_stage', 'prospect')
      .is('email_status', null)
      .not('email', 'is', null)
      .is('prospect_source_id', null),
    db()
      .from('accounts')
      .select('id', { count: 'exact', head: true })
      .eq('lifecycle_stage', 'prospect')
      .is('email_status', null)
      .is('prospect_source_id', null),
  ])
  return (contacts.count ?? 0) + (accounts.count ?? 0)
}

interface RunGroup {
  externalRunId: string
  orgId: string
  candidates: Candidate[]
}

/**
 * Groups candidates by their originating external run, resolved through
 * `prospect_sources.external_run_id` — the same indirection
 * `prospects_verify`'s `loadVerifiableProspects` and
 * src/lib/xmail/source-runs.ts use, just batched across every distinct
 * `prospect_source_id` in this candidate set instead of one run at a time.
 * A candidate whose source row is missing, or whose `external_run_id` is
 * null/blank, is dropped (counted in `skippedNoExternalRun`) — same rule as
 * source-runs.ts: an attribution that can never match on the Xmail side is
 * worse than an absent one.
 */
async function groupByExternalRun(
  candidates: Candidate[],
  log: ReturnType<typeof createLogger>,
): Promise<{ groups: RunGroup[]; skippedNoExternalRun: number }> {
  if (candidates.length === 0) return { groups: [], skippedNoExternalRun: 0 }

  const sourceIds = [...new Set(candidates.map((c) => c.prospectSourceId))]
  const { data: sourceRows } = await db().from('prospect_sources').select('id, org_id, external_run_id').in('id', sourceIds)
  const sourceById = new Map<string, { orgId: string; externalRunId: string | null }>()
  for (const row of (sourceRows ?? []) as Array<{ id: string; org_id: string; external_run_id: string | null }>) {
    sourceById.set(row.id, { orgId: row.org_id, externalRunId: row.external_run_id })
  }

  const byRun = new Map<string, RunGroup>()
  let skipped = 0
  for (const candidate of candidates) {
    const source = sourceById.get(candidate.prospectSourceId)
    const externalRunId = source?.externalRunId?.trim()
    if (!source || !externalRunId) {
      skipped++
      continue
    }
    let group = byRun.get(externalRunId)
    if (!group) {
      group = { externalRunId, orgId: source.orgId, candidates: [] }
      byRun.set(externalRunId, group)
    } else if (group.orgId !== source.orgId) {
      // Defensive only — an external_run_id is expected to belong to exactly
      // one org. If two orgs' sources ever collide on the same value, keep
      // the group's original org and drop this candidate rather than mixing
      // orgs into one verifyProspectsBatch call.
      skipped++
      log.warn('prospect_verify_tick_org_mismatch_in_run', {
        externalRunId,
        groupOrgId: group.orgId,
        candidateOrgId: source.orgId,
        candidateId: candidate.id,
      })
      continue
    }
    group.candidates.push(candidate)
  }

  // Oldest run first (by its earliest candidate) — Map insertion order
  // already guarantees this since `candidates` was pre-sorted, but sorting
  // explicitly documents the ordering instead of relying on that guarantee.
  const groups = [...byRun.values()].sort((a, b) => a.candidates[0].createdAt.localeCompare(b.candidates[0].createdAt))
  return { groups, skippedNoExternalRun: skipped }
}

export async function GET(request: Request): Promise<Response> {
  // Fail CLOSED, not open: this endpoint can spend real money once enabled,
  // same posture as /api/cron/campaign-tick and /api/cron/ads-tick.
  if (!CRON_SECRET) {
    return Response.json({ ok: false, error: 'CRON_SECRET not configured' }, { status: 503 })
  }
  const auth = request.headers.get('authorization') ?? ''
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
  }

  const log = createLogger({ route: 'api/cron/prospect-verify-tick' })

  if (!isEnabled()) {
    // Deliberately returns before any DB/provider call — "disabled" must
    // cost nothing, not even a query.
    return Response.json({
      ok: true,
      enabled: false,
      ran: false,
      message: 'PROSPECTING_AUTO_VERIFY is not "1" — auto-verification stays off. No query, no provider call, no spend.',
    })
  }

  const perDayCap = maxPerDay()
  const sinceIso = todayStartUtcIso()

  let verifiedToday: number
  try {
    verifiedToday = await countVerifiedToday(sinceIso)
  } catch (err) {
    log.error('prospect_verify_tick_count_failed', { error: err })
    captureApiError(err)
    return Response.json({ ok: false, error: 'Failed to read today\'s verification count.' }, { status: 500 })
  }

  const remainingBudget = Math.max(0, perDayCap - verifiedToday)
  if (remainingBudget <= 0) {
    log.warn('prospect_verify_tick_budget_exhausted', { perDayCap, verifiedToday })
    return Response.json({
      ok: true,
      enabled: true,
      ran: false,
      stopped_reason: 'daily_cap_reached',
      max_per_day: perDayCap,
      verified_today: verifiedToday,
      message: `Daily verification cap (${perDayCap}) already reached today (${verifiedToday} verified across the system) — waiting for the next UTC day.`,
    })
  }

  let creditStatus: VerificationCreditStatus
  try {
    creditStatus = await getVerificationCreditStatus()
  } catch (err) {
    log.error('prospect_verify_tick_credit_check_failed', { error: err })
    captureApiError(err)
    return Response.json({ ok: false, error: 'Failed to read verification credit balance.' }, { status: 500 })
  }

  log.info('prospect_verify_tick_credit_balance', { creditStatus })

  if (!creditStatus.anyAvailable) {
    // Loud on purpose — never a silent no-op when the whole reason this tick
    // exists (automated spend) has run dry.
    log.error('prospect_verify_tick_no_credits', { creditStatus })
    captureApiError(new Error('prospect_verify_tick: no verification credits available'), { creditStatus })
    return Response.json({
      ok: true,
      enabled: true,
      ran: false,
      stopped_reason: 'no_credits',
      credit_status: creditStatus,
      message: 'Both MillionVerifier and NeverBounce are unconfigured or out of credits — stopping for today. Top up and this tick resumes on its own.',
    })
  }

  const tickCap = Math.min(remainingBudget, HARD_MAX_PER_TICK)

  let candidates: Candidate[]
  let unlinkable: number
  try {
    ;[candidates, unlinkable] = await Promise.all([loadCandidates(tickCap), countUnlinkable()])
  } catch (err) {
    log.error('prospect_verify_tick_candidates_failed', { error: err })
    captureApiError(err)
    return Response.json({ ok: false, error: 'Failed to load candidate prospects.' }, { status: 500 })
  }

  if (candidates.length === 0) {
    return Response.json({
      ok: true,
      enabled: true,
      ran: true,
      checked: 0,
      max_per_day: perDayCap,
      verified_today: verifiedToday,
      remaining_budget: remainingBudget,
      unlinkable_no_source: unlinkable,
      credit_status: creditStatus,
      message: 'No never-verified prospects with a linked run were found.',
    })
  }

  const { groups, skippedNoExternalRun } = await groupByExternalRun(candidates, log)

  const totals: BatchAggregate = { ok: 0, catch_all: 0, unknown: 0, invalid: 0, disposable: 0, bounced: 0, blocked: 0 }
  let creditsUsedTotal: number | null = 0
  let stoppedReason: 'no_credits' | null = null
  let processedCount = 0
  let importedToXmailTotal = 0
  const runResults: Array<Record<string, unknown>> = []

  for (const group of groups) {
    if (stoppedReason) break

    let creditsBefore
    let batch
    let creditsAfter
    try {
      // Measured, not counted — same before/after balance-delta measurement
      // prospects_verify uses (see its handler for the auto-top-up caveat
      // this mirrors below).
      creditsBefore = await getMillionVerifierCredits()
      batch = await verifyProspectsBatch(
        group.orgId,
        group.candidates.map((c) => ({ kind: c.kind, id: c.id, email: c.email })),
      )
      creditsAfter = await getMillionVerifierCredits()
    } catch (err) {
      log.error('prospect_verify_tick_batch_failed', { externalRunId: group.externalRunId, error: err })
      captureApiError(err, { externalRunId: group.externalRunId })
      runResults.push({ external_run_id: group.externalRunId, checked: group.candidates.length, error: err instanceof Error ? err.message : String(err) })
      continue
    }

    const rawDelta = creditsBefore.credits != null && creditsAfter.credits != null ? creditsBefore.credits - creditsAfter.credits : null
    // Never clamp a negative (auto-top-up) delta to 0 — see prospects_verify's
    // identical comment. `null` means "not measured", 0 means "measured zero".
    const creditsUsed = rawDelta != null && rawDelta < 0 ? null : rawDelta

    for (const key of Object.keys(totals) as Array<keyof BatchAggregate>) {
      totals[key] += batch.aggregate[key]
    }
    processedCount += group.candidates.length
    creditsUsedTotal = creditsUsedTotal === null || creditsUsed === null ? null : creditsUsedTotal + creditsUsed

    const verificationProvider = resolveVerificationProvider(batch.results)
    const verifiedAt = new Date().toISOString()

    let xmailNotified = false
    let xmailError: string | undefined
    if (isXmailConfigured()) {
      try {
        const notify = await xmailNotifyVerificationComplete(group.externalRunId, {
          provider: 'xcraper',
          checked: group.candidates.length,
          ok: batch.aggregate.ok,
          catchAll: batch.aggregate.catch_all,
          unknown: batch.aggregate.unknown,
          invalid: batch.aggregate.invalid,
          creditsUsed,
          verificationProvider,
          verifiedAt,
        })
        xmailNotified = notify.ok
        if (!notify.ok) {
          xmailError = notify.error
          log.error('prospect_verify_tick_xmail_notify_failed', { externalRunId: group.externalRunId, error: notify.error })
        }
      } catch (err) {
        xmailError = err instanceof Error ? err.message : String(err)
        log.error('prospect_verify_tick_xmail_notify_threw', { externalRunId: group.externalRunId, error: err })
      }
    } else {
      xmailError = 'Xmail outreach is not wired up (XMAIL_API_URL / XMAIL_USER_ID / XMAIL_ORG_ID / XMAIL_SERVICE_KEY not set).'
    }

    // Item 1 (2026-09-30): import whatever just landed on email_status='ok' for
    // this run — the exact same function prospects_import_to_xmail itself calls,
    // so the rules are identical (only 'ok', never enrolls/activates). Attempted
    // even when the notify call above failed: the verification already
    // persisted, and importing is independently useful.
    let importedToXmail = 0
    let importError: string | undefined
    if (isXmailConfigured()) {
      try {
        const importResult = await importVerifiedProspectsToXmail(group.orgId, {}, { externalRunId: group.externalRunId })
        if (typeof importResult.imported === 'number') {
          importedToXmail = importResult.imported
        } else if (importResult.error) {
          importError = String(importResult.error)
          log.error('prospect_verify_tick_import_failed', { externalRunId: group.externalRunId, error: importResult.error })
        }
      } catch (err) {
        importError = err instanceof Error ? err.message : String(err)
        log.error('prospect_verify_tick_import_threw', { externalRunId: group.externalRunId, error: err })
      }
    } else {
      importError = 'Xmail outreach is not wired up (XMAIL_API_URL / XMAIL_USER_ID / XMAIL_ORG_ID / XMAIL_SERVICE_KEY not set).'
    }
    importedToXmailTotal += importedToXmail

    runResults.push({
      external_run_id: group.externalRunId,
      checked: group.candidates.length,
      ...verifyOutputCounts(batch.aggregate),
      credits_used: creditsUsed,
      verification_provider: verificationProvider,
      xmail_notified: xmailNotified,
      ...(xmailError ? { xmail_error: xmailError } : {}),
      imported_to_xmail: importedToXmail,
      ...(importError ? { import_error: importError } : {}),
    })

    if (batch.aggregate.blocked > 0) {
      // Credits ran out mid-tick. The run just processed still gets its
      // (partial, honest) notification above — but no further run starts
      // this invocation. Next tick re-checks the balance from scratch.
      stoppedReason = 'no_credits'
      log.error('prospect_verify_tick_no_credits_mid_run', { externalRunId: group.externalRunId, blocked: batch.aggregate.blocked })
      captureApiError(new Error('prospect_verify_tick: ran out of verification credits mid-run'), { externalRunId: group.externalRunId })
    }
  }

  log.info('prospect_verify_tick_complete', {
    candidatesFound: candidates.length,
    groupsFound: groups.length,
    groupsProcessed: runResults.length,
    processed: processedCount,
    importedToXmailTotal,
    skippedNoExternalRun,
    unlinkable,
    stoppedReason,
    totals,
  })

  return Response.json({
    ok: true,
    enabled: true,
    ran: true,
    max_per_day: perDayCap,
    verified_today_before: verifiedToday,
    remaining_budget: remainingBudget,
    candidates_found: candidates.length,
    skipped_no_external_run: skippedNoExternalRun,
    unlinkable_no_source: unlinkable,
    runs_found: groups.length,
    runs_processed: runResults.length,
    checked: processedCount,
    // Nested (not spread) — verifyOutputCounts() includes an `ok` COUNT
    // field, which would silently clobber this response's top-level `ok`
    // BOOLEAN envelope if flattened here. Per-run objects below don't have
    // that collision (they carry no top-level `ok` of their own).
    totals: verifyOutputCounts(totals),
    credits_used: creditsUsedTotal,
    imported_to_xmail: importedToXmailTotal,
    credit_status: creditStatus,
    stopped_reason: stoppedReason,
    runs: runResults,
  })
}

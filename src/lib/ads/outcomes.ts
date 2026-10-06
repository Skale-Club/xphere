// Outcome reviewer — the last link of "what the AI knew → what it changed →
// what happened".
//
// The ledger (ads_change_requests) records why a change was proposed
// (`rationale`) and which knowledge grounded it (`knowledge_refs`,
// `memory_refs`). Nothing used to look back. This module does, once per
// applied change, after enough time has passed for the nightly snapshot
// (src/lib/ads/snapshot-daily.ts → ads_insights_daily) to hold a complete
// window on both sides of it:
//
//   BEFORE = the `windowDays` full UTC days before the day the change ran
//   AFTER  = the `windowDays` full UTC days starting the day after it ran
//
// The day of the change itself is excluded from both — it is half one, half
// the other. Changes of one batch are reviewed together (anchored on the
// earliest execution), so a list of 15 negative keywords produces one result,
// not 15 copies of the same comparison.
//
// The result is written to `outcome` on every change of the group and filed
// as ONE ads_memories row of type 'result', carrying the group's knowledge
// refs — so a later search for that lesson finds what happened when it was
// applied. Other applied changes on the same campaign inside the comparison
// span are listed as confounders: a before/after comparison is correlation,
// never proof, and the memory says so.
//
// Idempotency: a group is CLAIMED (conditional UPDATE on
// outcome_reviewed_at IS NULL) before any memory is created. Two overlapping
// runs can never both file a memory for the same change; a run that dies
// mid-review leaves the rows marked 'reviewing' rather than re-filing them.
//
// Called from the nightly /api/cron/ads-tick, right after the daily snapshot.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type { Json } from '@/types/database'
import { parseStoredKnowledgeRefs, type KnowledgeRef } from '@/lib/knowledge/refs'
import { createLogger } from '@/lib/obs/logger'
import { COMMAND_CATALOG, type AdsCommand } from './commands/catalog'
import type { DiffEntry } from './commands/types'
import { formatCurrency } from './currency'
import { createMemory } from './journey-db'
import { fetchCampaignWindowTotals, pctChange, type DayRange, type PeriodTotals } from './snapshot'

const log = createLogger({ module: 'ads/outcomes' })

export const OUTCOME_WINDOW_DAYS = 7
export const OUTCOME_MAX_AGE_DAYS = 60
export const OUTCOME_DEFAULT_LIMIT = 20

const DAY_MS = 86_400_000

// ─── Shapes ───────────────────────────────────────────────────────────────────

export type OutcomeMetrics = {
  /** Distinct days with stored rows in the window. */
  days: number
  impressions: number
  clicks: number
  /** Major units of the account currency. */
  spend: number
  conversions: number
  leads: number
  /** Percent. */
  ctr: number | null
  cpc: number | null
  cpl: number | null
  cost_per_conversion: number | null
}

export type OutcomeMetricKey = Exclude<keyof OutcomeMetrics, 'days'>

export type OutcomeDeltas = Record<OutcomeMetricKey, number | null>

export type OutcomeCampaign = {
  platform: 'meta' | 'google'
  ad_account_id: string
  campaign_id: string
  campaign_name: string | null
  currency: string
  before: OutcomeMetrics
  after: OutcomeMetrics
  /** Signed percent change after vs before; null when the baseline is zero/absent. */
  delta_pct: OutcomeDeltas
  has_data: boolean
}

export type OutcomeConfounder = {
  id: string
  label: string
  command_type: string
  campaign_id: string | null
  executed_at: string
}

export type MeasuredOutcome = {
  status: 'measured' | 'no_data'
  version: 1
  computed_at: string
  window_days: number
  /** Earliest execution in the group — the comparison's pivot. */
  anchor_executed_at: string
  windows: { before: DayRange; after: DayRange }
  change_request_ids: string[]
  batch_id: string | null
  /** Changes in the group that were rollbacks, with the change each one undid. */
  rollback_of: Array<{ change_id: string; rollback_of: string }>
  campaigns: OutcomeCampaign[]
  confounders: OutcomeConfounder[]
  /** ads_memories row filed for this review ('measured' only). */
  memory_id: string | null
  summary: string
}

export type ChangeOutcome =
  | MeasuredOutcome
  | { status: 'expired'; version: 1; computed_at: string; note: string }
  | { status: 'reviewing'; version: 1; claimed_at: string }

/** The subset of an ads_change_requests row the reviewer works with. */
export type ReviewableChange = {
  id: string
  org_id: string
  platform: string
  ad_account_id: string
  campaign_id: string | null
  command_type: string
  resource_type: string
  resource_name: string | null
  resource_id: string | null
  batch_id: string | null
  rollback_of: string | null
  executed_at: string
  actor_label: string | null
  rationale: string | null
  knowledge_refs: unknown
  memory_refs: unknown
  diff: unknown
}

const REVIEW_COLUMNS =
  'id, org_id, platform, ad_account_id, campaign_id, command_type, resource_type, resource_name, resource_id, batch_id, rollback_of, executed_at, actor_label, rationale, knowledge_refs, memory_refs, diff'

// ─── Pure date math (UTC, independent of the process time zone) ──────────────

/** The UTC calendar day of an instant, `YYYY-MM-DD`. */
export function utcDay(instant: Date | string): string {
  const d = typeof instant === 'string' ? new Date(instant) : instant
  return d.toISOString().slice(0, 10)
}

/** Shift a `YYYY-MM-DD` day by `n` days (no DST: the arithmetic is on UTC midnights). */
export function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10)
}

/** The before/after day windows around a change executed at `anchorExecutedAt`. */
export function outcomeWindows(anchorExecutedAt: Date | string, windowDays: number): {
  anchorDay: string
  before: DayRange
  after: DayRange
} {
  const anchorDay = utcDay(anchorExecutedAt)
  return {
    anchorDay,
    before: { since: addDays(anchorDay, -windowDays), until: addDays(anchorDay, -1) },
    after: { since: addDays(anchorDay, 1), until: addDays(anchorDay, windowDays) },
  }
}

/**
 * Which executions are ready to review, and which are too old to bother.
 *
 * `dueBefore`: a change executed before this instant has an AFTER window that
 * ended at least one full UTC day before today. The nightly snapshot re-captures
 * a trailing 7-day window, and an account whose own day ends up to 12 h after
 * UTC midnight has closed that day too — so the AFTER window is complete.
 *
 * `expiredBefore`: older executions are marked `expired` without metrics, so a
 * backlog (or a change from before this reviewer existed) never rescans forever.
 */
export function reviewCutoffs(now: Date, windowDays: number, maxAgeDays: number): { dueBefore: string; expiredBefore: string } {
  return {
    dueBefore: `${addDays(utcDay(now), -(windowDays + 1))}T00:00:00.000Z`,
    expiredBefore: new Date(now.getTime() - maxAgeDays * DAY_MS).toISOString(),
  }
}

// ─── Pure grouping / metrics ──────────────────────────────────────────────────

export type ChangeGroup<T extends Pick<ReviewableChange, 'id' | 'org_id' | 'batch_id' | 'executed_at'>> = {
  key: string
  orgId: string
  batchId: string | null
  changes: T[]
  /** Earliest executed_at in the group. */
  anchor: string
}

/**
 * Group changes by (org, batch_id) — or by their own id when not batched —
 * keeping the order in which groups first appear (the caller passes rows
 * oldest first, so the oldest work is reviewed first).
 */
export function groupChanges<T extends Pick<ReviewableChange, 'id' | 'org_id' | 'batch_id' | 'executed_at'>>(rows: readonly T[]): ChangeGroup<T>[] {
  const groups = new Map<string, ChangeGroup<T>>()
  for (const row of rows) {
    const key = `${row.org_id}:${row.batch_id ?? row.id}`
    const existing = groups.get(key)
    if (existing) {
      if (existing.changes.some((c) => c.id === row.id)) continue
      existing.changes.push(row)
      if (Date.parse(row.executed_at) < Date.parse(existing.anchor)) existing.anchor = row.executed_at
    } else {
      groups.set(key, { key, orgId: row.org_id, batchId: row.batch_id, changes: [row], anchor: row.executed_at })
    }
  }
  return Array.from(groups.values())
}

export type CampaignTarget = { platform: 'meta' | 'google'; adAccountId: string; campaignId: string }

/** Distinct (platform, account, campaign) touched by a group, in first-seen order. */
export function campaignTargets(rows: ReadonlyArray<Pick<ReviewableChange, 'platform' | 'ad_account_id' | 'campaign_id'>>): CampaignTarget[] {
  const seen = new Map<string, CampaignTarget>()
  for (const r of rows) {
    if (!r.campaign_id || (r.platform !== 'meta' && r.platform !== 'google')) continue
    const key = `${r.platform}|${r.ad_account_id}|${r.campaign_id}`
    if (!seen.has(key)) seen.set(key, { platform: r.platform, adAccountId: r.ad_account_id, campaignId: r.campaign_id })
  }
  return Array.from(seen.values())
}

export function toOutcomeMetrics(totals: PeriodTotals): OutcomeMetrics {
  return {
    days: totals.days,
    impressions: totals.impressions,
    clicks: totals.clicks,
    spend: round(totals.spend, 2),
    conversions: round(totals.conversions, 2),
    leads: totals.leads,
    ctr: totals.ctr == null ? null : round(totals.ctr, 4),
    cpc: totals.cpc == null ? null : round(totals.cpc, 4),
    cpl: totals.cpl == null ? null : round(totals.cpl, 4),
    cost_per_conversion: totals.conversions > 0 ? round(totals.spend / totals.conversions, 4) : null,
  }
}

const METRIC_KEYS: OutcomeMetricKey[] = [
  'spend', 'impressions', 'clicks', 'conversions', 'leads', 'ctr', 'cpc', 'cpl', 'cost_per_conversion',
]

export function outcomeDeltas(before: OutcomeMetrics, after: OutcomeMetrics): OutcomeDeltas {
  const out = {} as OutcomeDeltas
  for (const key of METRIC_KEYS) {
    const pct = pctChange(after[key], before[key])
    out[key] = pct == null ? null : round(pct, 1)
  }
  return out
}

/**
 * Other applied changes that touched the same campaign inside the comparison
 * span [before.since 00:00Z, after.until + 1 00:00Z) and are not part of the
 * group under review.
 */
export function selectConfounders<
  T extends { id: string; executed_at: string | null; command_type: string; campaign_id: string | null },
>(candidates: readonly T[], groupIds: ReadonlySet<string>, windows: { before: DayRange; after: DayRange }): OutcomeConfounder[] {
  const start = Date.parse(`${windows.before.since}T00:00:00.000Z`)
  const end = Date.parse(`${addDays(windows.after.until, 1)}T00:00:00.000Z`)
  const seen = new Set<string>()
  const out: OutcomeConfounder[] = []
  for (const c of candidates) {
    if (!c.executed_at || groupIds.has(c.id) || seen.has(c.id)) continue
    const at = Date.parse(c.executed_at)
    if (!(at >= start && at < end)) continue
    seen.add(c.id)
    out.push({ id: c.id, label: commandLabel(c.command_type), command_type: c.command_type, campaign_id: c.campaign_id, executed_at: c.executed_at })
  }
  return out.sort((a, b) => Date.parse(a.executed_at) - Date.parse(b.executed_at))
}

/** Union of the group's knowledge refs, deduplicated by source. */
export function unionKnowledgeRefs(rows: ReadonlyArray<{ knowledge_refs: unknown }>): KnowledgeRef[] {
  const seen = new Map<string, KnowledgeRef>()
  for (const r of rows) {
    for (const ref of parseStoredKnowledgeRefs(r.knowledge_refs)) {
      const prior = seen.get(ref.source_id)
      if (!prior) seen.set(ref.source_id, ref)
      else if (!prior.source_name && ref.source_name) seen.set(ref.source_id, { ...prior, source_name: ref.source_name, url: prior.url ?? ref.url })
    }
  }
  return Array.from(seen.values())
}

function unionMemoryRefs(rows: ReadonlyArray<{ memory_refs: unknown }>): string[] {
  const out = new Set<string>()
  for (const r of rows) {
    if (Array.isArray(r.memory_refs)) for (const id of r.memory_refs) if (typeof id === 'string') out.add(id)
  }
  return Array.from(out)
}

function round(n: number, digits: number): number {
  const f = 10 ** digits
  return Math.round(n * f) / f
}

function commandLabel(commandType: string): string {
  return COMMAND_CATALOG[commandType as AdsCommand['type']]?.label ?? commandType
}

// ─── Pure text ────────────────────────────────────────────────────────────────

export function formatPct(pct: number | null): string {
  if (pct == null) return 'n/a'
  return `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%`
}

function formatCount(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString('en-US') : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

function metricLine(label: string, before: string, after: string, pct: number | null): string {
  return `- ${label}: ${before} → ${after} (${formatPct(pct)})`
}

function campaignDisplayName(c: Pick<OutcomeCampaign, 'campaign_name' | 'campaign_id'>): string {
  return c.campaign_name ?? `campaign ${c.campaign_id}`
}

/** The one-line summary stored on the outcome and in the memory metadata. */
export function summarizeOutcome(campaigns: readonly OutcomeCampaign[], windowDays: number, confounderCount: number): string {
  const measured = campaigns.filter((c) => c.has_data)
  if (measured.length === 0) return 'No stored metrics on either side of the change.'
  const parts = measured.map((c) => {
    const d = c.delta_pct
    const bits = [`spend ${formatPct(d.spend)}`, `clicks ${formatPct(d.clicks)}`]
    if (c.before.conversions > 0 || c.after.conversions > 0) {
      bits.push(`conversions ${formatPct(d.conversions)}`, `cost/conversion ${formatPct(d.cost_per_conversion)}`)
    }
    if (c.before.leads > 0 || c.after.leads > 0) bits.push(`CPL ${formatPct(d.cpl)}`)
    return `${campaignDisplayName(c)}: ${bits.join(', ')}`
  })
  const caveat = confounderCount > 0 ? `; ${confounderCount} other change${confounderCount === 1 ? '' : 's'} in the window` : ''
  return `${parts.join(' | ')} (${windowDays}d after vs ${windowDays}d before${caveat})`
}

/** Title + content of the 'result' memory filed for a measured group. */
export function buildOutcomeMemory(params: {
  changes: ReadonlyArray<Pick<ReviewableChange, 'id' | 'command_type' | 'resource_name' | 'resource_id' | 'resource_type' | 'executed_at' | 'actor_label' | 'rationale' | 'rollback_of' | 'diff'>>
  campaigns: readonly OutcomeCampaign[]
  confounders: readonly OutcomeConfounder[]
  knowledgeRefs: readonly KnowledgeRef[]
  windowDays: number
  windows: { before: DayRange; after: DayRange }
}): { title: string; content: string } {
  const { changes, campaigns, confounders, knowledgeRefs, windowDays, windows } = params
  const labels = Array.from(new Set(changes.map((c) => commandLabel(c.command_type))))
  const campaignNames = Array.from(new Set(campaigns.map(campaignDisplayName)))
  const what = changes.length === 1 ? labels[0] : `${changes.length} changes (${labels.join(', ')})`
  const where = campaignNames.length === 1 ? campaignNames[0] : `${campaignNames.length} campaigns`
  const title = `Result: ${what} · ${where}`.slice(0, 300)

  const lines: string[] = []
  const executed = utcDay(changes.reduce((min, c) => (Date.parse(c.executed_at) < Date.parse(min) ? c.executed_at : min), changes[0].executed_at))
  const actors = Array.from(new Set(changes.map((c) => c.actor_label).filter(Boolean)))
  lines.push(`What changed (applied ${executed}${actors.length ? ` by ${actors.join(', ')}` : ''}):`)
  for (const c of changes.slice(0, 15)) {
    const diff = (Array.isArray(c.diff) ? c.diff : []) as DiffEntry[]
    const target = c.resource_name ?? c.resource_id ?? c.resource_type
    const diffText = diff
      .slice(0, 4)
      .map((d) => `${d.label} ${d.beforeDisplay} → ${d.afterDisplay}`)
      .join('; ')
    lines.push(`- ${commandLabel(c.command_type)} on "${target}"${diffText ? `: ${diffText}` : ''}`)
  }
  if (changes.length > 15) lines.push(`- …and ${changes.length - 15} more in the same batch`)

  const rollbacks = changes.filter((c) => c.rollback_of)
  for (const r of rollbacks) lines.push(`This was a rollback of change ${r.rollback_of}.`)

  const rationales = Array.from(new Set(changes.map((c) => c.rationale?.trim()).filter((r): r is string => !!r)))
  if (rationales.length) lines.push(`Why: ${rationales.join(' / ').slice(0, 1200)}`)
  if (knowledgeRefs.length) {
    lines.push(`Grounded in: ${knowledgeRefs.map((k) => k.source_name ?? k.source_id).join('; ')}`)
  }

  lines.push('')
  lines.push(
    `Result — ${windowDays} days before (${windows.before.since} to ${windows.before.until}) vs ${windowDays} days after (${windows.after.since} to ${windows.after.until}):`,
  )
  for (const c of campaigns) {
    if (!c.has_data) {
      lines.push(`${campaignDisplayName(c)}: no stored metrics on either side.`)
      continue
    }
    const money = (v: number | null) => (v == null ? 'n/a' : formatCurrency(v, c.currency))
    const pct = (v: number | null) => (v == null ? 'n/a' : `${v.toFixed(2)}%`)
    const b = c.before
    const a = c.after
    const d = c.delta_pct
    lines.push(`${campaignDisplayName(c)} (${c.currency}; days with data: before ${b.days}/${windowDays}, after ${a.days}/${windowDays}):`)
    lines.push(metricLine('Spend', money(b.spend), money(a.spend), d.spend))
    lines.push(metricLine('Impressions', formatCount(b.impressions), formatCount(a.impressions), d.impressions))
    lines.push(metricLine('Clicks', formatCount(b.clicks), formatCount(a.clicks), d.clicks))
    lines.push(metricLine('CTR', pct(b.ctr), pct(a.ctr), d.ctr))
    lines.push(metricLine('CPC', money(b.cpc), money(a.cpc), d.cpc))
    lines.push(metricLine('Conversions', formatCount(b.conversions), formatCount(a.conversions), d.conversions))
    lines.push(metricLine('Cost per conversion', money(b.cost_per_conversion), money(a.cost_per_conversion), d.cost_per_conversion))
    if (b.leads > 0 || a.leads > 0) {
      lines.push(metricLine('Leads', formatCount(b.leads), formatCount(a.leads), d.leads))
      lines.push(metricLine('CPL', money(b.cpl), money(a.cpl), d.cpl))
    }
  }

  lines.push('')
  lines.push(
    'Caveat: this is a before/after comparison — correlation, not proof. Seasonality, auction competition, tracking and budget pacing also move these numbers.',
  )
  if (confounders.length) {
    const list = confounders
      .slice(0, 10)
      .map((c) => `${c.label} (${utcDay(c.executed_at)}, change ${c.id})`)
      .join('; ')
    lines.push(
      `Other changes on this campaign inside the comparison window: ${list}${confounders.length > 10 ? `; and ${confounders.length - 10} more` : ''}. The effect cannot be attributed to this change alone.`,
    )
  }

  return { title, content: lines.join('\n') }
}

// ─── Database ─────────────────────────────────────────────────────────────────

function db() {
  return createServiceRoleClient()
}

type Db = ReturnType<typeof db>

async function expireBacklog(client: Db, expiredBefore: string, nowIso: string, orgId?: string): Promise<number> {
  const outcome: ChangeOutcome = {
    status: 'expired',
    version: 1,
    computed_at: nowIso,
    note: 'Applied before the outcome review window; not measured.',
  }
  let q = client
    .from('ads_change_requests')
    .update({ outcome: outcome as unknown as Json, outcome_reviewed_at: nowIso })
    .eq('status', 'succeeded')
    .is('outcome_reviewed_at', null)
    .not('campaign_id', 'is', null)
    .lt('executed_at', expiredBefore)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q.select('id')
  if (error) throw new Error(`Failed to expire outcome backlog: ${error.message}`)
  return data?.length ?? 0
}

function candidateQuery(client: Db, cutoffs: { dueBefore: string; expiredBefore: string }) {
  return client
    .from('ads_change_requests')
    .select(REVIEW_COLUMNS)
    .eq('status', 'succeeded')
    .is('outcome_reviewed_at', null)
    .not('campaign_id', 'is', null)
    .not('executed_at', 'is', null)
    .in('platform', ['meta', 'google'])
    .lt('executed_at', cutoffs.dueBefore)
    .gte('executed_at', cutoffs.expiredBefore)
}

async function fetchCandidates(
  client: Db,
  cutoffs: { dueBefore: string; expiredBefore: string },
  limit: number,
  orgId?: string,
): Promise<ReviewableChange[]> {
  let q = candidateQuery(client, cutoffs)
  if (orgId) q = q.eq('org_id', orgId)
  const { data, error } = await q.order('executed_at', { ascending: true }).limit(limit)
  if (error) throw new Error(`Failed to list changes to review: ${error.message}`)
  return (data ?? []) as unknown as ReviewableChange[]
}

/** The rest of a batch that fell outside the candidate page. */
async function fetchBatchMembers(
  client: Db,
  orgId: string,
  batchId: string,
  cutoffs: { dueBefore: string; expiredBefore: string },
): Promise<ReviewableChange[]> {
  const { data, error } = await candidateQuery(client, cutoffs).eq('org_id', orgId).eq('batch_id', batchId).limit(200)
  if (error) throw new Error(`Failed to list batch ${batchId}: ${error.message}`)
  return (data ?? []) as unknown as ReviewableChange[]
}

/** Mark the group as under review. Returns the ids this run now owns. */
async function claim(client: Db, orgId: string, ids: string[], nowIso: string): Promise<Set<string>> {
  const placeholder: ChangeOutcome = { status: 'reviewing', version: 1, claimed_at: nowIso }
  const { data, error } = await client
    .from('ads_change_requests')
    .update({ outcome_reviewed_at: nowIso, outcome: placeholder as unknown as Json })
    .eq('org_id', orgId)
    .in('id', ids)
    .is('outcome_reviewed_at', null)
    .select('id')
  if (error) throw new Error(`Failed to claim changes for review: ${error.message}`)
  return new Set((data ?? []).map((r) => r.id))
}

/** Give the group back to the queue (nothing was filed). */
async function release(client: Db, orgId: string, ids: string[]): Promise<void> {
  const { error } = await client
    .from('ads_change_requests')
    .update({ outcome_reviewed_at: null, outcome: null })
    .eq('org_id', orgId)
    .in('id', ids)
  if (error) log.error('outcome_release_failed', { orgId, ids, message: error.message })
}

async function writeOutcome(client: Db, orgId: string, ids: string[], outcome: ChangeOutcome, nowIso: string): Promise<void> {
  const { error } = await client
    .from('ads_change_requests')
    .update({ outcome: outcome as unknown as Json, outcome_reviewed_at: nowIso })
    .eq('org_id', orgId)
    .in('id', ids)
  if (error) throw new Error(`Failed to write outcome: ${error.message}`)
}

async function fetchConfounderCandidates(
  client: Db,
  orgId: string,
  target: CampaignTarget,
  windows: { before: DayRange; after: DayRange },
) {
  const { data, error } = await client
    .from('ads_change_requests')
    .select('id, command_type, campaign_id, executed_at')
    .eq('org_id', orgId)
    .eq('platform', target.platform)
    .eq('ad_account_id', target.adAccountId)
    .eq('campaign_id', target.campaignId)
    .in('status', ['succeeded', 'drifted'])
    .gte('executed_at', `${windows.before.since}T00:00:00.000Z`)
    .lt('executed_at', `${addDays(windows.after.until, 1)}T00:00:00.000Z`)
    .order('executed_at', { ascending: true })
    .limit(100)
  if (error) throw new Error(`Failed to list overlapping changes: ${error.message}`)
  return data ?? []
}

// ─── Reviewer ─────────────────────────────────────────────────────────────────

export type OutcomeReviewResult = {
  /** Groups whose outcome was written ('measured' or 'no_data'). */
  reviewed: number
  /** 'result' memories filed. */
  memories: number
  /** Groups with no stored metrics on either side (outcome written, no memory). */
  noData: number
  /** Groups not reviewed this run: claimed by another run, or released after an error. */
  skipped: number
  /** Changes marked 'expired' because they ran before maxAgeDays. */
  expired: number
}

/**
 * Review applied changes whose AFTER window is complete. Bounded (`limit`
 * groups per run, default 20) and idempotent; safe to run every night or by
 * hand. Never throws for one bad group — that group is released and retried
 * on the next run.
 */
export async function reviewChangeOutcomes(opts: {
  limit?: number
  windowDays?: number
  maxAgeDays?: number
  now?: Date
  /** Restrict to one org (manual runs). */
  orgId?: string
  /** Stop starting new groups after this many ms (whatever is left runs next time). */
  budgetMs?: number
} = {}): Promise<OutcomeReviewResult> {
  const startedAt = Date.now()
  const now = opts.now ?? new Date()
  const nowIso = now.toISOString()
  const windowDays = Math.min(Math.max(Math.trunc(opts.windowDays ?? OUTCOME_WINDOW_DAYS), 1), 30)
  // The age limit can never be shorter than the time it takes a change to become due.
  const maxAgeDays = Math.max(Math.trunc(opts.maxAgeDays ?? OUTCOME_MAX_AGE_DAYS), windowDays + 3)
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? OUTCOME_DEFAULT_LIMIT), 1), 100)
  const cutoffs = reviewCutoffs(now, windowDays, maxAgeDays)
  const client = db()

  const result: OutcomeReviewResult = { reviewed: 0, memories: 0, noData: 0, skipped: 0, expired: 0 }

  result.expired = await expireBacklog(client, cutoffs.expiredBefore, nowIso, opts.orgId)

  const candidates = await fetchCandidates(client, cutoffs, Math.min(limit * 10, 500), opts.orgId)
  const groups = groupChanges(candidates).slice(0, limit)

  for (const group of groups) {
    if (opts.budgetMs != null && Date.now() - startedAt > opts.budgetMs) break
    let changes = group.changes
    if (group.batchId) {
      // Pull in batch members beyond the candidate page so the batch is reviewed once.
      const members = await fetchBatchMembers(client, group.orgId, group.batchId, cutoffs).catch(() => [])
      const merged = groupChanges([...changes, ...members])[0]
      if (merged) changes = merged.changes
    }

    const claimed = await claim(client, group.orgId, changes.map((c) => c.id), nowIso).catch((error: unknown) => {
      log.error('outcome_claim_failed', { orgId: group.orgId, group: group.key, message: error instanceof Error ? error.message : String(error) })
      return new Set<string>()
    })
    const owned = changes.filter((c) => claimed.has(c.id))
    if (owned.length === 0) {
      result.skipped++
      continue
    }
    const ownedIds = owned.map((c) => c.id)

    let memoryFiled = false
    try {
      const anchor = owned.reduce((min, c) => (Date.parse(c.executed_at) < Date.parse(min) ? c.executed_at : min), owned[0].executed_at)
      const { before, after } = outcomeWindows(anchor, windowDays)
      const windows = { before, after }
      const groupIds = new Set(ownedIds)

      const campaigns: OutcomeCampaign[] = []
      const confounders: OutcomeConfounder[] = []
      for (const target of campaignTargets(owned)) {
        const [totals, overlapping] = await Promise.all([
          fetchCampaignWindowTotals({
            orgId: group.orgId,
            platform: target.platform,
            adAccountId: target.adAccountId,
            campaignId: target.campaignId,
            windows,
          }),
          fetchConfounderCandidates(client, group.orgId, target, windows),
        ])
        const b = totals.windows.before
        const a = totals.windows.after
        const beforeMetrics = toOutcomeMetrics(b)
        const afterMetrics = toOutcomeMetrics(a)
        const fromLedger = owned.find((c) => c.campaign_id === target.campaignId && c.resource_type === 'campaign')?.resource_name ?? null
        campaigns.push({
          platform: target.platform,
          ad_account_id: target.adAccountId,
          campaign_id: target.campaignId,
          campaign_name: totals.campaignName ?? fromLedger,
          currency: totals.currency ?? 'USD',
          before: beforeMetrics,
          after: afterMetrics,
          delta_pct: outcomeDeltas(beforeMetrics, afterMetrics),
          has_data: b.rows + a.rows > 0,
        })
        for (const c of selectConfounders(overlapping, groupIds, windows)) {
          if (!confounders.some((x) => x.id === c.id)) confounders.push(c)
        }
      }

      const hasData = campaigns.some((c) => c.has_data)
      const outcomeBase = {
        version: 1 as const,
        computed_at: nowIso,
        window_days: windowDays,
        anchor_executed_at: anchor,
        windows,
        change_request_ids: ownedIds,
        batch_id: group.batchId,
        rollback_of: owned.filter((c) => c.rollback_of).map((c) => ({ change_id: c.id, rollback_of: c.rollback_of as string })),
        campaigns,
        confounders,
      }

      if (!hasData) {
        await writeOutcome(
          client,
          group.orgId,
          ownedIds,
          { ...outcomeBase, status: 'no_data', memory_id: null, summary: 'No stored metrics on either side of the change.' },
          nowIso,
        )
        result.noData++
        result.reviewed++
        continue
      }

      const summary = summarizeOutcome(campaigns, windowDays, confounders.length)
      const knowledgeRefs = unionKnowledgeRefs(owned)
      const { title, content } = buildOutcomeMemory({ changes: owned, campaigns, confounders, knowledgeRefs, windowDays, windows })
      const first = owned[0]
      const single = campaigns.length === 1 ? campaigns[0] : null

      const memoryId = await createMemory({
        orgId: group.orgId,
        type: 'result',
        source: 'audit',
        platform: first.platform === 'meta' || first.platform === 'google' ? first.platform : undefined,
        title,
        content,
        campaignId: single?.campaign_id,
        campaignName: single?.campaign_name ?? undefined,
        confidence: confounders.length > 0 ? 2 : 3,
        status: 'active',
        metadata: {
          change_request_ids: ownedIds,
          batch_id: group.batchId,
          memory_refs: unionMemoryRefs(owned),
          outcome: {
            status: 'measured',
            summary,
            window_days: windowDays,
            windows,
            confounder_ids: confounders.map((c) => c.id),
            campaigns: campaigns.map((c) => ({ campaign_id: c.campaign_id, currency: c.currency, delta_pct: c.delta_pct })),
          },
        },
        knowledgeRefs,
        changeRequestId: first.id,
      })

      if (!memoryId) {
        // Nothing was filed — hand the group back so tomorrow's run retries it.
        await release(client, group.orgId, ownedIds)
        log.warn('outcome_memory_not_saved', { orgId: group.orgId, group: group.key })
        result.skipped++
        continue
      }
      memoryFiled = true
      result.memories++

      await writeOutcome(client, group.orgId, ownedIds, { ...outcomeBase, status: 'measured', memory_id: memoryId, summary }, nowIso)
      result.reviewed++
      log.info('outcome_reviewed', { orgId: group.orgId, group: group.key, changes: ownedIds.length, memoryId, confounders: confounders.length })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (memoryFiled) {
        // The memory exists; releasing would file it twice. The rows stay
        // marked 'reviewing' — visible, and never re-filed.
        log.error('outcome_write_failed_after_memory', { orgId: group.orgId, group: group.key, message })
        result.reviewed++
      } else {
        await release(client, group.orgId, ownedIds)
        log.error('outcome_review_failed', { orgId: group.orgId, group: group.key, message })
        result.skipped++
      }
    }
  }

  return result
}

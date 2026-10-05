import 'server-only'

// Geogrid worker. One tick (cron every minute, or right after "Scan now"):
//
//   1. reap     in_flight points whose worker died go back to the queue
//   2. poll     async tasks with no postback after POLL_AFTER_MS are pulled
//   3. claim    due points via claim_local_seo_points (SKIP LOCKED)
//   4. run      sync providers fetch inline (bounded concurrency, time
//               budget); async providers get the tasks submitted
//   5. finalize scans whose points are all terminal: metrics, competitor
//               snapshot, real cost, events
//
// A point's lifecycle is queued -> in_flight -> done | failed. Transient
// errors requeue with backoff (1, 4, 15 min) until MAX_ATTEMPTS; auth/quota
// errors stop the whole scan. A scan with any failed point ends `partial`,
// never `completed` (SPEC 4.5).

import type { SupabaseClient } from '@supabase/supabase-js'

import type { Database, Json } from '@/types/database'
import { createLogger } from '@/lib/obs/logger'

import { postbackSecret, providerFor, providerProfile, type ProviderTarget } from './credentials'
import { onScanFinalized } from './events'
import { findTarget, competitorKey, top3 } from './matching'
import { aggregateCompetitors, computeMetrics } from './metrics'
import type { AsyncRankProvider, PointQuery, RankProvider, TaskOutcome } from './providers/types'
import { RankProviderError, isRankProviderError } from './providers/types'
import type { ProviderId, SerpResult, TargetIdentity } from './types'

type Admin = SupabaseClient<Database>
type PointRow = Database['public']['Tables']['local_seo_scan_points']['Row']
type ScanRow = Database['public']['Tables']['local_seo_scans']['Row']

export const MAX_ATTEMPTS = 3
const BACKOFF_MS = [60_000, 4 * 60_000, 15 * 60_000]
const SYNC_CONCURRENCY = 5
const CLAIM_LIMIT = 150
/** A sync point in flight this long belonged to a tick that died. */
const STALE_SYNC_MS = 10 * 60_000
/** Ask an async provider directly when no postback arrived by then. */
const POLL_AFTER_MS = 2 * 60_000
/** Give up on an async task that never finishes. */
const ASYNC_TIMEOUT_MS = 2 * 60 * 60_000
/** Transient errors per provider per tick before we stop calling it (breaker). */
const BREAKER_THRESHOLD = 5
const MAX_COMPETITORS_STORED = 50

const log = createLogger({ module: 'local-seo/worker' })

export type TickSummary = {
  reaped: number
  polled: number
  claimed: number
  fetched: number
  submitted: number
  failedPoints: number
  finalized: number
  timedOut: boolean
}

export type TickOptions = {
  budgetMs?: number
  /** Test seam: replace provider construction. */
  providerOverride?: (scan: ScanRow, target: ProviderTarget) => RankProvider | null
  postbackOrigin?: string | null
}

type ScanContext = { scan: ScanRow; target: TargetIdentity & ProviderTarget }

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export async function runLocalSeoTick(admin: Admin, opts: TickOptions = {}): Promise<TickSummary> {
  const started = Date.now()
  const budgetMs = opts.budgetMs ?? 55_000
  const deadline = started + budgetMs
  const summary: TickSummary = {
    reaped: 0,
    polled: 0,
    claimed: 0,
    fetched: 0,
    submitted: 0,
    failedPoints: 0,
    finalized: 0,
    timedOut: false,
  }
  const touched = new Set<string>()
  const providers = new ProviderCache(admin, opts.providerOverride)

  summary.reaped = await reapStale(admin, touched)
  summary.polled = await pollAsync(admin, providers, touched, deadline, summary)

  const { data: claimed, error } = await admin.rpc('claim_local_seo_points', { p_limit: CLAIM_LIMIT })
  if (error) throw new Error(`claim_local_seo_points failed: ${error.message}`)
  const points = (claimed ?? []) as PointRow[]
  summary.claimed = points.length

  const byScan = groupBy(points, (p) => p.scan_id)
  const contexts = await loadScanContexts(admin, [...byScan.keys()])
  const postbackUrl = buildPostbackUrl(opts.postbackOrigin)

  for (const [scanId, scanPoints] of byScan) {
    touched.add(scanId)
    const ctx = contexts.get(scanId)
    if (!ctx) {
      await releasePoints(admin, scanPoints)
      continue
    }
    await markRunning(admin, ctx.scan)
    const provider = await providers.get(ctx)
    if (!provider) {
      await failScan(admin, ctx.scan, `The ${ctx.scan.provider} provider is not configured.`)
      continue
    }
    if (providers.tripped(provider.id)) {
      await releasePoints(admin, scanPoints)
      continue
    }

    if (provider.mode === 'async') {
      summary.submitted += await submitAsync(admin, provider, ctx, scanPoints, postbackUrl, providers, summary)
    } else {
      const queue = [...scanPoints]
      await pool(SYNC_CONCURRENCY, queue.length, async (i) => {
        const point = queue[i]
        if (Date.now() > deadline || providers.tripped(provider.id) || ctx.scan.status === 'failed') {
          summary.timedOut ||= Date.now() > deadline
          await releasePoints(admin, [point])
          return
        }
        try {
          const results = await provider.fetchPoint(toQuery(point, ctx.scan))
          await recordPointResult(admin, point, ctx, results, provider.costPerPointUsd(ctx.scan.depth))
          summary.fetched++
        } catch (err) {
          const e = asProviderError(err)
          if (e.kind === 'transient') providers.recordTransient(provider.id)
          if (await handlePointError(admin, point, ctx, e)) summary.failedPoints++
        }
      })
    }
  }

  for (const scanId of touched) {
    if (await maybeFinalizeScan(admin, scanId)) summary.finalized++
  }

  log.info('local_seo_tick', { ...summary, ms: Date.now() - started })
  return summary
}

// ---------------------------------------------------------------------------
// Async (postback / poll)
// ---------------------------------------------------------------------------

async function submitAsync(
  admin: Admin,
  provider: AsyncRankProvider,
  ctx: ScanContext,
  points: PointRow[],
  postbackUrl: string | null,
  providers: ProviderCache,
  summary: TickSummary,
): Promise<number> {
  let submitted = 0
  for (const batch of chunk(points, provider.batchSize)) {
    let outcomes
    try {
      outcomes = await provider.submit(batch.map((p) => toQuery(p, ctx.scan)), postbackUrl)
    } catch (err) {
      const e = asProviderError(err)
      if (e.kind === 'transient') providers.recordTransient(provider.id)
      for (const p of batch) if (await handlePointError(admin, p, ctx, e)) summary.failedPoints++
      continue
    }
    const now = new Date().toISOString()
    for (const o of outcomes) {
      const point = batch.find((p) => p.id === o.pointId)
      if (!point) continue
      if ('taskId' in o) {
        await admin
          .from('local_seo_scan_points')
          .update({ provider_task_id: o.taskId, claimed_at: now, last_error: null })
          .eq('id', point.id)
        submitted++
      } else if (await handlePointError(admin, point, ctx, o.error)) {
        summary.failedPoints++
      }
    }
  }
  return submitted
}

/** Apply one async task result, whether it came by postback or by polling. */
export async function applyTaskOutcome(admin: Admin, taskId: string, outcome: TaskOutcome): Promise<'applied' | 'unknown' | 'pending'> {
  if (outcome.status === 'pending') return 'pending'
  const { data: point } = await admin
    .from('local_seo_scan_points')
    .select('*')
    .eq('provider_task_id', taskId)
    .maybeSingle()
  if (!point) return 'unknown'
  if (point.status !== 'in_flight') return 'applied' // duplicate delivery
  const ctx = (await loadScanContexts(admin, [point.scan_id])).get(point.scan_id)
  if (!ctx) return 'unknown'
  if (outcome.status === 'done') {
    await recordPointResult(admin, point, ctx, outcome.results, providerProfile(ctx.scan.provider).costPerPointUsd)
  } else {
    await handlePointError(admin, point, ctx, outcome.error)
  }
  await maybeFinalizeScan(admin, point.scan_id)
  return 'applied'
}

async function pollAsync(
  admin: Admin,
  providers: ProviderCache,
  touched: Set<string>,
  deadline: number,
  summary: TickSummary,
): Promise<number> {
  const cutoff = new Date(Date.now() - POLL_AFTER_MS).toISOString()
  const { data: waiting } = await admin
    .from('local_seo_scan_points')
    .select('*')
    .eq('status', 'in_flight')
    .not('provider_task_id', 'is', null)
    .lt('claimed_at', cutoff)
    .order('claimed_at', { ascending: true })
    .limit(60)
  if (!waiting?.length) return 0

  const contexts = await loadScanContexts(admin, [...new Set(waiting.map((p) => p.scan_id))])
  let polled = 0
  for (const point of waiting) {
    if (Date.now() > deadline) break
    const ctx = contexts.get(point.scan_id)
    if (!ctx) continue
    const provider = await providers.get(ctx)
    if (!provider || provider.mode !== 'async' || providers.tripped(provider.id)) continue
    touched.add(point.scan_id)
    polled++
    try {
      const outcome = await provider.getTask(point.provider_task_id!)
      if (outcome.status === 'pending') {
        if (Date.now() - new Date(point.created_at).getTime() > ASYNC_TIMEOUT_MS) {
          await handlePointError(admin, point, ctx, new RankProviderError('invalid', 'The provider never finished this point.'))
          summary.failedPoints++
        } else {
          // Push the next poll out instead of asking again next minute.
          await admin.from('local_seo_scan_points').update({ claimed_at: new Date().toISOString() }).eq('id', point.id)
        }
        continue
      }
      if (outcome.status === 'done') {
        await recordPointResult(admin, point, ctx, outcome.results, provider.costPerPointUsd(ctx.scan.depth))
      } else if (await handlePointError(admin, point, ctx, outcome.error)) {
        summary.failedPoints++
      }
    } catch (err) {
      const e = asProviderError(err)
      if (e.kind === 'transient') providers.recordTransient(provider.id)
      else if (await handlePointError(admin, point, ctx, e)) summary.failedPoints++
    }
  }
  return polled
}

function buildPostbackUrl(origin?: string | null): string | null {
  const secret = postbackSecret()
  const base = (origin ?? process.env.LOCAL_SEO_POSTBACK_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL)?.replace(/\/+$/, '')
  if (!secret || !base || !base.startsWith('https://')) return null
  return `${base}/api/local-seo/providers/dataforseo/postback?secret=${encodeURIComponent(secret)}&id=$id`
}

// ---------------------------------------------------------------------------
// Point outcomes
// ---------------------------------------------------------------------------

async function recordPointResult(
  admin: Admin,
  point: PointRow,
  ctx: ScanContext,
  results: SerpResult[],
  costUsd: number,
): Promise<void> {
  const match = findTarget(results, ctx.target)
  const { data: updated } = await admin
    .from('local_seo_scan_points')
    .update({
      status: 'done',
      rank: match.rank,
      match_method: match.method,
      top3: top3(results) as unknown as Json,
      results_count: results.length,
      fetched_at: new Date().toISOString(),
      cost_usd: costUsd,
      last_error: null,
    })
    .eq('id', point.id)
    .neq('status', 'done')
    .select('id')
  if (!updated?.length) return // already recorded (duplicate postback)

  if (results.length === 0) return
  const { error } = await admin.from('local_seo_serp_results').insert(
    results.map((r, i) => ({
      org_id: point.org_id,
      scan_id: point.scan_id,
      point_id: point.id,
      position: r.position,
      place_id: r.placeId ?? null,
      cid: r.cid ?? null,
      title: r.title.slice(0, 500),
      rating: r.rating ?? null,
      reviews: r.reviews ?? null,
      category: r.category ?? null,
      address: r.address ?? null,
      is_target: i === match.index,
    })),
  )
  if (error) log.warn('local_seo_results_insert_failed', { pointId: point.id, error: error.message })
}

/** Returns true when the point ended up failed (terminal). */
async function handlePointError(admin: Admin, point: PointRow, ctx: ScanContext, err: RankProviderError): Promise<boolean> {
  if (err.kind === 'auth' || err.kind === 'quota') {
    await failScan(admin, ctx.scan, err.message)
    return true
  }
  const retry = err.kind === 'transient' && point.attempts < MAX_ATTEMPTS
  const update = retry
    ? {
        status: 'queued' as const,
        provider_task_id: null,
        claimed_at: null,
        next_attempt_at: new Date(Date.now() + BACKOFF_MS[Math.min(point.attempts, BACKOFF_MS.length) - 1]).toISOString(),
        last_error: err.message.slice(0, 500),
      }
    : { status: 'failed' as const, last_error: err.message.slice(0, 500) }
  await admin.from('local_seo_scan_points').update(update).eq('id', point.id).neq('status', 'done')
  return !retry
}

/** Hand claimed-but-unprocessed points back without burning an attempt. */
async function releasePoints(admin: Admin, points: PointRow[]): Promise<void> {
  for (const p of points) {
    await admin
      .from('local_seo_scan_points')
      .update({ status: 'queued', claimed_at: null, attempts: Math.max(0, p.attempts - 1) })
      .eq('id', p.id)
      .eq('status', 'in_flight')
  }
}

async function reapStale(admin: Admin, touched: Set<string>): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_SYNC_MS).toISOString()
  const { data: stale } = await admin
    .from('local_seo_scan_points')
    .select('id, scan_id, attempts')
    .eq('status', 'in_flight')
    .is('provider_task_id', null)
    .lt('claimed_at', cutoff)
    .limit(500)
  for (const p of stale ?? []) {
    touched.add(p.scan_id)
    const exhausted = p.attempts >= MAX_ATTEMPTS
    await admin
      .from('local_seo_scan_points')
      .update(
        exhausted
          ? { status: 'failed', last_error: 'The worker stopped while fetching this point.' }
          : { status: 'queued', claimed_at: null, next_attempt_at: new Date().toISOString() },
      )
      .eq('id', p.id)
      .eq('status', 'in_flight')
  }
  return stale?.length ?? 0
}

// ---------------------------------------------------------------------------
// Scan state
// ---------------------------------------------------------------------------

async function markRunning(admin: Admin, scan: ScanRow): Promise<void> {
  if (scan.status !== 'queued') return
  await admin
    .from('local_seo_scans')
    .update({ status: 'running', started_at: new Date().toISOString() })
    .eq('id', scan.id)
    .eq('status', 'queued')
  scan.status = 'running'
}

/** Permanent provider error: stop every point that has not finished. */
async function failScan(admin: Admin, scan: ScanRow, message: string): Promise<void> {
  await admin
    .from('local_seo_scan_points')
    .update({ status: 'failed', last_error: message.slice(0, 500) })
    .eq('scan_id', scan.id)
    .in('status', ['queued', 'in_flight'])
  await admin.from('local_seo_scans').update({ error: message.slice(0, 1000) }).eq('id', scan.id)
  scan.status = 'failed'
}

/**
 * Close the scan when every point is terminal. The status transition is a
 * conditional UPDATE, so concurrent ticks/postbacks finalize exactly once.
 */
export async function maybeFinalizeScan(admin: Admin, scanId: string): Promise<boolean> {
  const { data: points } = await admin
    .from('local_seo_scan_points')
    .select('id, status, rank, cost_usd')
    .eq('scan_id', scanId)
  if (!points) return false
  const done = points.filter((p) => p.status === 'done')
  const failed = points.filter((p) => p.status === 'failed')
  const open = points.length - done.length - failed.length

  if (open > 0) {
    await admin
      .from('local_seo_scans')
      .update({ points_done: done.length, points_failed: failed.length })
      .eq('id', scanId)
      .in('status', ['queued', 'running'])
    return false
  }

  const { data: scan } = await admin.from('local_seo_scans').select('*').eq('id', scanId).maybeSingle()
  if (!scan || !['queued', 'running'].includes(scan.status)) return false

  const metrics = computeMetrics(done.map((p) => p.rank), scan.depth)
  const status = done.length === 0 ? 'failed' : failed.length > 0 ? 'partial' : 'completed'
  const cost = round6(points.reduce((a, p) => a + Number(p.cost_usd ?? 0), 0))

  const { data: closed } = await admin
    .from('local_seo_scans')
    .update({
      status,
      points_done: done.length,
      points_failed: failed.length,
      arp: metrics.arp,
      atrp: metrics.atrp,
      solv: metrics.solv,
      found_pct: metrics.foundPct,
      cost_usd: cost,
      finished_at: new Date().toISOString(),
      error: status === 'failed' ? (scan.error ?? 'No point could be fetched.') : scan.error,
    })
    .eq('id', scanId)
    .in('status', ['queued', 'running'])
    .select('*')
  const final = closed?.[0]
  if (!final) return false

  await admin.from('local_seo_usage_ledger').update({ cost_usd: cost }).eq('scan_id', scanId)
  if (done.length > 0) await snapshotCompetitors(admin, final, done.length)
  try {
    await onScanFinalized(admin, final)
  } catch (err) {
    log.warn('local_seo_events_failed', { scanId, error: (err as Error).message })
  }
  return true
}

async function snapshotCompetitors(admin: Admin, scan: ScanRow, donePoints: number): Promise<void> {
  const rows: Database['public']['Tables']['local_seo_serp_results']['Row'][] = []
  // Up to depth x points rows (980 for 7x7); page through PostgREST's cap.
  for (let from = 0; ; from += 1000) {
    const { data } = await admin
      .from('local_seo_serp_results')
      .select('*')
      .eq('scan_id', scan.id)
      .order('id', { ascending: true })
      .range(from, from + 999)
    if (!data?.length) break
    rows.push(...data)
    if (data.length < 1000) break
  }
  const byPoint = groupBy(rows, (r) => r.point_id)
  const perPoint: SerpResult[][] = [...byPoint.values()].map((rs) =>
    rs.map((r) => ({
      position: r.position,
      title: r.title,
      placeId: r.place_id,
      rating: r.rating,
      reviews: r.reviews,
      category: r.category,
    })),
  )
  // Points with zero results still count in the denominator.
  while (perPoint.length < donePoints) perPoint.push([])

  const targetKeys = new Set(rows.filter((r) => r.is_target).map((r) => competitorKey({ placeId: r.place_id, title: r.title })))
  const all = aggregateCompetitors(perPoint)
  const kept = all.filter((c, i) => i < MAX_COMPETITORS_STORED || targetKeys.has(c.key))
  if (!kept.length) return
  const { error } = await admin.from('local_seo_competitor_snapshots').upsert(
    kept.map((c) => ({
      org_id: scan.org_id,
      scan_id: scan.id,
      location_id: scan.location_id,
      keyword_id: scan.keyword_id,
      competitor_key: c.key,
      place_id: c.placeId,
      title: c.title.slice(0, 500),
      is_target: targetKeys.has(c.key),
      appearances: c.appearances,
      avg_rank: c.avgRank,
      solv: c.solv,
      rating: c.rating,
      reviews: c.reviews,
      category: c.category,
    })),
    { onConflict: 'scan_id,competitor_key', ignoreDuplicates: true },
  )
  if (error) log.warn('local_seo_competitors_failed', { scanId: scan.id, error: error.message })
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function loadScanContexts(admin: Admin, scanIds: string[]): Promise<Map<string, ScanContext>> {
  const out = new Map<string, ScanContext>()
  if (!scanIds.length) return out
  const { data: scans } = await admin.from('local_seo_scans').select('*').in('id', scanIds)
  const locationIds = [...new Set((scans ?? []).map((s) => s.location_id))]
  const { data: locations } = locationIds.length
    ? await admin
        .from('local_seo_locations')
        .select('id, place_id, cid, business_name, address, phone, lat, lng')
        .in('id', locationIds)
    : { data: [] }
  const locById = new Map((locations ?? []).map((l) => [l.id, l]))
  for (const scan of scans ?? []) {
    const loc = locById.get(scan.location_id)
    if (!loc) continue
    out.set(scan.id, {
      scan,
      target: {
        placeId: loc.place_id,
        cid: loc.cid,
        name: loc.business_name,
        address: loc.address,
        phone: loc.phone,
        lat: loc.lat,
        lng: loc.lng,
      },
    })
  }
  return out
}

class ProviderCache {
  private cache = new Map<string, RankProvider | null>()
  private transient = new Map<ProviderId, number>()
  constructor(
    private admin: Admin,
    private override?: TickOptions['providerOverride'],
  ) {}

  async get(ctx: ScanContext): Promise<RankProvider | null> {
    // The fake provider is per-target; real ones are shared per tick.
    const key = ctx.scan.provider === 'fake' ? `fake:${ctx.scan.location_id}` : ctx.scan.provider
    if (!this.cache.has(key)) {
      const p = this.override
        ? this.override(ctx.scan, ctx.target)
        : await providerFor(this.admin, ctx.scan.provider, ctx.target)
      this.cache.set(key, p)
    }
    return this.cache.get(key) ?? null
  }

  recordTransient(id: ProviderId) {
    this.transient.set(id, (this.transient.get(id) ?? 0) + 1)
  }

  tripped(id: ProviderId): boolean {
    return (this.transient.get(id) ?? 0) >= BREAKER_THRESHOLD
  }
}

function toQuery(p: PointRow, scan: ScanRow): PointQuery {
  return {
    pointId: p.id,
    keyword: scan.keyword,
    lat: p.lat,
    lng: p.lng,
    zoom: scan.zoom,
    depth: scan.depth,
    language: scan.language,
    country: scan.country,
  }
}

function asProviderError(err: unknown): RankProviderError {
  if (isRankProviderError(err)) return err
  return new RankProviderError('transient', err instanceof Error ? err.message : String(err))
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const x of xs) {
    const k = key(x)
    const arr = m.get(k)
    if (arr) arr.push(x)
    else m.set(k, [x])
  }
  return m
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

async function pool(concurrency: number, count: number, run: (i: number) => Promise<void>): Promise<void> {
  let next = 0
  const workers = Array.from({ length: Math.min(concurrency, count) }, async () => {
    while (next < count) {
      const i = next++
      await run(i)
    }
  })
  await Promise.all(workers)
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

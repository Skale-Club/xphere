import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

import { createScan } from '@/lib/local-seo/scans'
import { applyTaskOutcome, runLocalSeoTick } from '@/lib/local-seo/worker'
import { RankProviderError, type RankProvider } from '@/lib/local-seo/providers/types'
import type { SerpResult } from '@/lib/local-seo/types'
import type { Database } from '@/types/database'

import { FakeDb } from './helpers/fake-supabase'

// Org DataForSEO passwords are stored encrypted; the tests store them in clear.
vi.mock('@/lib/crypto', () => ({ decrypt: async (v: string) => v, encrypt: async (v: string) => v }))

const ORG = '00000000-0000-0000-0000-0000000000aa'

function makeDb() {
  const db = new FakeDb((table, row) => {
    if (table === 'local_seo_scans') {
      return { status: 'queued', points_done: 0, points_failed: 0, zoom: 13, depth: 20, error: null, ...row }
    }
    if (table === 'local_seo_scan_points') {
      return {
        status: 'queued',
        attempts: 0,
        next_attempt_at: new Date().toISOString(),
        claimed_at: null,
        provider_task_id: null,
        rank: null,
        cost_usd: null,
        last_error: null,
        ...row,
      }
    }
    return row
  })
  // Same semantics as migration 1316's claim_local_seo_points.
  db.rpcs.set('claim_local_seo_points', (args, d) => {
    const now = new Date().toISOString()
    const open = new Set(d.rows('local_seo_scans').filter((s) => s.status === 'queued' || s.status === 'running').map((s) => s.id))
    const due = d
      .rows('local_seo_scan_points')
      .filter((p) => p.status === 'queued' && (p.next_attempt_at as string) <= now && open.has(p.scan_id))
      .slice(0, args.p_limit as number)
    for (const p of due) Object.assign(p, { status: 'in_flight', claimed_at: now, attempts: (p.attempts as number) + 1 })
    return due.map((p) => ({ ...p }))
  })
  db.rows('local_seo_locations').push({
    id: 'loc-1',
    org_id: ORG,
    name: 'Bigode',
    business_name: 'Bigode Barbearia',
    place_id: 'target',
    cid: null,
    address: '45 Rua B',
    phone: null,
    lat: -23.55,
    lng: -46.63,
    language: 'pt',
    country: 'br',
    default_grid_size: 3,
    default_spacing_m: 1000,
    default_shape: 'square',
    is_active: true,
  })
  db.rows('local_seo_keywords').push({ id: 'kw-1', org_id: ORG, location_id: 'loc-1', keyword: 'barbearia', language: null, country: null, is_active: true })
  return db
}

const asAdmin = (db: FakeDb) => db as unknown as SupabaseClient<Database>

/** Target ranks 1 in the centre row, 5 elsewhere; one competitor everywhere. */
function results(rank: number): SerpResult[] {
  const out: SerpResult[] = []
  for (let pos = 1; pos <= 6; pos++) {
    out.push(pos === rank ? { position: pos, title: 'Bigode Barbearia', placeId: 'target' } : { position: pos, title: `Rival ${pos}`, placeId: `rival-${pos}` })
  }
  return out
}

function syncProvider(fetchPoint: RankProvider extends infer P ? (P extends { mode: 'sync' } ? P['fetchPoint'] : never) : never): RankProvider {
  return { id: 'fake', mode: 'sync', costPerPointUsd: () => 0.001, fetchPoint }
}

async function newScan(db: FakeDb) {
  const res = await createScan(asAdmin(db), { orgId: ORG, locationId: 'loc-1', keywordId: 'kw-1', triggeredBy: 'manual' })
  if (!res.ok) throw new Error(res.error)
  return res.scanId
}

const scanRow = (db: FakeDb, id: string) => db.rows('local_seo_scans').find((s) => s.id === id)!
const pointRows = (db: FakeDb, id: string) => db.rows('local_seo_scan_points').filter((p) => p.scan_id === id)

beforeEach(() => {
  vi.stubEnv('LOCAL_SEO_PROVIDER', 'fake')
  vi.stubEnv('BILLING_ENFORCEMENT_ENABLED', 'false')
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.useRealTimers()
})

describe('createScan', () => {
  it('writes the scan, one point per grid cell and the usage charge', async () => {
    const db = makeDb()
    const id = await newScan(db)
    expect(scanRow(db, id)).toMatchObject({ provider: 'fake', grid_size: 3, points_total: 9, keyword: 'barbearia', language: 'pt' })
    expect(pointRows(db, id)).toHaveLength(9)
    expect(db.rows('local_seo_usage_ledger')).toMatchObject([{ scan_id: id, points: 9, billable: false }])
  })

  it('refuses a scan beyond the monthly quota', async () => {
    vi.stubEnv('LOCAL_SEO_PROVIDER', 'serpapi')
    vi.stubEnv('SERPAPI_API_KEY', 'k')
    vi.stubEnv('LOCAL_SEO_UNPLANNED_POINTS_MONTH', '5')
    const db = makeDb()
    const res = await createScan(asAdmin(db), { orgId: ORG, locationId: 'loc-1', keywordId: 'kw-1', triggeredBy: 'manual' })
    expect(res.ok).toBe(false)
    expect(db.rows('local_seo_scans')).toHaveLength(0)
  })

  it("runs on the org's own DataForSEO account without spending plan points", async () => {
    vi.stubEnv('LOCAL_SEO_PROVIDER', '')
    vi.stubEnv('DATAFORSEO_LOGIN', 'platform')
    vi.stubEnv('DATAFORSEO_PASSWORD', 'platform-pw')
    vi.stubEnv('LOCAL_SEO_UNPLANNED_POINTS_MONTH', '5')
    const db = makeDb()
    db.rows('local_seo_org_settings').push({ org_id: ORG, rank_credentials: 'own' })
    db.rows('integrations').push({ organization_id: ORG, provider: 'dataforseo', is_active: true, encrypted_api_key: 'own-pw', config: { login: 'org@x.com' } })
    const res = await createScan(asAdmin(db), { orgId: ORG, locationId: 'loc-1', keywordId: 'kw-1', triggeredBy: 'manual' })
    expect(res).toMatchObject({ ok: true, estimate: { provider: 'dataforseo', credentialSource: 'own', billable: false } })
    expect(db.rows('local_seo_scans')[0]).toMatchObject({ credential_source: 'own' })
    expect(db.rows('local_seo_usage_ledger')).toMatchObject([{ points: 9, billable: false }])
  })

  it("never falls back to the platform account when the org's own is missing", async () => {
    vi.stubEnv('LOCAL_SEO_PROVIDER', '')
    vi.stubEnv('DATAFORSEO_LOGIN', 'platform')
    vi.stubEnv('DATAFORSEO_PASSWORD', 'platform-pw')
    const db = makeDb()
    db.rows('local_seo_org_settings').push({ org_id: ORG, rank_credentials: 'own' })
    db.rows('integrations').push({ organization_id: ORG, provider: 'dataforseo', is_active: false, encrypted_api_key: 'own-pw', config: { login: 'org@x.com' } })
    const res = await createScan(asAdmin(db), { orgId: ORG, locationId: 'loc-1', keywordId: 'kw-1', triggeredBy: 'manual' })
    expect(res).toMatchObject({ ok: false, error: expect.stringContaining('Integrations') })
    expect(db.rows('local_seo_scans')).toHaveLength(0)
  })

  it('honours the platform kill switch', async () => {
    vi.stubEnv('LOCAL_SEO_PROVIDER', 'serpapi')
    vi.stubEnv('SERPAPI_API_KEY', 'k')
    vi.stubEnv('LOCAL_SEO_DISABLED', 'true')
    const res = await createScan(asAdmin(makeDb()), { orgId: ORG, locationId: 'loc-1', keywordId: 'kw-1', triggeredBy: 'manual' })
    expect(res).toMatchObject({ ok: false })
  })
})

describe('runLocalSeoTick', () => {
  it('fetches every point, finalizes metrics and snapshots competitors', async () => {
    const db = makeDb()
    const id = await newScan(db)
    const provider = syncProvider(async (q) => results(q.lat === -23.55 ? 1 : 5))
    const summary = await runLocalSeoTick(asAdmin(db), { providerOverride: () => provider })

    expect(summary).toMatchObject({ claimed: 9, fetched: 9, finalized: 1 })
    const scan = scanRow(db, id)
    expect(scan.status).toBe('completed')
    // Centre row (3 points) rank 1, the other 6 rank 5.
    expect(scan.arp).toBe(3.67)
    expect(scan.solv).toBe(33.33)
    expect(scan.found_pct).toBe(100)
    expect(scan.cost_usd).toBeCloseTo(0.009, 6)
    expect(pointRows(db, id).every((p) => p.status === 'done' && p.match_method === 'place_id')).toBe(true)
    expect(db.rows('local_seo_serp_results').filter((r) => r.is_target)).toHaveLength(9)
    const target = db.rows('local_seo_competitor_snapshots').find((c) => c.is_target)
    expect(target).toMatchObject({ competitor_key: 'pid:target', appearances: 9, solv: 33.33 })
    expect(db.rows('local_seo_usage_ledger')[0].cost_usd).toBeCloseTo(0.009, 6)
  })

  it('retries transient errors with backoff, then completes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-05T12:00:00Z'))
    const db = makeDb()
    const id = await newScan(db)
    let calls = 0
    const provider = syncProvider(async () => {
      calls++
      if (calls === 1) throw new RankProviderError('transient', 'timeout')
      return results(2)
    })

    await runLocalSeoTick(asAdmin(db), { providerOverride: () => provider })
    expect(scanRow(db, id).status).toBe('running')
    const retried = pointRows(db, id).find((p) => p.status === 'queued')!
    expect(retried.last_error).toBe('timeout')
    expect(retried.next_attempt_at).toBe('2026-10-05T12:01:00.000Z')

    // Not due yet: nothing to claim.
    expect((await runLocalSeoTick(asAdmin(db), { providerOverride: () => provider })).claimed).toBe(0)
    vi.setSystemTime(new Date('2026-10-05T12:01:30Z'))
    await runLocalSeoTick(asAdmin(db), { providerOverride: () => provider })
    expect(scanRow(db, id).status).toBe('completed')
  })

  it('ends partial, never completed, when a point fails for good', async () => {
    const db = makeDb()
    const id = await newScan(db)
    let calls = 0
    const provider = syncProvider(async () => {
      calls++
      if (calls === 4) throw new RankProviderError('invalid', 'bad coordinate')
      return results(3)
    })
    await runLocalSeoTick(asAdmin(db), { providerOverride: () => provider })
    expect(scanRow(db, id)).toMatchObject({ status: 'partial', points_done: 8, points_failed: 1 })
    // Failed points are unknown, not misses: SoLV is over the 8 done points.
    expect(scanRow(db, id).solv).toBe(100)
  })

  it('gives up after the last attempt', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    let t = new Date('2026-10-05T12:00:00Z').getTime()
    vi.setSystemTime(t)
    const db = makeDb()
    const id = await newScan(db)
    const provider = syncProvider(async () => {
      throw new RankProviderError('transient', 'flaky')
    })
    // Circuit breaker: after 5 transient errors the tick stops calling the
    // provider and hands the rest back without spending an attempt.
    await runLocalSeoTick(asAdmin(db), { providerOverride: () => provider })
    expect(pointRows(db, id).filter((p) => p.attempts === 0)).toHaveLength(4)
    for (let i = 0; i < 10 && scanRow(db, id).status === 'running'; i++) {
      t += 16 * 60_000
      vi.setSystemTime(t)
      await runLocalSeoTick(asAdmin(db), { providerOverride: () => provider })
    }
    expect(scanRow(db, id)).toMatchObject({ status: 'failed', points_failed: 9 })
    expect(pointRows(db, id).every((p) => p.attempts === 3)).toBe(true)
  })

  it('stops the whole scan on an auth error', async () => {
    const db = makeDb()
    const id = await newScan(db)
    const provider = syncProvider(async () => {
      throw new RankProviderError('auth', 'key revoked')
    })
    await runLocalSeoTick(asAdmin(db), { providerOverride: () => provider })
    expect(scanRow(db, id)).toMatchObject({ status: 'failed', error: 'key revoked' })
    expect(pointRows(db, id).every((p) => p.status === 'failed')).toBe(true)
  })

  it('submits async tasks and applies each postback exactly once', async () => {
    const db = makeDb()
    const id = await newScan(db)
    const provider: RankProvider = {
      id: 'dataforseo',
      mode: 'async',
      batchSize: 100,
      costPerPointUsd: () => 0.0006,
      submit: async (qs) => qs.map((q) => ({ pointId: q.pointId, taskId: `task-${q.pointId}` })),
      getTask: async () => ({ status: 'pending' }),
      parsePostback: () => [],
    }
    const summary = await runLocalSeoTick(asAdmin(db), { providerOverride: () => provider })
    expect(summary.submitted).toBe(9)
    expect(scanRow(db, id).status).toBe('running')

    const points = pointRows(db, id)
    for (const p of points) {
      expect(await applyTaskOutcome(asAdmin(db), p.provider_task_id as string, { status: 'done', results: results(1) })).toBe('applied')
    }
    // A duplicate delivery changes nothing.
    await applyTaskOutcome(asAdmin(db), points[0].provider_task_id as string, { status: 'done', results: results(9) })
    expect(db.rows('local_seo_serp_results')).toHaveLength(9 * 6)
    expect(scanRow(db, id)).toMatchObject({ status: 'completed', solv: 100 })
    expect(await applyTaskOutcome(asAdmin(db), 'unknown-task', { status: 'done', results: [] })).toBe('unknown')
  })
})

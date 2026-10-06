// End-to-end behaviour of reviewChangeOutcomes (src/lib/ads/outcomes.ts)
// against an in-memory stand-in for the two tables it reads and writes
// (ads_change_requests, ads_insights_daily). What matters here:
//
//   - only changes whose AFTER window is complete are reviewed; too-old ones
//     are marked expired; fresh ones are left alone
//   - a batch is reviewed once, as one group
//   - a measured group writes `outcome` on every change and files ONE memory
//     with the cited knowledge, the first change id and lower confidence when
//     other changes overlap the window
//   - nothing on either side → no_data, no memory
//   - running again never files a second memory (idempotent)
//   - a memory that fails to save hands the group back for the next run

import { beforeEach, describe, expect, it, vi } from 'vitest'

type Row = Record<string, unknown>

const store = vi.hoisted(() => ({ tables: {} as Record<string, Row[]> }))

/** Minimal PostgREST-like builder: the filters/ops outcomes.ts and snapshot.ts use. */
function fakeClient() {
  function builder(table: string) {
    const preds: Array<(r: Row) => boolean> = []
    let mode: 'select' | 'update' = 'select'
    let payload: Row = {}
    let returning = false
    let order: { col: string; asc: boolean } | null = null
    let limit = Infinity
    const cmp = (a: unknown, b: unknown) => String(a).localeCompare(String(b))
    const api = {
      select() {
        if (mode === 'update') returning = true
        return api
      },
      update(p: Row) {
        mode = 'update'
        payload = p
        return api
      },
      eq(c: string, v: unknown) {
        preds.push((r) => r[c] === v)
        return api
      },
      in(c: string, vs: unknown[]) {
        preds.push((r) => vs.includes(r[c]))
        return api
      },
      is(c: string, v: null) {
        preds.push((r) => (r[c] ?? null) === v)
        return api
      },
      not(c: string, op: string, v: null) {
        if (op !== 'is' || v !== null) throw new Error('fake only supports not(col, "is", null)')
        preds.push((r) => r[c] != null)
        return api
      },
      lt(c: string, v: unknown) {
        preds.push((r) => r[c] != null && cmp(r[c], v) < 0)
        return api
      },
      lte(c: string, v: unknown) {
        preds.push((r) => r[c] != null && cmp(r[c], v) <= 0)
        return api
      },
      gte(c: string, v: unknown) {
        preds.push((r) => r[c] != null && cmp(r[c], v) >= 0)
        return api
      },
      order(col: string, opts: { ascending: boolean }) {
        order = { col, asc: opts.ascending }
        return api
      },
      limit(n: number) {
        limit = n
        return api
      },
      then(resolve: (v: { data: unknown; error: null }) => unknown) {
        const rows = (store.tables[table] ??= [])
        const matches = rows.filter((r) => preds.every((p) => p(r)))
        if (mode === 'update') {
          for (const r of matches) Object.assign(r, structuredClone(payload))
          return resolve({ data: returning ? matches.map((r) => ({ ...r })) : null, error: null })
        }
        const out = [...matches]
        if (order) {
          const { col, asc } = order
          out.sort((a, b) => (asc ? 1 : -1) * cmp(a[col], b[col]))
        }
        return resolve({ data: out.slice(0, limit).map((r) => structuredClone(r)), error: null })
      },
    }
    return api
  }
  return { from: (table: string) => builder(table) }
}

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => fakeClient() }))
vi.mock('@/lib/obs/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn(), child: vi.fn() }),
}))

const createMemoryMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ads/journey-db', () => ({ createMemory: createMemoryMock }))

import { reviewChangeOutcomes, type MeasuredOutcome } from '@/lib/ads/outcomes'

const ORG = 'org-1'
const NOW = new Date('2026-10-06T05:15:00.000Z') // due: executed before 2026-09-28
const KNOWLEDGE_ID = '22222222-2222-4222-8222-222222222222'

function change(overrides: Row): Row {
  return {
    org_id: ORG,
    platform: 'google',
    ad_account_id: '1234567890',
    campaign_id: 'c1',
    command_type: 'google.campaign.set_daily_budget',
    resource_type: 'campaign',
    resource_name: 'Summer Sale',
    resource_id: 'c1',
    batch_id: null,
    rollback_of: null,
    status: 'succeeded',
    actor_label: 'mcp:xph_ab12',
    rationale: null,
    knowledge_refs: [],
    memory_refs: [],
    diff: [{ field: 'daily_budget', label: 'Daily budget', before: 10, after: 15, beforeDisplay: '$10.00', afterDisplay: '$15.00' }],
    outcome: null,
    outcome_reviewed_at: null,
    ...overrides,
  }
}

function insight(campaign_id: string, stat_date: string, spend_minor: number, clicks: number, conversions: number): Row {
  return {
    org_id: ORG,
    platform: 'google',
    ad_account_id: '1234567890',
    campaign_id,
    campaign_name: campaign_id === 'c1' ? 'Summer Sale' : null,
    stat_date,
    currency: 'USD',
    impressions: clicks * 50,
    clicks,
    spend_minor,
    conversions,
    leads: 0,
  }
}

function seed() {
  const days = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `2026-09-${String(from + i).padStart(2, '0')}`)
  store.tables = {
    ads_change_requests: [
      // A: measured, grounded in knowledge, overlapped by B.
      change({
        id: 'A',
        executed_at: '2026-09-20T15:00:00.000Z',
        rationale: 'Budget-capped with CPA under target.',
        knowledge_refs: [{ source_id: KNOWLEDGE_ID, source_name: 'Budget scaling playbook', url: null }],
        memory_refs: ['33333333-3333-4333-8333-333333333333'],
      }),
      // B: drifted, so never a review candidate itself — but it did apply
      // something to the same campaign inside A's window.
      change({ id: 'B', status: 'drifted', command_type: 'google.campaign.set_status', executed_at: '2026-09-24T08:00:00.000Z' }),
      // C: older than maxAgeDays → expired without metrics.
      change({ id: 'C', executed_at: '2026-07-01T10:00:00.000Z' }),
      // D: after window not complete yet → untouched.
      change({ id: 'D', executed_at: '2026-10-01T10:00:00.000Z' }),
      // E1/E2: one batch on a campaign with no stored metrics → one no_data group.
      change({ id: 'E1', campaign_id: 'c2', batch_id: 'batch-E', command_type: 'google.negative_keyword.add', resource_type: 'campaign_criterion', executed_at: '2026-09-10T10:00:00.000Z' }),
      change({ id: 'E2', campaign_id: 'c2', batch_id: 'batch-E', command_type: 'google.negative_keyword.add', resource_type: 'campaign_criterion', executed_at: '2026-09-10T10:01:00.000Z' }),
      // F: failed — never reviewed.
      change({ id: 'F', status: 'failed', executed_at: '2026-09-20T10:00:00.000Z' }),
    ],
    ads_insights_daily: [
      ...days(13, 19).map((d) => insight('c1', d, 1000, 10, 1)),
      insight('c1', '2026-09-20', 50_000, 500, 50), // the change day: in neither window
      ...days(21, 27).map((d) => insight('c1', d, 1500, 20, 2)),
    ],
  }
}

const byId = (id: string) => store.tables.ads_change_requests.find((r) => r.id === id) as Row

beforeEach(() => {
  seed()
  createMemoryMock.mockReset()
  createMemoryMock.mockResolvedValue('mem-1')
})

describe('reviewChangeOutcomes', () => {
  it('measures due changes, files one memory per group, expires the backlog and leaves fresh changes alone', async () => {
    const result = await reviewChangeOutcomes({ now: NOW })
    expect(result).toEqual({ reviewed: 2, memories: 1, noData: 1, skipped: 0, expired: 1 })

    // A — measured.
    const a = byId('A').outcome as MeasuredOutcome
    expect(a.status).toBe('measured')
    expect(byId('A').outcome_reviewed_at).toBe(NOW.toISOString())
    expect(a.windows).toEqual({
      before: { since: '2026-09-13', until: '2026-09-19' },
      after: { since: '2026-09-21', until: '2026-09-27' },
    })
    expect(a.memory_id).toBe('mem-1')
    expect(a.change_request_ids).toEqual(['A'])
    expect(a.campaigns).toHaveLength(1)
    expect(a.campaigns[0].campaign_name).toBe('Summer Sale')
    expect(a.campaigns[0].before.spend).toBe(70)
    expect(a.campaigns[0].after.spend).toBe(105)
    expect(a.campaigns[0].delta_pct.spend).toBe(50)
    expect(a.campaigns[0].delta_pct.cost_per_conversion).toBe(-25)
    expect(a.confounders.map((c) => c.id)).toEqual(['B'])

    // One memory, grounded in A's knowledge, linked to A.
    expect(createMemoryMock).toHaveBeenCalledTimes(1)
    const mem = createMemoryMock.mock.calls[0][0]
    expect(mem).toMatchObject({
      orgId: ORG,
      type: 'result',
      source: 'audit',
      platform: 'google',
      status: 'active',
      campaignId: 'c1',
      campaignName: 'Summer Sale',
      confidence: 2, // B overlaps the window
      changeRequestId: 'A',
      knowledgeRefs: [{ source_id: KNOWLEDGE_ID, source_name: 'Budget scaling playbook', url: null }],
    })
    expect(mem.title).toBe('Result: Set campaign daily budget · Summer Sale')
    expect(mem.content).toContain('Why: Budget-capped with CPA under target.')
    expect(mem.content).toContain('Grounded in: Budget scaling playbook')
    expect(mem.content).toContain('cannot be attributed to this change alone')
    expect(mem.metadata).toMatchObject({ change_request_ids: ['A'], batch_id: null, memory_refs: ['33333333-3333-4333-8333-333333333333'] })

    // E1 + E2 — one no_data review for the batch, no memory.
    for (const id of ['E1', 'E2']) {
      const o = byId(id).outcome as MeasuredOutcome
      expect(o.status).toBe('no_data')
      expect(o.change_request_ids.sort()).toEqual(['E1', 'E2'])
      expect(o.memory_id).toBeNull()
    }

    // C — expired; D and F — untouched; B is not a candidate.
    expect((byId('C').outcome as { status: string }).status).toBe('expired')
    for (const id of ['B', 'D', 'F']) {
      expect(byId(id).outcome).toBeNull()
      expect(byId(id).outcome_reviewed_at).toBeNull()
    }
  })

  it('is idempotent: a second run files nothing new', async () => {
    await reviewChangeOutcomes({ now: NOW })
    const again = await reviewChangeOutcomes({ now: NOW })
    expect(again).toEqual({ reviewed: 0, memories: 0, noData: 0, skipped: 0, expired: 0 })
    expect(createMemoryMock).toHaveBeenCalledTimes(1)
  })

  it('confidence stays 3 when nothing else touched the campaign', async () => {
    store.tables.ads_change_requests = store.tables.ads_change_requests.filter((r) => r.id !== 'B')
    await reviewChangeOutcomes({ now: NOW })
    expect(createMemoryMock.mock.calls[0][0].confidence).toBe(3)
    expect((byId('A').outcome as MeasuredOutcome).confounders).toEqual([])
  })

  it('a memory that fails to save releases the group for the next run', async () => {
    createMemoryMock.mockResolvedValueOnce(null)
    const first = await reviewChangeOutcomes({ now: NOW })
    expect(first.memories).toBe(0)
    expect(first.skipped).toBe(1)
    expect(byId('A').outcome_reviewed_at).toBeNull()
    expect(byId('A').outcome).toBeNull()

    const second = await reviewChangeOutcomes({ now: NOW })
    expect(second.memories).toBe(1)
    expect((byId('A').outcome as MeasuredOutcome).status).toBe('measured')
  })

  it('a change already claimed by another run is skipped, not re-filed', async () => {
    byId('A').outcome_reviewed_at = '2026-10-06T05:14:00.000Z'
    byId('A').outcome = { status: 'reviewing', version: 1, claimed_at: '2026-10-06T05:14:00.000Z' }
    await reviewChangeOutcomes({ now: NOW })
    expect(createMemoryMock).not.toHaveBeenCalled()
    expect((byId('A').outcome as { status: string }).status).toBe('reviewing')
  })

  it('respects the group limit, oldest first', async () => {
    const result = await reviewChangeOutcomes({ now: NOW, limit: 1 })
    // E (2026-09-10) is older than A (2026-09-20).
    expect(result.noData).toBe(1)
    expect(result.memories).toBe(0)
    expect(byId('A').outcome).toBeNull()
  })

  it('records a rollback in the outcome', async () => {
    byId('A').rollback_of = 'Z'
    await reviewChangeOutcomes({ now: NOW })
    expect((byId('A').outcome as MeasuredOutcome).rollback_of).toEqual([{ change_id: 'A', rollback_of: 'Z' }])
    expect(createMemoryMock.mock.calls[0][0].content).toContain('rollback of change Z')
  })
})

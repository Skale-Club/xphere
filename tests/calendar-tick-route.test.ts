// tests/calendar-tick-route.test.ts
// Phase 128 Plan 02 — SCH-03: calendar-tick route auth behavior.
// Mirrors tests/ghl-reengagement-route.test.ts's mock-Supabase + direct-handler-import
// pattern. Because route.ts calls createClient from @supabase/supabase-js directly
// (not via a repo wrapper), @supabase/supabase-js itself must be intercepted so the
// "correct secret" test case never issues a real network/DB call against this
// worktree's production-pointed .env.local.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

function makeChain(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') return (resolve: (v: unknown) => void) => resolve(result)
      return () => new Proxy({}, handler)
    },
  }
  return new Proxy({}, handler)
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ from: vi.fn(() => makeChain()) })),
}))

// Plan 128-05: keep dispatch and wait-timeout scanning as no-ops so the
// catch-up/stale-skip/watermark-guard tests below exercise only the
// scan/dedup wiring in route.ts, not downstream workflow execution.
vi.mock('@/lib/calendar/transition', () => ({
  emitCalendarEvent: vi.fn().mockResolvedValue({ dispatched: 0, dispatch_id: null }),
}))

vi.mock('@/lib/flows/wait', () => ({
  findExpiredWaits: vi.fn().mockResolvedValue([]),
  satisfyWait: vi.fn().mockResolvedValue(false),
}))

import { createClient } from '@supabase/supabase-js'
import { emitCalendarEvent } from '@/lib/calendar/transition'
import { GET, runtime } from '@/app/api/cron/calendar-tick/route'
import { computeStartsInTargetMinute } from '@/lib/calendar/tick'

const VALID_SECRET = 'test_calendar_tick_secret_abc123'

function makeRequest(auth?: string): Request {
  const headers: Record<string, string> = {}
  if (auth !== undefined) headers['Authorization'] = auth
  return new Request('http://localhost/api/cron/calendar-tick', { headers })
}

describe('GET /api/cron/calendar-tick (SCH-03)', () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  it('CRON_SECRET unset → 503 with error mentioning CRON_SECRET', async () => {
    delete process.env.CRON_SECRET
    const response = await GET(makeRequest())
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.error).toContain('CRON_SECRET')
  })

  it('CRON_SECRET set, no Authorization header → 401', async () => {
    process.env.CRON_SECRET = VALID_SECRET
    const response = await GET(makeRequest())
    expect(response.status).toBe(401)
  })

  it('CRON_SECRET set, wrong Authorization header value → 401', async () => {
    process.env.CRON_SECRET = VALID_SECRET
    const response = await GET(makeRequest('Bearer wrong_secret_value'))
    expect(response.status).toBe(401)
  })

  it('CRON_SECRET set, correct Authorization header → does NOT return 401 or 503', async () => {
    process.env.CRON_SECRET = VALID_SECRET
    const response = await GET(makeRequest(`Bearer ${VALID_SECRET}`))
    expect(response.status).not.toBe(401)
    expect(response.status).not.toBe(503)
  })

  it('runtime export equals "nodejs"', () => {
    expect(runtime).toBe('nodejs')
  })
})

// ─── SCH-01/SCH-02: catch-up, stale-skip, watermark-advance guard ──────────
// Unlike the generic empty-data makeChain() used above (auth-only tests),
// this block needs a per-table-aware mock so route.ts's watermark read,
// workflows/bookings scan, and scheduled_workflow_ticks/calendar_tick_watermark
// writes can be observed and asserted on independently.

interface FixtureBooking {
  id: string
  org_id: string
  status: 'confirmed'
  start_at: string
}

interface FixtureWorkflow {
  id: string
  org_id: string
  trigger_config: { event: string; offset?: string }
}

interface MockCtx {
  watermarkRows: Array<{ event_type: string; scanned_to: string }>
  workflow: FixtureWorkflow | null
  booking: FixtureBooking | null
  insertCalls: Array<Record<string, unknown>>
  watermarkUpserts: Array<Record<string, unknown>>
}

function makeTableAwareChain(table: string, ctx: MockCtx) {
  const filters: { contains?: { event?: string } } = {}
  let resolvedOverride: { data: unknown; error: unknown } | null = null

  const api: Record<string, unknown> = {
    select: () => api,
    eq: () => api,
    in: () => api,
    gt: () => api,
    gte: () => api,
    lt: () => api,
    lte: () => api,
    delete: () => api,
    contains: (_col: string, val: { event?: string }) => {
      filters.contains = val
      return api
    },
    insert: (payload: Record<string, unknown>) => {
      if (table === 'scheduled_workflow_ticks') {
        ctx.insertCalls.push(payload)
      }
      resolvedOverride = { data: null, error: null }
      return api
    },
    upsert: (payload: Record<string, unknown>) => {
      if (table === 'calendar_tick_watermark') {
        ctx.watermarkUpserts.push(payload)
      }
      resolvedOverride = { data: null, error: null }
      return api
    },
    then: (resolve: (v: unknown) => void) => {
      if (resolvedOverride) return resolve(resolvedOverride)
      if (table === 'calendar_tick_watermark') {
        return resolve({ data: ctx.watermarkRows, error: null })
      }
      if (table === 'workflows') {
        const wanted = filters.contains?.event
        if (ctx.workflow && wanted === ctx.workflow.trigger_config.event) {
          return resolve({ data: [ctx.workflow], error: null })
        }
        return resolve({ data: [], error: null })
      }
      if (table === 'bookings') {
        return resolve({ data: ctx.booking ? [ctx.booking] : [], error: null })
      }
      return resolve({ data: [], error: null })
    },
  }
  return api
}

function makeCatchUpSupabase(ctx: MockCtx) {
  return { from: vi.fn((table: string) => makeTableAwareChain(table, ctx)) }
}

const CATCHUP_SECRET = 'test_calendar_tick_catchup_secret'

function makeAuthedRequest(): Request {
  return new Request('http://localhost/api/cron/calendar-tick', {
    headers: { Authorization: `Bearer ${CATCHUP_SECRET}` },
  })
}

describe('GET /api/cron/calendar-tick — catch-up + stale-skip + watermark guard (SCH-01/SCH-02)', () => {
  const ORIGINAL_SECRET = process.env.CRON_SECRET
  const FIXED_NOW = new Date('2026-07-20T14:00:00.000Z')
  const WATERMARK_3H_AGO = '2026-07-20T11:00:00.000Z'

  const FIXTURE_WORKFLOW: FixtureWorkflow = {
    id: 'wf-starts-in-1',
    org_id: 'org-1',
    trigger_config: { event: 'meeting.starts_in', offset: '-5m' },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = CATCHUP_SECRET
    vi.useFakeTimers()
    vi.setSystemTime(FIXED_NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
    if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = ORIGINAL_SECRET
  })

  it('skips (and counts) a meeting.starts_in candidate whose meeting already started, without inserting a tick claim', async () => {
    const ctx: MockCtx = {
      watermarkRows: [{ event_type: 'meeting.starts_in', scanned_to: WATERMARK_3H_AGO }],
      workflow: FIXTURE_WORKFLOW,
      booking: {
        id: 'booking-stale-1',
        org_id: 'org-1',
        status: 'confirmed',
        start_at: '2026-07-20T12:00:00.000Z', // 2h in the past relative to FIXED_NOW — already started
      },
      insertCalls: [],
      watermarkUpserts: [],
    }
    vi.mocked(createClient).mockReturnValueOnce(makeCatchUpSupabase(ctx) as never)

    const response = await GET(makeAuthedRequest())
    const body = await response.json()

    expect(ctx.insertCalls.find((c) => c.booking_id === 'booking-stale-1')).toBeUndefined()
    expect(body.stale_skipped).toBeGreaterThanOrEqual(1)
  })

  it('dispatches a legitimate catch-up candidate (due-moment fell inside the gap) with fired_minute derived from the due-moment, not now', async () => {
    const startAt = new Date('2026-07-20T14:04:00.000Z') // 4 min in the future — meeting has not started
    const ctx: MockCtx = {
      watermarkRows: [{ event_type: 'meeting.starts_in', scanned_to: WATERMARK_3H_AGO }],
      workflow: FIXTURE_WORKFLOW,
      booking: {
        id: 'booking-catchup-1',
        org_id: 'org-1',
        status: 'confirmed',
        start_at: startAt.toISOString(),
      },
      insertCalls: [],
      watermarkUpserts: [],
    }
    vi.mocked(createClient).mockReturnValueOnce(makeCatchUpSupabase(ctx) as never)

    await GET(makeAuthedRequest())

    const insertCall = ctx.insertCalls.find((c) => c.booking_id === 'booking-catchup-1')
    expect(insertCall).toBeDefined()
    expect(insertCall?.fired_minute).toBe(computeStartsInTargetMinute(startAt, -5).toISOString())
    expect(insertCall?.fired_minute).not.toBe(FIXED_NOW.toISOString())
  })

  it('does NOT advance the meeting.starts_in watermark when the pass released (retried) a dispatch', async () => {
    // "Released" per route.ts's actual semantics: the tick claim insert succeeds,
    // then emitCalendarEvent fails, so the catch block deletes (releases) the
    // claim and increments the released counter that gates shouldAdvanceWatermark.
    const startAt = new Date('2026-07-20T14:04:00.000Z')
    const ctx: MockCtx = {
      watermarkRows: [{ event_type: 'meeting.starts_in', scanned_to: WATERMARK_3H_AGO }],
      workflow: FIXTURE_WORKFLOW,
      booking: {
        id: 'booking-release-1',
        org_id: 'org-1',
        status: 'confirmed',
        start_at: startAt.toISOString(),
      },
      insertCalls: [],
      watermarkUpserts: [],
    }
    vi.mocked(createClient).mockReturnValueOnce(makeCatchUpSupabase(ctx) as never)
    vi.mocked(emitCalendarEvent).mockRejectedValueOnce(new Error('simulated emit failure'))

    await GET(makeAuthedRequest())

    expect(
      ctx.watermarkUpserts.find((u) => u.event_type === 'meeting.starts_in'),
    ).toBeUndefined()
  })

  it('advances the meeting.starts_in watermark to now when the pass released nothing', async () => {
    const startAt = new Date('2026-07-20T14:04:00.000Z')
    const ctx: MockCtx = {
      watermarkRows: [{ event_type: 'meeting.starts_in', scanned_to: WATERMARK_3H_AGO }],
      workflow: FIXTURE_WORKFLOW,
      booking: {
        id: 'booking-clean-1',
        org_id: 'org-1',
        status: 'confirmed',
        start_at: startAt.toISOString(),
      },
      insertCalls: [],
      watermarkUpserts: [],
    }
    vi.mocked(createClient).mockReturnValueOnce(makeCatchUpSupabase(ctx) as never)

    await GET(makeAuthedRequest())

    const upsert = ctx.watermarkUpserts.find((u) => u.event_type === 'meeting.starts_in')
    expect(upsert).toBeDefined()
    expect(upsert?.scanned_to).toBe(FIXED_NOW.toISOString())
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const notifications: { type: string; payload: Record<string, unknown> }[] = []
const dispatched: { event: string; payload: Record<string, unknown> }[] = []

vi.mock('@/lib/notifications/insert', () => ({
  insertNotification: async (_org: string, type: string, payload: Record<string, unknown>) => {
    notifications.push({ type, payload })
  },
}))
vi.mock('@/lib/local-seo/workflow-events', () => ({
  dispatchLocalSeoWorkflowEvent: async (_a: unknown, _o: string, event: string, _s: string, payload: Record<string, unknown>) => {
    dispatched.push({ event, payload })
    return { dispatched: 0 }
  },
}))

import { diffMetrics, onScanFinalized, ruleMatches } from '@/lib/local-seo/events'
import { nextRunAt, runDueSchedules, type ScheduleTiming } from '@/lib/local-seo/schedules'
import type { Database } from '@/types/database'

import { FakeDb } from './helpers/fake-supabase'

const ORG = '00000000-0000-0000-0000-0000000000bb'
const asAdmin = (db: FakeDb) => db as unknown as SupabaseClient<Database>
const at = (iso: string) => new Date(iso)
const timing = (t: Partial<ScheduleTiming>): ScheduleTiming => ({
  frequency: 'weekly',
  weekday: 1,
  day_of_month: 1,
  hour_utc: 9,
  minute_utc: 30,
  ...t,
})

beforeEach(() => {
  notifications.length = 0
  dispatched.length = 0
  vi.stubEnv('LOCAL_SEO_PROVIDER', 'fake')
})
afterEach(() => vi.unstubAllEnvs())

describe('nextRunAt', () => {
  // 2026-10-05 is a Monday.
  it('daily: today if still ahead, else tomorrow', () => {
    expect(nextRunAt(timing({ frequency: 'daily' }), at('2026-10-05T08:00:00Z')).toISOString()).toBe('2026-10-05T09:30:00.000Z')
    expect(nextRunAt(timing({ frequency: 'daily' }), at('2026-10-05T09:30:00Z')).toISOString()).toBe('2026-10-06T09:30:00.000Z')
  })

  it('weekly: the next matching weekday', () => {
    expect(nextRunAt(timing({ weekday: 1 }), at('2026-10-05T10:00:00Z')).toISOString()).toBe('2026-10-12T09:30:00.000Z')
    expect(nextRunAt(timing({ weekday: 3 }), at('2026-10-05T10:00:00Z')).toISOString()).toBe('2026-10-07T09:30:00.000Z')
    expect(nextRunAt(timing({ weekday: 0 }), at('2026-10-05T10:00:00Z')).toISOString()).toBe('2026-10-11T09:30:00.000Z')
  })

  it('biweekly: two weeks after the previous run', () => {
    const prev = at('2026-10-05T09:30:00Z')
    expect(nextRunAt(timing({ frequency: 'biweekly' }), at('2026-10-05T09:31:00Z'), prev).toISOString()).toBe('2026-10-19T09:30:00.000Z')
  })

  it('monthly: this month if ahead, else next month (and across years)', () => {
    expect(nextRunAt(timing({ frequency: 'monthly', day_of_month: 20 }), at('2026-10-05T00:00:00Z')).toISOString()).toBe('2026-10-20T09:30:00.000Z')
    expect(nextRunAt(timing({ frequency: 'monthly', day_of_month: 1 }), at('2026-12-02T00:00:00Z')).toISOString()).toBe('2027-01-01T09:30:00.000Z')
  })
})

describe('metric changes and alert rules', () => {
  const prev = { solv: 40, arp: 3, atrp: 8, found_pct: 90 }
  const cur = { solv: 25, arp: 4.5, atrp: 8, found_pct: 95 }
  const changes = diffMetrics(cur, prev)
  const by = (m: string) => changes.find((c) => c.metric === m)!

  it('knows which direction is worse per metric', () => {
    expect(by('solv')).toMatchObject({ delta: -15, worse: true })
    expect(by('arp')).toMatchObject({ delta: 1.5, worse: true })
    expect(by('found_pct')).toMatchObject({ delta: 5, worse: false })
    expect(by('atrp')).toMatchObject({ delta: 0, worse: false })
  })

  it('matches threshold and direction', () => {
    expect(ruleMatches({ metric: 'solv', direction: 'worse', threshold: 10 }, by('solv'))).toBe(true)
    expect(ruleMatches({ metric: 'solv', direction: 'worse', threshold: 20 }, by('solv'))).toBe(false)
    expect(ruleMatches({ metric: 'solv', direction: 'better', threshold: 10 }, by('solv'))).toBe(false)
    expect(ruleMatches({ metric: 'found_pct', direction: 'any', threshold: 5 }, by('found_pct'))).toBe(true)
    expect(ruleMatches({ metric: 'atrp', direction: 'any', threshold: 0.1 }, by('atrp'))).toBe(false)
  })

  it('skips a metric missing on either side', () => {
    expect(diffMetrics({ ...cur, arp: null }, prev).find((c) => c.metric === 'arp')).toMatchObject({ delta: null })
  })
})

function seed() {
  const db = new FakeDb((table, row) => {
    if (table === 'local_seo_scans') return { status: 'queued', points_done: 0, points_failed: 0, zoom: 13, depth: 20, error: null, ...row }
    if (table === 'local_seo_scan_points') return { status: 'queued', attempts: 0, next_attempt_at: new Date().toISOString(), ...row }
    return row
  })
  db.rows('local_seo_locations').push({
    id: 'loc-1', org_id: ORG, name: 'Bigode', business_name: 'Bigode', place_id: 'p', cid: null, address: null,
    lat: 0, lng: 0, language: 'en', country: 'us', default_grid_size: 3, default_spacing_m: 1000, default_shape: 'square', is_active: true,
  })
  db.rows('local_seo_keywords').push(
    { id: 'kw-1', org_id: ORG, location_id: 'loc-1', keyword: 'barber', is_active: true },
    { id: 'kw-2', org_id: ORG, location_id: 'loc-1', keyword: 'haircut', is_active: true },
  )
  return db
}

const scan = (over: Record<string, unknown>) => ({
  org_id: ORG, location_id: 'loc-1', keyword_id: 'kw-1', keyword: 'barber', comparable_key: 'ck', status: 'completed',
  grid_size: 3, spacing_m: 1000, points_total: 9, points_done: 9, points_failed: 0, triggered_by: 'schedule',
  arp: 2, atrp: 4, solv: 50, found_pct: 100, finished_at: null, ...over,
})

describe('runDueSchedules', () => {
  it('runs a due schedule once, scanning every active keyword, and moves it forward', async () => {
    const db = seed()
    db.rows('local_seo_schedules').push({
      id: 'sch-1', org_id: ORG, location_id: 'loc-1', keyword_ids: [], grid_size: null, spacing_m: null, shape: null,
      frequency: 'weekly', weekday: 1, day_of_month: 1, hour_utc: 9, minute_utc: 0,
      next_run_at: '2026-10-05T09:00:00.000Z', is_active: true,
    })
    const now = at('2026-10-05T09:00:30Z')
    const first = await runDueSchedules(asAdmin(db), now)
    expect(first).toMatchObject({ due: 1, ran: 1, scans: 2, errors: 0 })
    expect(db.rows('local_seo_scans').map((s) => s.triggered_by)).toEqual(['schedule', 'schedule'])
    expect(db.rows('local_seo_scans').every((s) => s.schedule_id === 'sch-1')).toBe(true)
    expect(db.rows('local_seo_schedules')[0].next_run_at).toBe('2026-10-12T09:00:00.000Z')

    // A second tick in the same minute finds nothing due.
    expect(await runDueSchedules(asAdmin(db), now)).toMatchObject({ due: 0, ran: 0 })
  })

  it('records a quota error on the schedule and still advances it', async () => {
    vi.stubEnv('LOCAL_SEO_PROVIDER', 'serpapi')
    vi.stubEnv('SERPAPI_API_KEY', 'k')
    vi.stubEnv('LOCAL_SEO_UNPLANNED_POINTS_MONTH', '0')
    const db = seed()
    db.rows('local_seo_schedules').push({
      id: 'sch-2', org_id: ORG, location_id: 'loc-1', keyword_ids: ['kw-1'], grid_size: null, spacing_m: null, shape: null,
      frequency: 'daily', weekday: 1, day_of_month: 1, hour_utc: 9, minute_utc: 0,
      next_run_at: '2026-10-05T09:00:00.000Z', is_active: true,
    })
    const res = await runDueSchedules(asAdmin(db), at('2026-10-05T09:01:00Z'))
    expect(res).toMatchObject({ ran: 1, scans: 0, errors: 1 })
    expect(db.rows('local_seo_schedules')[0].last_error).toMatch(/points/)
    expect(db.rows('local_seo_schedules')[0].next_run_at).toBe('2026-10-06T09:00:00.000Z')
  })
})

describe('onScanFinalized', () => {
  it('emits events, fires a matching alert once and notifies in-app', async () => {
    const db = seed()
    db.rows('local_seo_scans').push(
      { id: 'old', created_at: '2026-09-28T09:00:00Z', ...scan({ solv: 60, arp: 2 }) },
      { id: 'new', created_at: '2026-10-05T09:00:00Z', ...scan({ solv: 30, arp: 4 }) },
    )
    db.rows('local_seo_alert_rules').push(
      { id: 'r-drop', org_id: ORG, location_id: null, metric: 'solv', direction: 'worse', threshold: 10, channels: ['in_app'], is_active: true },
      { id: 'r-other', org_id: ORG, location_id: 'loc-other', metric: 'solv', direction: 'any', threshold: 1, channels: ['in_app'], is_active: true },
      { id: 'r-quiet', org_id: ORG, location_id: 'loc-1', metric: 'solv', direction: 'worse', threshold: 50, channels: ['in_app'], is_active: true },
    )
    const current = db.rows('local_seo_scans').find((s) => s.id === 'new') as Database['public']['Tables']['local_seo_scans']['Row']

    await onScanFinalized(asAdmin(db), current)
    expect(dispatched.map((d) => d.event)).toEqual(['local_seo.scan_completed', 'local_seo.rank_changed'])
    expect(dispatched[1].payload.change).toMatchObject({ solv: { from: 60, to: 30, delta: -30, worse: true } })
    expect(db.rows('local_seo_alerts')).toMatchObject([{ rule_id: 'r-drop', metric: 'solv', delta: -30, is_worse: true, previous_scan_id: 'old' }])
    expect(notifications).toMatchObject([{ type: 'local_seo_alert', payload: { keyword: 'barber', delta: -30 } }])

    // Finalizing the same scan again (e.g. a retried tick) alerts nobody twice.
    await onScanFinalized(asAdmin(db), current)
    expect(db.rows('local_seo_alerts')).toHaveLength(1)
    expect(notifications).toHaveLength(1)
  })

  it('only reports completion for a first scan', async () => {
    const db = seed()
    db.rows('local_seo_scans').push({ id: 'first', created_at: '2026-10-05T09:00:00Z', ...scan({}) })
    await onScanFinalized(asAdmin(db), db.rows('local_seo_scans')[0] as Database['public']['Tables']['local_seo_scans']['Row'])
    expect(dispatched.map((d) => d.event)).toEqual(['local_seo.scan_completed'])
  })
})

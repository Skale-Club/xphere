// tests/analytics-game-tenant-actions.test.ts
// BS-ANALYTICS-001: the server actions behind the tenant Game tab
// (src/app/(dashboard)/analytics/actions.ts). They must use the authenticated
// client scoped to the caller's organization, never the service role, and must
// not break the traffic dashboard when the game layer fails.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/navigation', () => ({
  redirect: vi.fn((to: string) => { throw new Error(`REDIRECT:${to}`) }),
}))
vi.mock('@/lib/org/redirect', () => ({
  orgRedirect: vi.fn(async (to: string) => { throw new Error(`ORG_REDIRECT:${to}`) }),
}))
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(() => { throw new Error('the tenant panel must not use the service role') }),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { getGameAvailability, getGameDashboardData } from '@/app/(dashboard)/analytics/actions'

const FROM = '2026-10-01T00:00:00.000Z'
const TO = '2026-10-08T00:00:00.000Z'

interface Opts {
  orgId?: string | null
  events?: unknown[]
  eventsError?: string
  rollups?: Record<string, unknown>
  failing?: string[]
}

function buildSupabase(opts: Opts = {}) {
  const { orgId = 'org-1', events = [{ id: 'e1' }], eventsError, rollups = {}, failing = [] } = opts
  const rpc = vi.fn(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'get_current_org_id') return { data: orgId, error: null }
    if (failing.includes(fn)) return { data: null, error: { message: `${fn} failed` } }
    void args
    return { data: rollups[fn] ?? [], error: null }
  })
  const filters: [string, unknown[]][] = []
  const tables: string[] = []
  const from = vi.fn((table: string) => {
    tables.push(table)
    const chain: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'is', 'gte', 'lt', 'limit']) {
      chain[m] = (...args: unknown[]) => { filters.push([m, args]); return chain }
    }
    chain.then = (resolve: (v: unknown) => unknown) =>
      resolve(
        table === 'analytics_events'
          ? { data: events, error: eventsError ? { message: eventsError } : null }
          : { data: null, count: 3, error: null },
      )
    return chain
  })
  return { rpc, from, filters, tables }
}

function signedIn(opts: Opts = {}) {
  const supabase = buildSupabase(opts)
  vi.mocked(getUser).mockResolvedValue({ id: 'u1', email: 'owner@example.com' } as Awaited<ReturnType<typeof getUser>>)
  vi.mocked(createClient).mockResolvedValue(supabase as never)
  return supabase
}

function gameRollupCalls(s: ReturnType<typeof buildSupabase>) {
  return s.rpc.mock.calls.filter((c) => String(c[0]).startsWith('game_stats_'))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getGameAvailability', () => {
  it('is true when the org has game events, and the probe is scoped to the org and the window', async () => {
    const s = signedIn()
    expect(await getGameAvailability(FROM, TO)).toBe(true)
    expect(s.tables).toEqual(['analytics_events'])
    expect(s.filters).toContainEqual(['eq', ['organization_id', 'org-1']])
    expect(s.filters).toContainEqual(['eq', ['event_type', 'game']])
    expect(s.filters).toContainEqual(['gte', ['occurred_at', FROM]])
    expect(s.filters).toContainEqual(['lt', ['occurred_at', TO]])
    expect(gameRollupCalls(s)).toHaveLength(0)
  })

  it('is false when there are no game events in the period', async () => {
    signedIn({ events: [] })
    expect(await getGameAvailability(FROM, TO)).toBe(false)
  })

  it('is false instead of throwing when the probe fails, so the traffic dashboard keeps loading', async () => {
    signedIn({ eventsError: 'relation does not exist' })
    expect(await getGameAvailability(FROM, TO)).toBe(false)
  })

  it('is false for an invalid or oversized window', async () => {
    const s = signedIn()
    expect(await getGameAvailability('garbage', TO)).toBe(false)
    expect(await getGameAvailability(TO, FROM)).toBe(false)
    expect(await getGameAvailability('2020-01-01T00:00:00Z', '2026-01-01T00:00:00Z')).toBe(false)
    expect(s.tables).toEqual([])
  })

  it('sends signed-out visitors to the sign-in page', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    await expect(getGameAvailability(FROM, TO)).rejects.toThrow('REDIRECT:/')
    expect(createClient).not.toHaveBeenCalled()
  })

  it('sends a user without an active organization to the organizations page', async () => {
    signedIn({ orgId: null })
    await expect(getGameAvailability(FROM, TO)).rejects.toThrow('ORG_REDIRECT:/organizations')
  })
})

describe('getGameDashboardData', () => {
  it('returns the empty bundle without running any rollup when there are no game events', async () => {
    const s = signedIn({ events: [] })
    const d = await getGameDashboardData(FROM, TO, 'America/Sao_Paulo')
    expect(d.hasEvents).toBe(false)
    expect(d.fighters).toEqual([])
    expect(d.players.players).toBe(0)
    expect(gameRollupCalls(s)).toHaveLength(0)
  })

  it('runs the rollups for the caller organization through the authenticated client', async () => {
    const s = signedIn({
      rollups: {
        game_stats_match_summary: [{ started: 4, completed: 3, abandoned: 1, in_progress: 0, abandon_rate: 0.25, avg_duration_s: 61.5, median_duration_s: 60, p1_wins: 2, p2_wins: 1 }],
        game_stats_pick_counts: [{ fighter_id: 'lula', skin_id: null, stage_id: null, picks: 4, share: 1 }],
      },
    })
    const d = await getGameDashboardData(FROM, TO, 'America/Sao_Paulo')

    expect(d.hasEvents).toBe(true)
    expect(d.newAccounts).toBe(3)
    expect(d.matches).toMatchObject({ started: 4, completed: 3, abandoned: 1, avg_duration_s: 61.5 })
    expect(d.fighters).toEqual([{ fighter_id: 'lula', picks: 4, share: 1 }])
    expect(s.tables).toContain('contacts')

    const rollups = gameRollupCalls(s)
    expect(rollups.length).toBeGreaterThanOrEqual(20)
    for (const [fn, args] of rollups) {
      expect(args, String(fn)).toMatchObject({ p_org_id: 'org-1', p_from: FROM, p_to: TO })
    }
    expect(rollups.find((c) => c[0] === 'game_stats_match_daily')![1]).toMatchObject({ p_tz: 'America/Sao_Paulo' })
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('uses UTC when the browser sends a time zone that is not valid', async () => {
    const s = signedIn()
    await getGameDashboardData(FROM, TO, "x'; drop table y;--")
    const daily = gameRollupCalls(s).find((c) => c[0] === 'game_stats_match_daily')!
    expect(daily[1]).toMatchObject({ p_tz: 'UTC' })
  })

  it('returns the empty bundle for an invalid window instead of querying', async () => {
    const s = signedIn()
    const d = await getGameDashboardData('nope', 'nope')
    expect(d.hasEvents).toBe(false)
    expect(s.tables).toEqual([])
    expect(gameRollupCalls(s)).toHaveLength(0)
  })

  it('surfaces a rollup failure so the tab can show an error', async () => {
    signedIn({ failing: ['game_stats_match_summary'] })
    await expect(getGameDashboardData(FROM, TO)).rejects.toThrow('game_stats_match_summary failed')
  })
})

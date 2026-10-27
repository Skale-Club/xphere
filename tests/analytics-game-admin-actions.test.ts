// tests/analytics-game-admin-actions.test.ts
// BS-ANALYTICS-001: the super-admin global game panels
// (src/app/(admin)/admin/analytics/game/_actions/game-admin-actions.ts).
// Cross-organization reads use the service role, so every action must reject a
// non-admin BEFORE a service-role client exists, and must validate its input.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  getUser: vi.fn(),
}))
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

import { getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  getGameAdminData,
  getGameAdminOptions,
  getGameAdminPickSegments,
} from '@/app/(admin)/admin/analytics/game/_actions/game-admin-actions'

const FROM = '2026-10-01T00:00:00.000Z'
const TO = '2026-10-08T00:00:00.000Z'
const ORG = '3f2b8c1e-1111-4222-8333-444455556666'
const ADMIN = 'admin@xphere.app'

function buildAdminClient(rollups: Record<string, unknown> = {}, orgRows: unknown[] = []) {
  const rpc = vi.fn(async (fn: string) => ({ data: rollups[fn] ?? [], error: null }))
  const inFilter = vi.fn()
  const from = vi.fn((table: string) => ({
    select: () => ({
      in: (...args: unknown[]) => {
        inFilter(table, ...args)
        return Promise.resolve({ data: orgRows, error: null })
      },
    }),
  }))
  return { rpc, from, inFilter }
}

function loginAs(email: string | null | undefined) {
  vi.mocked(getUser).mockResolvedValue(
    (email === null ? null : { id: 'u1', email }) as Awaited<ReturnType<typeof getUser>>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.stubEnv('PLATFORM_ADMIN_EMAIL', ADMIN)
})

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('platform admin gate', () => {
  const calls: [string, () => Promise<unknown>][] = [
    ['getGameAdminOptions', () => getGameAdminOptions({ from: FROM, to: TO })],
    ['getGameAdminData', () => getGameAdminData({ from: FROM, to: TO })],
    ['getGameAdminPickSegments', () => getGameAdminPickSegments({ from: FROM, to: TO }, 'device')],
  ]

  for (const [name, call] of calls) {
    it(`${name} rejects a tenant user before creating a service-role client`, async () => {
      loginAs('tenant@example.com')
      await expect(call()).rejects.toThrow('Unauthorized')
      expect(createServiceRoleClient).not.toHaveBeenCalled()
    })

    it(`${name} rejects a signed-out caller`, async () => {
      loginAs(null)
      await expect(call()).rejects.toThrow('Unauthorized')
      expect(createServiceRoleClient).not.toHaveBeenCalled()
    })

    it(`${name} rejects everyone when PLATFORM_ADMIN_EMAIL is not configured`, async () => {
      vi.stubEnv('PLATFORM_ADMIN_EMAIL', '')
      loginAs(undefined)
      await expect(call()).rejects.toThrow('Unauthorized')
      loginAs('')
      await expect(call()).rejects.toThrow('Unauthorized')
      expect(createServiceRoleClient).not.toHaveBeenCalled()
    })
  }
})

describe('getGameAdminData', () => {
  it('reads all organizations when no org is chosen', async () => {
    loginAs(ADMIN)
    const admin = buildAdminClient({
      game_stats_match_summary: [{ started: 9, completed: 6, abandoned: 3, in_progress: 0, abandon_rate: 0.3333, avg_duration_s: 50, median_duration_s: 48, p1_wins: 4, p2_wins: 2 }],
      game_stats_fighter_wins: [{ fighter_id: 'lula', matches: 6, wins: 4, losses: 2, win_rate: 0.6667 }],
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never)

    const d = await getGameAdminData({ from: FROM, to: TO, tz: 'UTC', orgId: 'all' })

    expect(d.matches).toMatchObject({ started: 9, completed: 6, p1_wins: 4, p2_wins: 2 })
    expect(d.wins).toEqual([{ fighter_id: 'lula', matches: 6, wins: 4, losses: 2, win_rate: 0.6667 }])
    expect(admin.rpc.mock.calls.length).toBeGreaterThan(15)
    for (const [fn, args] of admin.rpc.mock.calls as [string, Record<string, unknown>][]) {
      expect(fn.startsWith('game_stats_'), fn).toBe(true)
      expect(args, fn).not.toHaveProperty('p_org_id')
    }
  })

  it('scopes to the chosen organization and passes the segment filters', async () => {
    loginAs(ADMIN)
    const admin = buildAdminClient()
    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never)

    await getGameAdminData({ from: FROM, to: TO, orgId: ORG, gameId: 'brasil-showdown', device: 'mobile', source: 'tiktok', guest: 'signed_in' })

    for (const [fn, args] of admin.rpc.mock.calls as [string, Record<string, unknown>][]) {
      expect(args, fn).toMatchObject({ p_org_id: ORG, p_game_id: 'brasil-showdown', p_guest: false })
    }
    const picks = (admin.rpc.mock.calls as [string, Record<string, unknown>][]).find((c) => c[0] === 'game_stats_pick_counts')!
    expect(picks[1]).toMatchObject({ p_device: 'mobile', p_source: 'tiktok' })
  })

  it('rejects malformed filters without creating a service-role client', async () => {
    loginAs(ADMIN)
    await expect(getGameAdminData({ from: 'x', to: TO })).rejects.toThrow('Invalid filters')
    await expect(getGameAdminData({ from: FROM, to: TO, orgId: "'; drop table organizations;--" })).rejects.toThrow('Invalid filters')
    await expect(getGameAdminData(null as never)).rejects.toThrow('Invalid filters')
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })

  it('surfaces a database error instead of returning partial zeros', async () => {
    loginAs(ADMIN)
    const admin = buildAdminClient()
    admin.rpc.mockImplementation(async (fn: string) =>
      fn === 'game_stats_matchups' ? ({ data: null, error: { message: 'timeout' } } as never) : ({ data: [], error: null } as never),
    )
    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never)
    await expect(getGameAdminData({ from: FROM, to: TO })).rejects.toThrow('game stats game_stats_matchups failed: timeout')
  })
})

describe('getGameAdminOptions', () => {
  it('returns organizations with their names, games and sources', async () => {
    loginAs(ADMIN)
    const admin = buildAdminClient(
      {
        game_stats_games: [{ organization_id: ORG, game_id: 'brasil-showdown', events: 40, players: 6, last_event_at: null }],
        game_stats_error_rate: [{ group_key: 'direct', game_sessions: 5, sessions_with_error: 0, errors: 0, error_rate: 0, crash_free_rate: 1 }],
      },
      [{ id: ORG, name: 'Brasil Showdown' }],
    )
    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never)

    const o = await getGameAdminOptions({ from: FROM, to: TO })

    expect(o).toEqual({
      orgs: [{ id: ORG, name: 'Brasil Showdown', games: ['brasil-showdown'], events: 40 }],
      games: ['brasil-showdown'],
      sources: ['direct'],
    })
    expect(admin.inFilter).toHaveBeenCalledWith('organizations', 'id', [ORG])
  })

  it('rejects an invalid period', async () => {
    loginAs(ADMIN)
    await expect(getGameAdminOptions({ from: TO, to: FROM })).rejects.toThrow('Invalid period')
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })
})

describe('getGameAdminPickSegments', () => {
  it('returns the fighter picks of each segment', async () => {
    loginAs(ADMIN)
    const admin = buildAdminClient({ game_stats_pick_counts: [{ fighter_id: 'lula', picks: 3, share: 1 }] })
    vi.mocked(createServiceRoleClient).mockReturnValue(admin as never)

    const segs = await getGameAdminPickSegments({ from: FROM, to: TO, orgId: ORG }, 'guest')

    expect(segs).toEqual([
      { key: 'guest', label: 'Guests', total: 3, fighters: [{ fighter_id: 'lula', picks: 3, share: 1 }] },
      { key: 'signed_in', label: 'Signed in', total: 3, fighters: [{ fighter_id: 'lula', picks: 3, share: 1 }] },
    ])
  })

  it('rejects an unknown segmentation', async () => {
    loginAs(ADMIN)
    await expect(getGameAdminPickSegments({ from: FROM, to: TO }, 'country' as never)).rejects.toThrow('Invalid filters')
    expect(createServiceRoleClient).not.toHaveBeenCalled()
  })
})

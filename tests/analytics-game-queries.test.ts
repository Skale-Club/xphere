// tests/analytics-game-queries.test.ts
// BS-ANALYTICS-001: typed helpers over the game_stats_* SQL functions.
// The Supabase client is a fake that records rpc() calls and returns canned rows,
// so this proves argument mapping (filters -> p_* args) and result typing. The SQL
// itself is covered by tests/analytics-game-migration.test.ts.

import { describe, it, expect, vi } from 'vitest'
import {
  buildGameStatsArgs,
  getGameFighterPicks,
  getGameSkinPicks,
  getGameStagePicks,
  getGameFighterWins,
  getGameMatchups,
  getGameMatchSummary,
  getGameMatchDaily,
  getGameScreenFunnel,
  getGameScreenTime,
  getGameExitScreens,
  getGameActivePlayers,
  getGameRetention,
  getGameLoadTimes,
  getGameErrorRate,
  getGameErrorBreakdown,
  GAME_DEFAULT_FUNNEL_STEPS,
  type GameStatsClient,
  type GameStatsFilters,
} from '@/lib/analytics/game-queries'

const FROM = new Date('2026-10-01T00:00:00.000Z')
const TO = new Date('2026-10-08T00:00:00.000Z')
const filters: GameStatsFilters = { from: FROM, to: TO }

function fakeClient(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>(
    async () => ({ data, error }),
  )
  return { client: { rpc } as unknown as GameStatsClient, rpc }
}

describe('buildGameStatsArgs', () => {
  it('maps the window as ISO strings and omits unset filters', () => {
    expect(buildGameStatsArgs(filters)).toEqual({
      p_from: '2026-10-01T00:00:00.000Z',
      p_to: '2026-10-08T00:00:00.000Z',
    })
  })

  it('maps every filter', () => {
    expect(
      buildGameStatsArgs({ ...filters, orgId: 'org-1', gameId: 'brasil-showdown', device: 'mobile', source: 'tiktok', guest: false }),
    ).toEqual({
      p_from: '2026-10-01T00:00:00.000Z',
      p_to: '2026-10-08T00:00:00.000Z',
      p_org_id: 'org-1',
      p_game_id: 'brasil-showdown',
      p_device: 'mobile',
      p_source: 'tiktok',
      p_guest: false,
    })
  })

  it('keeps guest = true and drops null / undefined guest', () => {
    expect(buildGameStatsArgs({ ...filters, guest: true }).p_guest).toBe(true)
    expect(buildGameStatsArgs({ ...filters, guest: null })).not.toHaveProperty('p_guest')
    expect(buildGameStatsArgs({ ...filters, guest: undefined })).not.toHaveProperty('p_guest')
  })

  it('can leave device and source out', () => {
    const args = buildGameStatsArgs({ ...filters, device: 'mobile', source: 'x' }, { withDevice: false, withSource: false })
    expect(args).not.toHaveProperty('p_device')
    expect(args).not.toHaveProperty('p_source')
  })
})

describe('picks', () => {
  it('fighter picks call pick_counts with kind=fighter and coerce numbers', async () => {
    const { client, rpc } = fakeClient([{ fighter_id: 'lula', skin_id: null, stage_id: null, picks: '5', share: '0.5556' }])
    const rows = await getGameFighterPicks(client, { ...filters, orgId: 'org-1' })
    expect(rpc).toHaveBeenCalledWith('game_stats_pick_counts', {
      p_from: '2026-10-01T00:00:00.000Z',
      p_to: '2026-10-08T00:00:00.000Z',
      p_org_id: 'org-1',
      p_kind: 'fighter',
    })
    expect(rows).toEqual([{ fighter_id: 'lula', picks: 5, share: 0.5556 }])
  })

  it('includeCpu is sent only when asked for', async () => {
    const { client, rpc } = fakeClient([])
    await getGameFighterPicks(client, filters, { includeCpu: true })
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_include_cpu: true })
    await getGameSkinPicks(client, filters)
    expect(rpc.mock.calls[1][1]).not.toHaveProperty('p_include_cpu')
  })

  it('skin picks keep a null skin', async () => {
    const { client, rpc } = fakeClient([
      { fighter_id: 'lula', skin_id: 'a', picks: 3, share: 0.75 },
      { fighter_id: 'lula', skin_id: null, picks: 1, share: 0.25 },
    ])
    const rows = await getGameSkinPicks(client, filters)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_kind: 'skin' })
    expect(rows).toEqual([
      { fighter_id: 'lula', skin_id: 'a', picks: 3, share: 0.75 },
      { fighter_id: 'lula', skin_id: null, picks: 1, share: 0.25 },
    ])
  })

  it('stage picks use kind=stage', async () => {
    const { client, rpc } = fakeClient([{ stage_id: 'rio', picks: 2, share: 1 }])
    const rows = await getGameStagePicks(client, filters)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_kind: 'stage' })
    expect(rows).toEqual([{ stage_id: 'rio', picks: 2, share: 1 }])
  })
})

describe('wins, matchups and matches', () => {
  it('fighter wins', async () => {
    const { client, rpc } = fakeClient([{ fighter_id: 'lula', matches: 4, wins: '3', losses: 1, win_rate: '0.75' }])
    expect(await getGameFighterWins(client, filters)).toEqual([
      { fighter_id: 'lula', matches: 4, wins: 3, losses: 1, win_rate: 0.75 },
    ])
    expect(rpc.mock.calls[0][0]).toBe('game_stats_fighter_wins')
  })

  it('matchups', async () => {
    const { client } = fakeClient([{ fighter_id: 'lula', opponent_id: 'dilma', matches: 2, wins: 2, win_rate: 1 }])
    expect(await getGameMatchups(client, filters)).toEqual([
      { fighter_id: 'lula', opponent_id: 'dilma', matches: 2, wins: 2, win_rate: 1 },
    ])
  })

  it('match summary maps nulls and numbers', async () => {
    const { client } = fakeClient([
      { started: 5, completed: 2, abandoned: 2, in_progress: 1, abandon_rate: '0.5000', avg_duration_s: '52.75', median_duration_s: null, p1_wins: 1, p2_wins: 1 },
    ])
    expect(await getGameMatchSummary(client, filters)).toEqual({
      started: 5, completed: 2, abandoned: 2, in_progress: 1, abandon_rate: 0.5, avg_duration_s: 52.75, median_duration_s: null, p1_wins: 1, p2_wins: 1,
    })
  })

  it('match summary returns zeros for an empty result', async () => {
    const { client } = fakeClient([])
    expect(await getGameMatchSummary(client, filters)).toEqual({
      started: 0, completed: 0, abandoned: 0, in_progress: 0, abandon_rate: null, avg_duration_s: null, median_duration_s: null, p1_wins: 0, p2_wins: 0,
    })
  })

  it('match daily sends the timezone', async () => {
    const { client, rpc } = fakeClient([{ day: '2026-10-02', started: 3, completed: 2, abandoned: 1 }])
    const rows = await getGameMatchDaily(client, filters, 'America/Sao_Paulo')
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_tz: 'America/Sao_Paulo' })
    expect(rows).toEqual([{ day: '2026-10-02', started: 3, completed: 2, abandoned: 1 }])
  })
})

describe('screens and players', () => {
  it('funnel defaults to the five game screens and sends steps as an array', async () => {
    const { client, rpc } = fakeClient([
      { step_index: 1, screen: 'menu', game_sessions: 10, pct_of_previous: null, pct_of_first: '1.0000' },
      { step_index: 2, screen: 'fighter_select', game_sessions: 6, pct_of_previous: '0.6000', pct_of_first: '0.6000' },
    ])
    const rows = await getGameScreenFunnel(client, filters)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_steps: [...GAME_DEFAULT_FUNNEL_STEPS] })
    expect(rows[1]).toEqual({ step_index: 2, screen: 'fighter_select', game_sessions: 6, pct_of_previous: 0.6, pct_of_first: 0.6 })
    expect(rows[0].pct_of_previous).toBeNull()
  })

  it('funnel accepts custom steps', async () => {
    const { client, rpc } = fakeClient([])
    await getGameScreenFunnel(client, filters, ['title', 'match'])
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_steps: ['title', 'match'] })
  })

  it('screen time and exit screens', async () => {
    const time = fakeClient([{ screen: 'title', samples: 2, avg_seconds: '5.00', median_seconds: '5.00', p95_seconds: null }])
    expect(await getGameScreenTime(time.client, filters)).toEqual([
      { screen: 'title', samples: 2, avg_seconds: 5, median_seconds: 5, p95_seconds: null },
    ])
    const exits = fakeClient([{ screen: 'title', game_sessions: 7, share: '0.7000' }])
    expect(await getGameExitScreens(exits.client, filters)).toEqual([{ screen: 'title', game_sessions: 7, share: 0.7 }])
  })

  it('active players', async () => {
    const { client, rpc } = fakeClient([{ day: '2026-10-02', dau: 2, wau: '3', mau: 4 }])
    expect(await getGameActivePlayers(client, filters, 'America/Sao_Paulo')).toEqual([{ day: '2026-10-02', dau: 2, wau: 3, mau: 4 }])
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_tz: 'America/Sao_Paulo' })
  })

  it('retention ignores device and source filters and keeps immature rates null', async () => {
    const { client, rpc } = fakeClient([
      { cohort_day: '2026-10-01', cohort_size: 4, d1_retained: 2, d7_retained: 1, d30_retained: 0, d1_rate: '0.5000', d7_rate: '0.2500', d30_rate: null },
    ])
    const rows = await getGameRetention(client, { ...filters, device: 'mobile', source: 'tiktok', guest: false })
    const args = rpc.mock.calls[0][1] as Record<string, unknown>
    expect(args).not.toHaveProperty('p_device')
    expect(args).not.toHaveProperty('p_source')
    expect(args.p_guest).toBe(false)
    expect(rows[0]).toEqual({
      cohort_day: '2026-10-01', cohort_size: 4, d1_retained: 2, d7_retained: 1, d30_retained: 0, d1_rate: 0.5, d7_rate: 0.25, d30_rate: null,
    })
  })
})

describe('health', () => {
  it('load times send the group key', async () => {
    const { client, rpc } = fakeClient([
      { group_key: 'mobile', loads: 10, avg_ms: '2100', p50_ms: '1900', p95_ms: '4800', from_cache_share: '0.3000' },
    ])
    const rows = await getGameLoadTimes(client, filters, 'device')
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_group_by: 'device' })
    expect(rows).toEqual([{ group_key: 'mobile', loads: 10, avg_ms: 2100, p50_ms: 1900, p95_ms: 4800, from_cache_share: 0.3 }])
  })

  it('load times default to a single "all" group', async () => {
    const { client, rpc } = fakeClient([])
    await getGameLoadTimes(client, filters)
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_group_by: 'all' })
  })

  it('error rate and breakdown', async () => {
    const rate = fakeClient([
      { group_key: 'web', game_sessions: 20, sessions_with_error: 1, errors: 3, error_rate: '0.0500', crash_free_rate: '0.9500' },
    ])
    expect(await getGameErrorRate(rate.client, filters, 'build')).toEqual([
      { group_key: 'web', game_sessions: 20, sessions_with_error: 1, errors: 3, error_rate: 0.05, crash_free_rate: 0.95 },
    ])
    expect(rate.rpc.mock.calls[0][1]).toMatchObject({ p_group_by: 'build' })

    const breakdown = fakeClient([
      { phase: 'audio', code: 'decode', errors: 2, game_sessions: 1, last_seen_at: '2026-10-02T10:00:00+00:00' },
    ])
    expect(await getGameErrorBreakdown(breakdown.client, filters)).toEqual([
      { phase: 'audio', code: 'decode', errors: 2, game_sessions: 1, last_seen_at: '2026-10-02T10:00:00+00:00' },
    ])
  })
})

describe('errors and empty results', () => {
  it('throws with the function name when the rpc fails', async () => {
    const { client } = fakeClient(null, { message: 'permission denied' })
    await expect(getGameFighterWins(client, filters)).rejects.toThrow('game stats game_stats_fighter_wins failed: permission denied')
  })

  it('treats null data as no rows', async () => {
    const { client } = fakeClient(null)
    expect(await getGameStagePicks(client, filters)).toEqual([])
    expect(await getGameErrorBreakdown(client, filters)).toEqual([])
  })
})

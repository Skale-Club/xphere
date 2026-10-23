// tests/analytics-game-player-queries.test.ts
// BS-ANALYTICS-001: typed helpers over migration 1333. The Supabase client is a
// fake that records rpc() calls and returns canned rows (same pattern as
// tests/analytics-game-queries.test.ts).

import { describe, it, expect, vi } from 'vitest'
import {
  getGamePlayerSummary,
  getGameGames,
  getGamePickTrend,
} from '@/lib/analytics/game-player-queries'
import type { GameStatsClient, GameStatsFilters } from '@/lib/analytics/game-queries'

const filters: GameStatsFilters = {
  from: new Date('2026-10-01T00:00:00.000Z'),
  to: new Date('2026-10-08T00:00:00.000Z'),
}

function fakeClient(data: unknown, error: { message: string } | null = null) {
  const rpc = vi.fn<(fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>>(
    async () => ({ data, error }),
  )
  return { client: { rpc } as unknown as GameStatsClient, rpc }
}

describe('getGamePlayerSummary', () => {
  it('calls the function with the mapped filters and coerces bigint / numeric strings', async () => {
    const { client, rpc } = fakeClient([{
      players: '12', signed_in_players: '5', guest_players: '7', players_with_match: '9',
      matches_started: '27', matches_per_player: '3.00', game_sessions: '20', timed_sessions: '18',
      avg_session_s: '312.5', median_session_s: '240.0', p95_session_s: '900.0',
    }])
    const r = await getGamePlayerSummary(client, { ...filters, orgId: 'org-1', device: 'mobile', guest: false })
    expect(rpc).toHaveBeenCalledWith('game_stats_player_summary', {
      p_from: '2026-10-01T00:00:00.000Z',
      p_to: '2026-10-08T00:00:00.000Z',
      p_org_id: 'org-1',
      p_device: 'mobile',
      p_guest: false,
    })
    expect(r).toEqual({
      players: 12, signed_in_players: 5, guest_players: 7, players_with_match: 9,
      matches_started: 27, matches_per_player: 3, game_sessions: 20, timed_sessions: 18,
      avg_session_s: 312.5, median_session_s: 240, p95_session_s: 900,
    })
  })

  it('keeps unknown averages as null and returns zeros when the function returns no row', async () => {
    const withNulls = await getGamePlayerSummary(
      fakeClient([{ players: 0, matches_per_player: null, avg_session_s: null, median_session_s: null, p95_session_s: null }]).client,
      filters,
    )
    expect(withNulls.matches_per_player).toBeNull()
    expect(withNulls.avg_session_s).toBeNull()

    const none = await getGamePlayerSummary(fakeClient([]).client, filters)
    expect(none.players).toBe(0)
    expect(none.avg_session_s).toBeNull()
  })

  it('throws a readable error when the rpc fails', async () => {
    await expect(getGamePlayerSummary(fakeClient(null, { message: 'permission denied' }).client, filters))
      .rejects.toThrow('game stats game_stats_player_summary failed: permission denied')
  })
})

describe('getGameGames', () => {
  it('only sends the window and the org (device / source / guest do not apply)', async () => {
    const { client, rpc } = fakeClient([
      { organization_id: 'org-1', game_id: 'brasil-showdown', events: '120', players: '14', last_event_at: '2026-10-07T12:00:00Z' },
      { organization_id: 'org-2', game_id: 'unknown', events: 3, players: 1, last_event_at: null },
    ])
    const rows = await getGameGames(client, { ...filters, orgId: 'org-1', device: 'mobile' } as GameStatsFilters)
    expect(rpc).toHaveBeenCalledWith('game_stats_games', {
      p_from: '2026-10-01T00:00:00.000Z',
      p_to: '2026-10-08T00:00:00.000Z',
      p_org_id: 'org-1',
    })
    expect(rows).toEqual([
      { organization_id: 'org-1', game_id: 'brasil-showdown', events: 120, players: 14, last_event_at: '2026-10-07T12:00:00Z' },
      { organization_id: 'org-2', game_id: 'unknown', events: 3, players: 1, last_event_at: null },
    ])
  })
})

describe('getGamePickTrend', () => {
  it('passes kind, time zone and top, and maps rows', async () => {
    const { client, rpc } = fakeClient([{ day: '2026-10-02', item: 'lula', picks: '4' }])
    const rows = await getGamePickTrend(client, 'fighter', { ...filters, source: 'tiktok' }, { tz: 'America/Sao_Paulo', top: 5, includeCpu: true })
    expect(rpc).toHaveBeenCalledWith('game_stats_pick_trend', {
      p_from: '2026-10-01T00:00:00.000Z',
      p_to: '2026-10-08T00:00:00.000Z',
      p_source: 'tiktok',
      p_kind: 'fighter',
      p_tz: 'America/Sao_Paulo',
      p_top: 5,
      p_include_cpu: true,
    })
    expect(rows).toEqual([{ day: '2026-10-02', item: 'lula', picks: 4 }])
  })

  it('defaults to UTC and leaves top and CPU out', async () => {
    const { client, rpc } = fakeClient(null)
    expect(await getGamePickTrend(client, 'stage', filters)).toEqual([])
    const args = rpc.mock.calls[0][1]
    expect(args).toMatchObject({ p_kind: 'stage', p_tz: 'UTC' })
    expect(args).not.toHaveProperty('p_top')
    expect(args).not.toHaveProperty('p_include_cpu')
  })
})

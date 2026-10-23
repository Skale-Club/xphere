// tests/analytics-game-panels.test.ts
// BS-ANALYTICS-001: data loading and view helpers behind the tenant Game tab and
// the admin global game panels (src/lib/analytics/game-panels.ts). The Supabase
// client is a fake that answers rpc() by function name; the SQL itself is covered
// by the migration tests.

import { describe, it, expect, vi } from 'vitest'
import {
  GAME_PANEL_MAX_DAYS,
  buildMatchupMatrix,
  countNewAccounts,
  emptyTenantData,
  enumerateDays,
  fillDays,
  formatDuration,
  formatMs,
  formatPercent,
  groupSkinsByFighter,
  hasGameEvents,
  humanizeId,
  latestActive,
  leastPicked,
  loadGameAdminData,
  loadGameAdminOptions,
  loadGamePickSegments,
  loadGameTenantData,
  mergeBreakdown,
  parseGameAdminInput,
  parseGameRange,
  pivotTrend,
  previousRange,
  retentionSummary,
  safeTimeZone,
  sideAdvantage,
} from '@/lib/analytics/game-panels'
import type { GameStatsClient } from '@/lib/analytics/game-queries'

const FROM = '2026-10-01T00:00:00.000Z'
const TO = '2026-10-08T00:00:00.000Z'
const ORG = '3f2b8c1e-1111-4222-8333-444455556666'

type RpcAnswer = unknown | ((args: Record<string, unknown>) => unknown)

function fakeRpcClient(answers: Record<string, RpcAnswer> = {}, failing: string[] = []) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (failing.includes(fn)) return { data: null, error: { message: `${fn} exploded` } }
    const a = answers[fn]
    const data = typeof a === 'function' ? (a as (x: Record<string, unknown>) => unknown)(args) : a
    return { data: data ?? [], error: null }
  })
  return { client: { rpc } as unknown as GameStatsClient, rpc }
}

function calls(rpc: ReturnType<typeof fakeRpcClient>['rpc'], fn: string) {
  return rpc.mock.calls.filter((c) => c[0] === fn).map((c) => c[1])
}

// A thenable query builder: any chain of filters ends in `result`.
function fakeTableClient(result: { data?: unknown; count?: number | null; error?: { message: string } | null }) {
  const filters: [string, unknown[]][] = []
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'is', 'gte', 'lt', 'limit']) {
    chain[m] = (...args: unknown[]) => { filters.push([m, args]); return chain }
  }
  chain.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, count: null, error: null, ...result })
  const from = vi.fn(() => chain)
  return { client: { from } as unknown as GameStatsClient, from, filters }
}

// ─── Input validation ─────────────────────────────────────────────────────────

describe('safeTimeZone', () => {
  it('keeps valid IANA names and falls back to UTC for anything else', () => {
    expect(safeTimeZone('America/Sao_Paulo')).toBe('America/Sao_Paulo')
    expect(safeTimeZone('UTC')).toBe('UTC')
    expect(safeTimeZone('Mars/Olympus')).toBe('UTC')
    expect(safeTimeZone("UTC'; drop table x;--")).toBe('UTC')
    expect(safeTimeZone('')).toBe('UTC')
    expect(safeTimeZone(undefined)).toBe('UTC')
    expect(safeTimeZone(42)).toBe('UTC')
    expect(safeTimeZone('a'.repeat(65))).toBe('UTC')
  })
})

describe('parseGameRange', () => {
  it('accepts an ordered ISO window', () => {
    const r = parseGameRange(FROM, TO)
    expect(r?.from.toISOString()).toBe(FROM)
    expect(r?.to.toISOString()).toBe(TO)
  })

  it('rejects bad dates, empty or reversed windows and windows over the limit', () => {
    expect(parseGameRange('nope', TO)).toBeNull()
    expect(parseGameRange(FROM, undefined)).toBeNull()
    expect(parseGameRange(TO, FROM)).toBeNull()
    expect(parseGameRange(FROM, FROM)).toBeNull()
    const tooLong = new Date(new Date(FROM).getTime() + (GAME_PANEL_MAX_DAYS + 1) * 86_400_000).toISOString()
    expect(parseGameRange(FROM, tooLong)).toBeNull()
    const atLimit = new Date(new Date(FROM).getTime() + GAME_PANEL_MAX_DAYS * 86_400_000).toISOString()
    expect(parseGameRange(FROM, atLimit)).not.toBeNull()
  })
})

describe('parseGameAdminInput', () => {
  it('normalizes an all-organizations request with no filters', () => {
    const f = parseGameAdminInput({ from: FROM, to: TO, orgId: 'all', device: 'all', source: '', guest: 'all' })
    expect(f).not.toBeNull()
    expect(f!.tz).toBe('UTC')
    expect(f!.guest).toBe('all')
    expect(f!.stats).toMatchObject({ orgId: null, gameId: null, device: null, source: null, guest: null })
  })

  it('maps every filter, lowercasing the org id and the source and mapping guest to a boolean', () => {
    const f = parseGameAdminInput({
      from: FROM, to: TO, tz: 'America/Sao_Paulo', orgId: ORG.toUpperCase(), gameId: 'brasil-showdown',
      device: 'mobile', source: ' TikTok ', guest: 'signed_in',
    })
    expect(f!.tz).toBe('America/Sao_Paulo')
    expect(f!.stats).toMatchObject({ orgId: ORG, gameId: 'brasil-showdown', device: 'mobile', source: 'tiktok', guest: false })
    expect(parseGameAdminInput({ from: FROM, to: TO, guest: 'guest' })!.stats.guest).toBe(true)
  })

  it('rejects malformed input instead of passing it to the database', () => {
    const ok = { from: FROM, to: TO }
    expect(parseGameAdminInput(null)).toBeNull()
    expect(parseGameAdminInput('x')).toBeNull()
    expect(parseGameAdminInput({ ...ok, orgId: 'not-a-uuid' })).toBeNull()
    expect(parseGameAdminInput({ ...ok, orgId: 7 })).toBeNull()
    expect(parseGameAdminInput({ ...ok, gameId: 'Bad Game!' })).toBeNull()
    expect(parseGameAdminInput({ ...ok, device: 'toaster' })).toBeNull()
    expect(parseGameAdminInput({ ...ok, source: "x'; select 1" })).toBeNull()
    expect(parseGameAdminInput({ ...ok, guest: 'maybe' })).toBeNull()
    expect(parseGameAdminInput({ from: 'bad', to: TO })).toBeNull()
  })

  it('falls back to UTC for an invalid time zone instead of failing', () => {
    expect(parseGameAdminInput({ from: FROM, to: TO, tz: 'Nowhere/City' })!.tz).toBe('UTC')
  })
})

// ─── Probes ───────────────────────────────────────────────────────────────────

describe('hasGameEvents', () => {
  const range = parseGameRange(FROM, TO)!

  it('is true when a game event exists, scoped to the org, type and window', async () => {
    const { client, from, filters } = fakeTableClient({ data: [{ id: 'e1' }] })
    expect(await hasGameEvents(client, 'org-1', range)).toBe(true)
    expect(from).toHaveBeenCalledWith('analytics_events')
    expect(filters).toContainEqual(['eq', ['organization_id', 'org-1']])
    expect(filters).toContainEqual(['eq', ['event_type', 'game']])
    expect(filters).toContainEqual(['gte', ['occurred_at', FROM]])
    expect(filters).toContainEqual(['lt', ['occurred_at', TO]])
    expect(filters).toContainEqual(['limit', [1]])
  })

  it('is false when there is none and throws on a query error', async () => {
    expect(await hasGameEvents(fakeTableClient({ data: [] }).client, 'org-1', range)).toBe(false)
    await expect(hasGameEvents(fakeTableClient({ error: { message: 'boom' } }).client, 'org-1', range)).rejects.toThrow('boom')
  })
})

describe('countNewAccounts', () => {
  const range = parseGameRange(FROM, TO)!

  it('counts unmerged contacts created in the window', async () => {
    const { client, from, filters } = fakeTableClient({ count: 12 })
    expect(await countNewAccounts(client, range)).toBe(12)
    expect(from).toHaveBeenCalledWith('contacts')
    expect(filters).toContainEqual(['is', ['merged_into_contact_id', null]])
    expect(filters).toContainEqual(['gte', ['created_at', FROM]])
    expect(filters).toContainEqual(['lt', ['created_at', TO]])
  })

  it('returns null instead of failing the panel when contacts cannot be read', async () => {
    expect(await countNewAccounts(fakeTableClient({ error: { message: 'rls' } }).client, range)).toBeNull()
    expect(await countNewAccounts(fakeTableClient({ count: null }).client, range)).toBeNull()
  })
})

// ─── Breakdowns ───────────────────────────────────────────────────────────────

describe('mergeBreakdown', () => {
  it('joins error-rate and load-time rows per group with shares of all sessions', () => {
    const rows = mergeBreakdown(
      [
        { group_key: 'desktop', game_sessions: 30, sessions_with_error: 3, errors: 4, error_rate: 0.1, crash_free_rate: 0.9 },
        { group_key: 'mobile', game_sessions: 10, sessions_with_error: 0, errors: 0, error_rate: 0, crash_free_rate: 1 },
      ],
      [
        { group_key: 'mobile', loads: 8, avg_ms: 3200, p50_ms: 3000, p95_ms: 6000, from_cache_share: 0.5 },
        { group_key: 'tablet', loads: 2, avg_ms: 1000, p50_ms: 1000, p95_ms: 1200, from_cache_share: 0 },
      ],
    )
    expect(rows.map((r) => r.key)).toEqual(['desktop', 'mobile', 'tablet'])
    expect(rows[0]).toMatchObject({ key: 'desktop', sessions: 30, share: 0.75, error_rate: 0.1, loads: 0, load_p50_ms: null })
    expect(rows[1]).toMatchObject({ key: 'mobile', sessions: 10, share: 0.25, error_rate: 0, loads: 8, load_p50_ms: 3000, load_p95_ms: 6000 })
    expect(rows[2]).toMatchObject({ key: 'tablet', sessions: 0, share: 0, error_rate: null, load_p50_ms: 1000 })
  })

  it('is empty without data and never divides by zero', () => {
    expect(mergeBreakdown([], [])).toEqual([])
    expect(mergeBreakdown([{ group_key: 'x', game_sessions: 0, sessions_with_error: 0, errors: 0, error_rate: null, crash_free_rate: null }], [])[0].share).toBe(0)
  })
})

// ─── Tenant loader ────────────────────────────────────────────────────────────

describe('loadGameTenantData', () => {
  const range = parseGameRange(FROM, TO)!

  it('does not run any rollup when the org has no game events', async () => {
    const { client, rpc } = fakeRpcClient()
    const table = fakeTableClient({ data: [] })
    const mixed = { rpc, from: table.from } as unknown as GameStatsClient
    expect(await loadGameTenantData(mixed, 'org-1', range)).toEqual(emptyTenantData())
    expect(rpc).not.toHaveBeenCalled()
    expect(client).toBeDefined()
  })

  it('loads every panel for the org and window and maps the rows', async () => {
    const { rpc } = fakeRpcClient({
      game_stats_player_summary: [{ players: '10', signed_in_players: '4', guest_players: '6', players_with_match: '8', matches_started: '20', matches_per_player: '2.50', game_sessions: '15', timed_sessions: '12', avg_session_s: '300', median_session_s: '200', p95_session_s: '900' }],
      game_stats_active_players: [{ day: '2026-10-06', dau: 3, wau: 6, mau: 9 }, { day: '2026-10-07', dau: '4', wau: '7', mau: '10' }],
      game_stats_match_summary: [{ started: 20, completed: 12, abandoned: 6, in_progress: 2, abandon_rate: '0.3333', avg_duration_s: '75.5', median_duration_s: '70', p1_wins: 7, p2_wins: 5 }],
      game_stats_pick_counts: (args) => (args.p_kind === 'stage'
        ? [{ stage_id: 'rio', picks: 9, share: 0.6 }]
        : args.p_kind === 'skin'
          ? [{ fighter_id: 'lula', skin_id: 'a', picks: 5, share: 0.5 }]
          : [{ fighter_id: 'lula', picks: 7, share: 0.7 }]),
      game_stats_load_times: (args) => (args.p_group_by === 'device'
        ? [{ group_key: 'desktop', loads: 5, avg_ms: 900, p50_ms: 800, p95_ms: 1500, from_cache_share: 0.2 }]
        : args.p_group_by === 'all'
          ? [{ group_key: 'all', loads: 9, avg_ms: 1000, p50_ms: 900, p95_ms: 2000, from_cache_share: 0.4 }]
          : []),
      game_stats_error_rate: (args) => (args.p_group_by === 'device'
        ? [{ group_key: 'desktop', game_sessions: 15, sessions_with_error: 1, errors: 2, error_rate: 0.0667, crash_free_rate: 0.9333 }]
        : args.p_group_by === 'all'
          ? [{ group_key: 'all', game_sessions: 15, sessions_with_error: 1, errors: 2, error_rate: 0.0667, crash_free_rate: 0.9333 }]
          : []),
      game_stats_error_breakdown: [{ phase: 'audio', code: 'decode', errors: 2, game_sessions: 1, last_seen_at: '2026-10-07T10:00:00Z' }],
    })
    const table = fakeTableClient({ data: [{ id: 'e1' }], count: 5 })
    const client = { rpc, from: table.from } as unknown as GameStatsClient

    const d = await loadGameTenantData(client, 'org-1', range, 'America/Sao_Paulo')

    expect(d.hasEvents).toBe(true)
    expect(d.newAccounts).toBe(5)
    expect(d.players).toMatchObject({ players: 10, signed_in_players: 4, guest_players: 6, matches_per_player: 2.5, avg_session_s: 300 })
    expect(latestActive(d.active)).toEqual({ dau: 4, wau: 7, mau: 10 })
    expect(d.matches).toMatchObject({ started: 20, completed: 12, abandoned: 6, p1_wins: 7 })
    expect(d.fighters).toEqual([{ fighter_id: 'lula', picks: 7, share: 0.7 }])
    expect(d.skins).toEqual([{ fighter_id: 'lula', skin_id: 'a', picks: 5, share: 0.5 }])
    expect(d.stages).toEqual([{ stage_id: 'rio', picks: 9, share: 0.6 }])
    expect(d.load).toMatchObject({ p50_ms: 900, p95_ms: 2000 })
    expect(d.errors).toMatchObject({ errors: 2, crash_free_rate: 0.9333 })
    expect(d.errorBreakdown[0]).toMatchObject({ phase: 'audio', code: 'decode' })
    expect(d.breakdowns.device[0]).toMatchObject({ key: 'desktop', sessions: 15, share: 1, load_p50_ms: 800, error_rate: 0.0667 })
    expect(d.breakdowns.browser).toEqual([])
    expect(Object.keys(d.breakdowns).sort()).toEqual(['browser', 'connection', 'device', 'os', 'source'])

    // Every rollup was asked for this org and this window; day buckets use the browser zone.
    for (const [fn, args] of rpc.mock.calls) {
      expect(args, fn).toMatchObject({ p_from: FROM, p_to: TO, p_org_id: 'org-1' })
    }
    expect(calls(rpc, 'game_stats_active_players')[0]).toMatchObject({ p_tz: 'America/Sao_Paulo' })
    expect(calls(rpc, 'game_stats_match_daily')[0]).toMatchObject({ p_tz: 'America/Sao_Paulo' })
    expect(calls(rpc, 'game_stats_screen_funnel')[0]).toMatchObject({
      p_steps: ['title', 'fighter_select', 'stage_select', 'match', 'post_match'],
    })
    // The tenant never filters by guest or device on its own.
    for (const [, args] of rpc.mock.calls) {
      expect(args).not.toHaveProperty('p_guest')
      expect(args).not.toHaveProperty('p_device')
    }
  })

  it('propagates a rollup failure so the tab shows an error instead of wrong zeros', async () => {
    const { rpc } = fakeRpcClient({}, ['game_stats_retention'])
    const client = { rpc, from: fakeTableClient({ data: [{ id: 'e1' }] }).from } as unknown as GameStatsClient
    await expect(loadGameTenantData(client, 'org-1', range)).rejects.toThrow('game stats game_stats_retention failed: game_stats_retention exploded')
  })
})

// ─── Admin loader ─────────────────────────────────────────────────────────────

describe('loadGameAdminData', () => {
  it('asks every global panel for the chosen filters; no org filter means all organizations', async () => {
    const { client, rpc } = fakeRpcClient({
      game_stats_fighter_wins: [{ fighter_id: 'lula', matches: 10, wins: '6', losses: 4, win_rate: '0.6' }],
      game_stats_matchups: [{ fighter_id: 'lula', opponent_id: 'dilma', matches: 4, wins: 3, win_rate: 0.75 }],
      game_stats_pick_trend: (args) => [{ day: '2026-10-02', item: args.p_kind === 'stage' ? 'rio' : 'lula', picks: 3 }],
    })
    const filters = parseGameAdminInput({ from: FROM, to: TO, tz: 'UTC', device: 'mobile', guest: 'guest' })!
    const d = await loadGameAdminData(client, filters)

    expect(d.wins).toEqual([{ fighter_id: 'lula', matches: 10, wins: 6, losses: 4, win_rate: 0.6 }])
    expect(d.matchups[0]).toMatchObject({ fighter_id: 'lula', opponent_id: 'dilma', win_rate: 0.75 })
    expect(d.trends.fighters).toEqual([{ day: '2026-10-02', item: 'lula', picks: 3 }])
    expect(d.trends.stages[0].item).toBe('rio')
    expect(d.load.all).toBeNull()
    expect(d.errors.all).toBeNull()

    for (const [fn, args] of rpc.mock.calls) {
      expect(args, fn).toMatchObject({ p_from: FROM, p_to: TO })
      expect(args, fn).not.toHaveProperty('p_org_id')
    }
    // device / guest apply everywhere except retention, which ignores device (and source) by design.
    for (const [fn, args] of rpc.mock.calls) {
      expect(args, fn).toMatchObject({ p_guest: true })
      if (fn !== 'game_stats_retention') expect(args, fn).toMatchObject({ p_device: 'mobile' })
      else expect(args).not.toHaveProperty('p_device')
    }
    const groupBys = rpc.mock.calls.filter((c) => c[0] === 'game_stats_load_times' || c[0] === 'game_stats_error_rate').map((c) => `${c[0]}:${c[1].p_group_by}`)
    expect(groupBys.sort()).toEqual([
      'game_stats_error_rate:all', 'game_stats_error_rate:browser', 'game_stats_error_rate:build',
      'game_stats_load_times:all', 'game_stats_load_times:connection', 'game_stats_load_times:device',
    ])
  })

  it('scopes every call to the chosen organization', async () => {
    const { client, rpc } = fakeRpcClient()
    await loadGameAdminData(client, parseGameAdminInput({ from: FROM, to: TO, orgId: ORG })!)
    expect(rpc.mock.calls.length).toBeGreaterThan(15)
    for (const [fn, args] of rpc.mock.calls) expect(args, fn).toMatchObject({ p_org_id: ORG })
  })
})

describe('loadGameAdminOptions', () => {
  it('groups games per organization, resolves names and lists traffic sources', async () => {
    const { client, rpc } = fakeRpcClient({
      game_stats_games: [
        { organization_id: 'org-a', game_id: 'brasil-showdown', events: 100, players: 9, last_event_at: null },
        { organization_id: 'org-a', game_id: 'rural-racing', events: 20, players: 3, last_event_at: null },
        { organization_id: 'org-b', game_id: 'brasil-showdown', events: 500, players: 40, last_event_at: null },
      ],
      game_stats_error_rate: [
        { group_key: 'direct', game_sessions: 10, sessions_with_error: 0, errors: 0, error_rate: 0, crash_free_rate: 1 },
        { group_key: 'tiktok', game_sessions: 5, sessions_with_error: 0, errors: 0, error_rate: 0, crash_free_rate: 1 },
      ],
    })
    const names = vi.fn(async (ids: string[]) => Object.fromEntries(ids.map((id) => [id, id === 'org-a' ? 'Org A' : 'Brasil Showdown'])))
    const o = await loadGameAdminOptions(client, parseGameRange(FROM, TO)!, names)
    expect(o.orgs.map((x) => [x.id, x.name, x.games, x.events])).toEqual([
      ['org-b', 'Brasil Showdown', ['brasil-showdown'], 500],
      ['org-a', 'Org A', ['brasil-showdown', 'rural-racing'], 120],
    ])
    expect(o.games).toEqual(['brasil-showdown', 'rural-racing'])
    expect(o.sources).toEqual(['direct', 'tiktok'])
    expect(names).toHaveBeenCalledWith(expect.arrayContaining(['org-a', 'org-b']))
    expect(calls(rpc, 'game_stats_error_rate')[0]).toMatchObject({ p_group_by: 'source' })
  })

  it('does not look up names when nothing has events', async () => {
    const names = vi.fn(async () => ({}))
    const o = await loadGameAdminOptions(fakeRpcClient().client, parseGameRange(FROM, TO)!, names)
    expect(o).toEqual({ orgs: [], games: [], sources: [] })
    expect(names).not.toHaveBeenCalled()
  })
})

describe('loadGamePickSegments', () => {
  const picks = (n: number) => [{ fighter_id: 'lula', picks: n, share: 1 }]

  it('compares this period with the previous one of the same length', async () => {
    const { client, rpc } = fakeRpcClient({
      game_stats_pick_counts: (a) => (a.p_from === FROM ? picks(8) : picks(3)),
    })
    const segs = await loadGamePickSegments(client, parseGameAdminInput({ from: FROM, to: TO })!, 'period')
    expect(segs.map((s) => [s.key, s.total])).toEqual([['current', 8], ['previous', 3]])
    expect(calls(rpc, 'game_stats_pick_counts')[1]).toMatchObject({ p_from: '2026-09-24T00:00:00.000Z', p_to: FROM })
  })

  it('splits by device, ignoring the device filter, and keeps the other filters', async () => {
    const { client, rpc } = fakeRpcClient({ game_stats_pick_counts: picks(2) })
    const segs = await loadGamePickSegments(client, parseGameAdminInput({ from: FROM, to: TO, device: 'tablet', source: 'tiktok' })!, 'device')
    expect(segs.map((s) => s.key)).toEqual(['desktop', 'mobile', 'tablet'])
    expect(calls(rpc, 'game_stats_pick_counts').map((a) => a.p_device)).toEqual(['desktop', 'mobile', 'tablet'])
    for (const a of calls(rpc, 'game_stats_pick_counts')) expect(a).toMatchObject({ p_source: 'tiktok', p_kind: 'fighter' })
  })

  it('splits guests from signed-in players', async () => {
    const { client, rpc } = fakeRpcClient({ game_stats_pick_counts: picks(1) })
    const segs = await loadGamePickSegments(client, parseGameAdminInput({ from: FROM, to: TO, guest: 'guest' })!, 'guest')
    expect(segs.map((s) => s.key)).toEqual(['guest', 'signed_in'])
    expect(calls(rpc, 'game_stats_pick_counts').map((a) => a.p_guest)).toEqual([true, false])
  })

  it('splits by the five busiest sources', async () => {
    const sources = ['direct', 'tiktok', 'google', 'youtube', 'instagram', 'facebook', 'x'].map((k, i) => ({
      group_key: k, game_sessions: 100 - i, sessions_with_error: 0, errors: 0, error_rate: 0, crash_free_rate: 1,
    }))
    const { client, rpc } = fakeRpcClient({ game_stats_error_rate: sources, game_stats_pick_counts: picks(1) })
    const segs = await loadGamePickSegments(client, parseGameAdminInput({ from: FROM, to: TO, source: 'x' })!, 'source')
    expect(segs.map((s) => s.key)).toEqual(['direct', 'tiktok', 'google', 'youtube', 'instagram'])
    expect(calls(rpc, 'game_stats_pick_counts').map((a) => a.p_source)).toEqual(['direct', 'tiktok', 'google', 'youtube', 'instagram'])
    // the source ranking itself ignores the source filter
    expect(calls(rpc, 'game_stats_error_rate')[0]).not.toHaveProperty('p_source')
  })
})

// ─── Pure helpers ─────────────────────────────────────────────────────────────

describe('picks helpers', () => {
  it('leastPicked sorts ascending and limits', () => {
    const rows = [{ id: 'a', picks: 9 }, { id: 'b', picks: 1 }, { id: 'c', picks: 4 }]
    expect(leastPicked(rows, 2).map((r) => r.id)).toEqual(['b', 'c'])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b', 'c']) // input untouched
  })

  it('groupSkinsByFighter totals per fighter, shares within the fighter, biggest first', () => {
    const groups = groupSkinsByFighter([
      { fighter_id: 'dilma', skin_id: 'b', picks: 2, share: 0.1 },
      { fighter_id: 'lula', skin_id: 'a', picks: 6, share: 0.3 },
      { fighter_id: 'lula', skin_id: null, picks: 2, share: 0.1 },
      { fighter_id: 'lula', skin_id: 'c', picks: 4, share: 0.2 },
    ])
    expect(groups.map((g) => [g.fighter_id, g.total])).toEqual([['lula', 12], ['dilma', 2]])
    expect(groups[0].skins.map((s) => [s.skin_id, s.picks, Number(s.share.toFixed(3))])).toEqual([['a', 6, 0.5], ['c', 4, 0.333], [null, 2, 0.167]])
    expect(groupSkinsByFighter([])).toEqual([])
  })
})

describe('buildMatchupMatrix', () => {
  it('lists fighters alphabetically and keeps each directed cell', () => {
    const m = buildMatchupMatrix([
      { fighter_id: 'lula', opponent_id: 'dilma', matches: 4, wins: 3, win_rate: 0.75 },
      { fighter_id: 'dilma', opponent_id: 'lula', matches: 4, wins: 1, win_rate: 0.25 },
      { fighter_id: 'lula', opponent_id: 'bolsonaro', matches: 2, wins: 1, win_rate: 0.5 },
    ])
    expect(m.fighters).toEqual(['bolsonaro', 'dilma', 'lula'])
    expect(m.cells.lula.dilma).toEqual({ matches: 4, wins: 3, win_rate: 0.75 })
    expect(m.cells.dilma.lula.win_rate).toBe(0.25)
    expect(m.cells.bolsonaro).toBeUndefined() // no row for bolsonaro as the first fighter
    expect(buildMatchupMatrix([])).toEqual({ fighters: [], cells: {} })
  })
})

describe('sideAdvantage', () => {
  it('reports the share of decided matches won by each side', () => {
    const s = sideAdvantage({ p1_wins: 60, p2_wins: 40 })
    expect(s).toMatchObject({ decided: 100, p1_share: 0.6, p2_share: 0.4 })
    expect(s.edge).toBeCloseTo(0.2)
    expect(sideAdvantage({ p1_wins: 3, p2_wins: 7 }).edge).toBeCloseTo(-0.4)
  })

  it('has no shares before any match is decided', () => {
    expect(sideAdvantage({ p1_wins: 0, p2_wins: 0 })).toEqual({ p1_wins: 0, p2_wins: 0, decided: 0, p1_share: null, p2_share: null, edge: null })
  })
})

describe('days and trends', () => {
  it('enumerateDays lists each local calendar day of the window', () => {
    expect(enumerateDays(parseGameRange('2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z')!)).toEqual(['2026-10-01', '2026-10-02', '2026-10-03'])
    // 03:00 UTC is midnight in Sao Paulo (UTC-3): the same instants are a different day list
    expect(enumerateDays(parseGameRange('2026-10-01T03:00:00Z', '2026-10-03T03:00:00Z')!, 'America/Sao_Paulo')).toEqual(['2026-10-01', '2026-10-02'])
    expect(enumerateDays(parseGameRange('2026-10-01T10:00:00Z', '2026-10-01T12:00:00Z')!)).toEqual(['2026-10-01'])
  })

  it('enumerateDays has no gap or repeat across a daylight saving change', () => {
    const days = enumerateDays(parseGameRange('2026-10-24T00:00:00Z', '2026-11-03T00:00:00Z')!, 'America/New_York')
    expect(new Set(days).size).toBe(days.length)
    expect(days[0]).toBe('2026-10-23')
    expect(days).toContain('2026-11-01')
    expect(days[days.length - 1]).toBe('2026-11-02')
    for (let i = 1; i < days.length; i++) {
      const gap = (Date.parse(days[i]) - Date.parse(days[i - 1])) / 86_400_000
      expect(gap).toBe(1)
    }
  })

  it('fillDays keeps real rows and zero-fills the missing days', () => {
    const rows = [{ day: '2026-10-02', started: 4 }]
    expect(fillDays(rows, ['2026-10-01', '2026-10-02', '2026-10-03'], (day) => ({ day, started: 0 }))).toEqual([
      { day: '2026-10-01', started: 0 },
      { day: '2026-10-02', started: 4 },
      { day: '2026-10-03', started: 0 },
    ])
  })

  it('pivotTrend orders items by total picks and zero-fills the grid', () => {
    const t = pivotTrend(
      [
        { day: '2026-10-01', item: 'dilma', picks: 1 },
        { day: '2026-10-01', item: 'lula', picks: 2 },
        { day: '2026-10-03', item: 'lula', picks: 5 },
      ],
      ['2026-10-01', '2026-10-02', '2026-10-03'],
    )
    expect(t.items).toEqual(['lula', 'dilma'])
    expect(t.points).toEqual([
      { day: '2026-10-01', lula: 2, dilma: 1 },
      { day: '2026-10-02', lula: 0, dilma: 0 },
      { day: '2026-10-03', lula: 5, dilma: 0 },
    ])
    expect(pivotTrend([], ['2026-10-01'])).toEqual({ items: [], points: [{ day: '2026-10-01' }] })
  })

  it('previousRange is the same length immediately before', () => {
    const p = previousRange(parseGameRange(FROM, TO)!)
    expect(p.from.toISOString()).toBe('2026-09-24T00:00:00.000Z')
    expect(p.to.toISOString()).toBe(FROM)
  })
})

describe('players helpers', () => {
  it('latestActive reads the last day and is zero without data', () => {
    expect(latestActive([{ day: 'a', dau: 1, wau: 2, mau: 3 }, { day: 'b', dau: 4, wau: 5, mau: 6 }])).toEqual({ dau: 4, wau: 5, mau: 6 })
    expect(latestActive([])).toEqual({ dau: 0, wau: 0, mau: 0 })
  })

  it('retentionSummary weights cohorts by size and skips cohorts too young to measure', () => {
    const r = retentionSummary([
      { cohort_day: '2026-09-01', cohort_size: 10, d1_retained: 5, d7_retained: 2, d30_retained: 1, d1_rate: 0.5, d7_rate: 0.2, d30_rate: 0.1 },
      { cohort_day: '2026-09-20', cohort_size: 30, d1_retained: 9, d7_retained: 3, d30_retained: 0, d1_rate: 0.3, d7_rate: 0.1, d30_rate: null },
      { cohort_day: '2026-10-07', cohort_size: 100, d1_retained: 0, d7_retained: 0, d30_retained: 0, d1_rate: null, d7_rate: null, d30_rate: null },
    ])
    expect(r.d1).toBeCloseTo(14 / 40)
    expect(r.d7).toBeCloseTo(5 / 40)
    expect(r.d30).toBeCloseTo(1 / 10)
    expect(retentionSummary([])).toEqual({ d1: null, d7: null, d30: null })
  })
})

describe('formatters', () => {
  it('formatDuration', () => {
    expect(formatDuration(null)).toBe('-')
    expect(formatDuration(42.4)).toBe('42s')
    expect(formatDuration(65)).toBe('1m 05s')
    expect(formatDuration(7380)).toBe('2h 03m')
  })

  it('formatPercent and formatMs', () => {
    expect(formatPercent(0.4567)).toBe('45.7%')
    expect(formatPercent(0.5, 0)).toBe('50%')
    expect(formatPercent(null)).toBe('-')
    expect(formatMs(420)).toBe('420 ms')
    expect(formatMs(1830)).toBe('1.8 s')
    expect(formatMs(undefined)).toBe('-')
  })

  it('humanizeId', () => {
    expect(humanizeId('fighter_select')).toBe('Fighter select')
    expect(humanizeId('rio-de-janeiro')).toBe('Rio de janeiro')
    expect(humanizeId(null)).toBe('-')
  })
})

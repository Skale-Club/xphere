// Typed helpers over the migration 1333 functions (player summary, games list,
// daily pick trend). Same conventions as game-queries.ts: pass the authenticated
// server client for the tenant panel (RLS cuts to the caller's org) or the
// service-role client for the admin panel; time window is [from, to); numbers
// are coerced from bigint / numeric strings; shares and rates are 0..1.

import {
  buildGameStatsArgs,
  type GameStatsClient,
  type GameStatsFilters,
} from '@/lib/analytics/game-queries'

export interface GamePlayerSummary {
  /** Distinct actors (signed-in player id, else browser visitor) with a game event. */
  players: number
  signed_in_players: number
  guest_players: number
  players_with_match: number
  matches_started: number
  /** matches_started / players_with_match; null when nobody played. */
  matches_per_player: number | null
  game_sessions: number
  /** Sessions with at least two events and a length of at most 4 hours. */
  timed_sessions: number
  avg_session_s: number | null
  median_session_s: number | null
  p95_session_s: number | null
}

export interface GameGameRow {
  organization_id: string
  game_id: string
  events: number
  players: number
  last_event_at: string | null
}

export interface GamePickTrendRow { day: string; item: string; picks: number }

export type GamePickKind = 'fighter' | 'skin' | 'stage'

type RpcArgs = Record<string, string | number | boolean | string[]>

function num(value: unknown): number {
  if (typeof value === 'number') return value
  if (typeof value === 'string' && value.trim() !== '') return Number(value)
  return 0
}

function numOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

async function callRpc(supabase: GameStatsClient, fn: string, args: RpcArgs): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(`game stats ${fn} failed: ${error.message}`)
  return (data ?? []) as Record<string, unknown>[]
}

const EMPTY_PLAYER_SUMMARY: GamePlayerSummary = {
  players: 0,
  signed_in_players: 0,
  guest_players: 0,
  players_with_match: 0,
  matches_started: 0,
  matches_per_player: null,
  game_sessions: 0,
  timed_sessions: 0,
  avg_session_s: null,
  median_session_s: null,
  p95_session_s: null,
}

export async function getGamePlayerSummary(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
): Promise<GamePlayerSummary> {
  const rows = await callRpc(supabase, 'game_stats_player_summary', buildGameStatsArgs(filters))
  const r = rows[0]
  if (!r) return { ...EMPTY_PLAYER_SUMMARY }
  return {
    players: num(r.players),
    signed_in_players: num(r.signed_in_players),
    guest_players: num(r.guest_players),
    players_with_match: num(r.players_with_match),
    matches_started: num(r.matches_started),
    matches_per_player: numOrNull(r.matches_per_player),
    game_sessions: num(r.game_sessions),
    timed_sessions: num(r.timed_sessions),
    avg_session_s: numOrNull(r.avg_session_s),
    median_session_s: numOrNull(r.median_session_s),
    p95_session_s: numOrNull(r.p95_session_s),
  }
}

/** Organizations / games that have game events in the window (device, source and guest do not apply). */
export async function getGameGames(
  supabase: GameStatsClient,
  filters: Pick<GameStatsFilters, 'from' | 'to' | 'orgId'>,
): Promise<GameGameRow[]> {
  const rows = await callRpc(supabase, 'game_stats_games', buildGameStatsArgs({ from: filters.from, to: filters.to, orgId: filters.orgId }))
  return rows.map((r) => ({
    organization_id: String(r.organization_id),
    game_id: String(r.game_id),
    events: num(r.events),
    players: num(r.players),
    last_event_at: r.last_event_at === null || r.last_event_at === undefined ? null : String(r.last_event_at),
  }))
}

export interface PickTrendOptions {
  /** Count the p2 side when it is a CPU too. Default false (human picks only). */
  includeCpu?: boolean
  /** How many of the most picked items to return a series for. Default 8. */
  top?: number
  /** IANA time zone for the day buckets. Default UTC. */
  tz?: string
}

export async function getGamePickTrend(
  supabase: GameStatsClient,
  kind: GamePickKind,
  filters: GameStatsFilters,
  options: PickTrendOptions = {},
): Promise<GamePickTrendRow[]> {
  const args: RpcArgs = { ...buildGameStatsArgs(filters), p_kind: kind, p_tz: options.tz ?? 'UTC' }
  if (options.includeCpu) args.p_include_cpu = true
  if (options.top !== undefined) args.p_top = options.top
  const rows = await callRpc(supabase, 'game_stats_pick_trend', args)
  return rows.map((r) => ({ day: String(r.day), item: String(r.item), picks: num(r.picks) }))
}

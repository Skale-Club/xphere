// Typed helpers over the game_stats_* SQL functions (migration 1332).
//
// Both clients work:
//   * tenant panel   -> pass the authenticated server client (createClient()).
//     RLS limits every row to the caller's organization; orgId is optional.
//   * admin panel    -> pass createServiceRoleClient() after the PLATFORM_ADMIN
//     gate in src/app/(admin)/layout.tsx. orgId omitted = every organization.
//
// Time window is [from, to). Day buckets use `tz` (IANA name, default UTC).
// Rows keep the SQL column names (snake_case) like the rest of lib/analytics;
// bigint / numeric values are coerced to numbers, shares and rates are 0..1.

import type { SupabaseClient } from '@supabase/supabase-js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GameStatsClient = SupabaseClient<any, any, any>

export type GameDevice = 'desktop' | 'mobile' | 'tablet' | 'unknown'

export interface GameStatsFilters {
  from: Date
  to: Date
  /** Restrict to one organization. Omit / null = all the caller can see. */
  orgId?: string | null
  gameId?: string | null
  device?: GameDevice | null
  /** utm_source (lowercase) or referrer host, or "direct". */
  source?: string | null
  /** true = guests only, false = signed-in players only, null/undefined = both. */
  guest?: boolean | null
}

/** Breakdown keys accepted by the load-time and error-rate functions. */
export type GameGroupBy =
  | 'all'
  | 'device'
  | 'browser'
  | 'os'
  | 'connection'
  | 'build'
  | 'version'
  | 'source'
  | 'country'

export const GAME_DEFAULT_FUNNEL_STEPS = [
  'title',
  'fighter_select',
  'stage_select',
  'match',
  'post_match',
] as const

// ─── Row types ────────────────────────────────────────────────────────────────

export interface GameFighterPickRow { fighter_id: string; picks: number; share: number }
export interface GameSkinPickRow { fighter_id: string; skin_id: string | null; picks: number; share: number }
export interface GameStagePickRow { stage_id: string; picks: number; share: number }

export interface GameFighterWinRow {
  fighter_id: string
  matches: number
  wins: number
  losses: number
  win_rate: number
}

export interface GameMatchupRow {
  fighter_id: string
  opponent_id: string
  matches: number
  wins: number
  win_rate: number
}

export interface GameMatchSummary {
  started: number
  completed: number
  /** abandoned + quit + crash, including matches with no end after the grace window. */
  abandoned: number
  in_progress: number
  /** abandoned / (started - in_progress); null when nothing has finished. */
  abandon_rate: number | null
  avg_duration_s: number | null
  median_duration_s: number | null
  p1_wins: number
  p2_wins: number
}

export interface GameMatchDailyRow { day: string; started: number; completed: number; abandoned: number }

export interface GameFunnelStepRow {
  step_index: number
  screen: string
  game_sessions: number
  pct_of_previous: number | null
  pct_of_first: number | null
}

export interface GameScreenTimeRow {
  screen: string
  samples: number
  avg_seconds: number | null
  median_seconds: number | null
  p95_seconds: number | null
}

export interface GameExitScreenRow { screen: string; game_sessions: number; share: number }

export interface GameActivePlayersRow { day: string; dau: number; wau: number; mau: number }

export interface GameRetentionRow {
  cohort_day: string
  cohort_size: number
  d1_retained: number
  d7_retained: number
  d30_retained: number
  /** null while the cohort is younger than 1 / 7 / 30 days. */
  d1_rate: number | null
  d7_rate: number | null
  d30_rate: number | null
}

export interface GameLoadTimeRow {
  group_key: string
  loads: number
  avg_ms: number | null
  p50_ms: number | null
  p95_ms: number | null
  from_cache_share: number | null
}

export interface GameErrorRateRow {
  group_key: string
  game_sessions: number
  sessions_with_error: number
  errors: number
  error_rate: number | null
  crash_free_rate: number | null
}

export interface GameErrorBreakdownRow {
  phase: string
  code: string
  errors: number
  game_sessions: number
  last_seen_at: string | null
}

// ─── Plumbing ─────────────────────────────────────────────────────────────────

type RpcArgs = Record<string, string | number | boolean | string[]>

/** Maps filters to the p_* arguments of the SQL functions; null/undefined are omitted. */
export function buildGameStatsArgs(
  filters: GameStatsFilters,
  options: { withDevice?: boolean; withSource?: boolean } = {},
): RpcArgs {
  const { withDevice = true, withSource = true } = options
  const args: RpcArgs = {
    p_from: filters.from.toISOString(),
    p_to: filters.to.toISOString(),
  }
  if (filters.orgId) args.p_org_id = filters.orgId
  if (filters.gameId) args.p_game_id = filters.gameId
  if (withDevice && filters.device) args.p_device = filters.device
  if (withSource && filters.source) args.p_source = filters.source
  if (filters.guest !== null && filters.guest !== undefined) args.p_guest = filters.guest
  return args
}

/** numeric / bigint arrive as number or string depending on the transport. */
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

async function callRpc(
  supabase: GameStatsClient,
  fn: string,
  args: RpcArgs,
): Promise<Record<string, unknown>[]> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(`game stats ${fn} failed: ${error.message}`)
  return (data ?? []) as Record<string, unknown>[]
}

// ─── Picks ────────────────────────────────────────────────────────────────────

interface PickOptions {
  /** Count the p2 side when it is a CPU too. Default false (human picks only). */
  includeCpu?: boolean
}

function pickArgs(kind: 'fighter' | 'skin' | 'stage', filters: GameStatsFilters, options: PickOptions): RpcArgs {
  const args = buildGameStatsArgs(filters)
  args.p_kind = kind
  if (options.includeCpu) args.p_include_cpu = true
  return args
}

export async function getGameFighterPicks(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
  options: PickOptions = {},
): Promise<GameFighterPickRow[]> {
  const rows = await callRpc(supabase, 'game_stats_pick_counts', pickArgs('fighter', filters, options))
  return rows.map((r) => ({
    fighter_id: String(r.fighter_id),
    picks: num(r.picks),
    share: num(r.share),
  }))
}

export async function getGameSkinPicks(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
  options: PickOptions = {},
): Promise<GameSkinPickRow[]> {
  const rows = await callRpc(supabase, 'game_stats_pick_counts', pickArgs('skin', filters, options))
  return rows.map((r) => ({
    fighter_id: String(r.fighter_id),
    skin_id: r.skin_id === null || r.skin_id === undefined ? null : String(r.skin_id),
    picks: num(r.picks),
    share: num(r.share),
  }))
}

export async function getGameStagePicks(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
): Promise<GameStagePickRow[]> {
  const rows = await callRpc(supabase, 'game_stats_pick_counts', pickArgs('stage', filters, {}))
  return rows.map((r) => ({
    stage_id: String(r.stage_id),
    picks: num(r.picks),
    share: num(r.share),
  }))
}

// ─── Wins, matchups, matches ──────────────────────────────────────────────────

export async function getGameFighterWins(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
): Promise<GameFighterWinRow[]> {
  const rows = await callRpc(supabase, 'game_stats_fighter_wins', buildGameStatsArgs(filters))
  return rows.map((r) => ({
    fighter_id: String(r.fighter_id),
    matches: num(r.matches),
    wins: num(r.wins),
    losses: num(r.losses),
    win_rate: num(r.win_rate),
  }))
}

export async function getGameMatchups(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
): Promise<GameMatchupRow[]> {
  const rows = await callRpc(supabase, 'game_stats_matchups', buildGameStatsArgs(filters))
  return rows.map((r) => ({
    fighter_id: String(r.fighter_id),
    opponent_id: String(r.opponent_id),
    matches: num(r.matches),
    wins: num(r.wins),
    win_rate: num(r.win_rate),
  }))
}

const EMPTY_MATCH_SUMMARY: GameMatchSummary = {
  started: 0,
  completed: 0,
  abandoned: 0,
  in_progress: 0,
  abandon_rate: null,
  avg_duration_s: null,
  median_duration_s: null,
  p1_wins: 0,
  p2_wins: 0,
}

export async function getGameMatchSummary(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
): Promise<GameMatchSummary> {
  const rows = await callRpc(supabase, 'game_stats_match_summary', buildGameStatsArgs(filters))
  const r = rows[0]
  if (!r) return { ...EMPTY_MATCH_SUMMARY }
  return {
    started: num(r.started),
    completed: num(r.completed),
    abandoned: num(r.abandoned),
    in_progress: num(r.in_progress),
    abandon_rate: numOrNull(r.abandon_rate),
    avg_duration_s: numOrNull(r.avg_duration_s),
    median_duration_s: numOrNull(r.median_duration_s),
    p1_wins: num(r.p1_wins),
    p2_wins: num(r.p2_wins),
  }
}

export async function getGameMatchDaily(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
  tz = 'UTC',
): Promise<GameMatchDailyRow[]> {
  const rows = await callRpc(supabase, 'game_stats_match_daily', { ...buildGameStatsArgs(filters), p_tz: tz })
  return rows.map((r) => ({
    day: String(r.day),
    started: num(r.started),
    completed: num(r.completed),
    abandoned: num(r.abandoned),
  }))
}

// ─── Screens ──────────────────────────────────────────────────────────────────

export async function getGameScreenFunnel(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
  steps: readonly string[] = GAME_DEFAULT_FUNNEL_STEPS,
): Promise<GameFunnelStepRow[]> {
  const rows = await callRpc(supabase, 'game_stats_screen_funnel', {
    ...buildGameStatsArgs(filters),
    p_steps: [...steps],
  })
  return rows.map((r) => ({
    step_index: num(r.step_index),
    screen: String(r.screen),
    game_sessions: num(r.game_sessions),
    pct_of_previous: numOrNull(r.pct_of_previous),
    pct_of_first: numOrNull(r.pct_of_first),
  }))
}

export async function getGameScreenTime(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
): Promise<GameScreenTimeRow[]> {
  const rows = await callRpc(supabase, 'game_stats_screen_time', buildGameStatsArgs(filters))
  return rows.map((r) => ({
    screen: String(r.screen),
    samples: num(r.samples),
    avg_seconds: numOrNull(r.avg_seconds),
    median_seconds: numOrNull(r.median_seconds),
    p95_seconds: numOrNull(r.p95_seconds),
  }))
}

export async function getGameExitScreens(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
): Promise<GameExitScreenRow[]> {
  const rows = await callRpc(supabase, 'game_stats_exit_screens', buildGameStatsArgs(filters))
  return rows.map((r) => ({
    screen: String(r.screen),
    game_sessions: num(r.game_sessions),
    share: num(r.share),
  }))
}

// ─── Players ──────────────────────────────────────────────────────────────────

export async function getGameActivePlayers(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
  tz = 'UTC',
): Promise<GameActivePlayersRow[]> {
  const rows = await callRpc(supabase, 'game_stats_active_players', { ...buildGameStatsArgs(filters), p_tz: tz })
  return rows.map((r) => ({
    day: String(r.day),
    dau: num(r.dau),
    wau: num(r.wau),
    mau: num(r.mau),
  }))
}

/** Retention ignores device and source filters (they would move actors between cohorts). */
export async function getGameRetention(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
  tz = 'UTC',
): Promise<GameRetentionRow[]> {
  const rows = await callRpc(supabase, 'game_stats_retention', {
    ...buildGameStatsArgs(filters, { withDevice: false, withSource: false }),
    p_tz: tz,
  })
  return rows.map((r) => ({
    cohort_day: String(r.cohort_day),
    cohort_size: num(r.cohort_size),
    d1_retained: num(r.d1_retained),
    d7_retained: num(r.d7_retained),
    d30_retained: num(r.d30_retained),
    d1_rate: numOrNull(r.d1_rate),
    d7_rate: numOrNull(r.d7_rate),
    d30_rate: numOrNull(r.d30_rate),
  }))
}

// ─── Health ───────────────────────────────────────────────────────────────────

export async function getGameLoadTimes(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
  groupBy: GameGroupBy = 'all',
): Promise<GameLoadTimeRow[]> {
  const rows = await callRpc(supabase, 'game_stats_load_times', { ...buildGameStatsArgs(filters), p_group_by: groupBy })
  return rows.map((r) => ({
    group_key: String(r.group_key),
    loads: num(r.loads),
    avg_ms: numOrNull(r.avg_ms),
    p50_ms: numOrNull(r.p50_ms),
    p95_ms: numOrNull(r.p95_ms),
    from_cache_share: numOrNull(r.from_cache_share),
  }))
}

export async function getGameErrorRate(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
  groupBy: GameGroupBy = 'all',
): Promise<GameErrorRateRow[]> {
  const rows = await callRpc(supabase, 'game_stats_error_rate', { ...buildGameStatsArgs(filters), p_group_by: groupBy })
  return rows.map((r) => ({
    group_key: String(r.group_key),
    game_sessions: num(r.game_sessions),
    sessions_with_error: num(r.sessions_with_error),
    errors: num(r.errors),
    error_rate: numOrNull(r.error_rate),
    crash_free_rate: numOrNull(r.crash_free_rate),
  }))
}

export async function getGameErrorBreakdown(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
): Promise<GameErrorBreakdownRow[]> {
  const rows = await callRpc(supabase, 'game_stats_error_breakdown', buildGameStatsArgs(filters))
  return rows.map((r) => ({
    phase: String(r.phase),
    code: String(r.code),
    errors: num(r.errors),
    game_sessions: num(r.game_sessions),
    last_seen_at: r.last_seen_at === null || r.last_seen_at === undefined ? null : String(r.last_seen_at),
  }))
}

// Data loading and pure view helpers for the game analytics panels
// (BS-ANALYTICS-001):
//   * tenant "Game" tab of /analytics   -> loadGameTenantData(authenticated client)
//   * admin /admin/analytics/game       -> loadGameAdminData(service-role client)
//
// Everything here sits on top of the typed rpc helpers in game-queries.ts and
// game-player-queries.ts; no SQL and no table access except the two cheap probes
// (hasGameEvents, countNewAccounts). Server actions stay thin: they authenticate,
// validate the input with the parse* functions below and call a loader.

import {
  getGameActivePlayers,
  getGameErrorBreakdown,
  getGameErrorRate,
  getGameExitScreens,
  getGameFighterPicks,
  getGameFighterWins,
  getGameLoadTimes,
  getGameMatchDaily,
  getGameMatchSummary,
  getGameMatchups,
  getGameRetention,
  getGameScreenFunnel,
  getGameScreenTime,
  getGameSkinPicks,
  getGameStagePicks,
  type GameActivePlayersRow,
  type GameDevice,
  type GameErrorBreakdownRow,
  type GameErrorRateRow,
  type GameExitScreenRow,
  type GameFighterPickRow,
  type GameFighterWinRow,
  type GameFunnelStepRow,
  type GameGroupBy,
  type GameLoadTimeRow,
  type GameMatchDailyRow,
  type GameMatchSummary,
  type GameMatchupRow,
  type GameRetentionRow,
  type GameScreenTimeRow,
  type GameSkinPickRow,
  type GameStagePickRow,
  type GameStatsClient,
  type GameStatsFilters,
} from '@/lib/analytics/game-queries'
import {
  getGameGames,
  getGamePickTrend,
  getGamePlayerSummary,
  type GamePickTrendRow,
  type GamePlayerSummary,
} from '@/lib/analytics/game-player-queries'

// ─── Input validation ─────────────────────────────────────────────────────────

/** Longest window the panels accept (the cohort and trend charts stay readable). */
export const GAME_PANEL_MAX_DAYS = 400

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const GAME_ID_RE = /^[a-z0-9][a-z0-9_.-]{0,63}$/
const SOURCE_RE = /^[a-z0-9][a-z0-9_.:\- ]{0,63}$/
const DEVICES: readonly GameDevice[] = ['desktop', 'mobile', 'tablet', 'unknown']

/** A valid IANA time zone name, else UTC. The name only reaches SQL as a bound parameter. */
export function safeTimeZone(tz: unknown): string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return 'UTC'
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return tz
  } catch {
    return 'UTC'
  }
}

export interface GameRange { from: Date; to: Date }

/** Parses an ISO window. null when a date is invalid, the window is empty or longer than GAME_PANEL_MAX_DAYS. */
export function parseGameRange(from: unknown, to: unknown): GameRange | null {
  if (typeof from !== 'string' || typeof to !== 'string') return null
  const f = new Date(from)
  const t = new Date(to)
  if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return null
  if (t.getTime() <= f.getTime()) return null
  if (t.getTime() - f.getTime() > GAME_PANEL_MAX_DAYS * 86_400_000) return null
  return { from: f, to: t }
}

export type GameGuestFilter = 'all' | 'guest' | 'signed_in'

/** Raw (client supplied) admin panel input. */
export interface GameAdminInput {
  from: string
  to: string
  tz?: string
  /** A single organization id, or omitted / null / "all" for every organization. */
  orgId?: string | null
  gameId?: string | null
  device?: string | null
  source?: string | null
  guest?: GameGuestFilter | string | null
}

export interface GameAdminFilters {
  range: GameRange
  tz: string
  stats: GameStatsFilters
  /** Echo of the normalized values, handy for the UI. */
  guest: GameGuestFilter
}

/** Validates and normalizes admin input. null = reject the call. */
export function parseGameAdminInput(raw: unknown): GameAdminFilters | null {
  if (!raw || typeof raw !== 'object') return null
  const input = raw as Record<string, unknown>
  const range = parseGameRange(input.from, input.to)
  if (!range) return null

  let orgId: string | null = null
  if (input.orgId !== undefined && input.orgId !== null && input.orgId !== '' && input.orgId !== 'all') {
    if (typeof input.orgId !== 'string' || !UUID_RE.test(input.orgId)) return null
    orgId = input.orgId.toLowerCase()
  }

  let gameId: string | null = null
  if (input.gameId !== undefined && input.gameId !== null && input.gameId !== '' && input.gameId !== 'all') {
    if (typeof input.gameId !== 'string' || !GAME_ID_RE.test(input.gameId)) return null
    gameId = input.gameId
  }

  let device: GameDevice | null = null
  if (input.device !== undefined && input.device !== null && input.device !== '' && input.device !== 'all') {
    if (typeof input.device !== 'string' || !DEVICES.includes(input.device as GameDevice)) return null
    device = input.device as GameDevice
  }

  let source: string | null = null
  if (input.source !== undefined && input.source !== null && input.source !== '' && input.source !== 'all') {
    if (typeof input.source !== 'string') return null
    const s = input.source.trim().toLowerCase()
    if (!SOURCE_RE.test(s)) return null
    source = s
  }

  let guest: GameGuestFilter = 'all'
  if (input.guest !== undefined && input.guest !== null && input.guest !== '') {
    if (input.guest !== 'all' && input.guest !== 'guest' && input.guest !== 'signed_in') return null
    guest = input.guest
  }

  return {
    range,
    tz: safeTimeZone(input.tz),
    guest,
    stats: {
      from: range.from,
      to: range.to,
      orgId,
      gameId,
      device,
      source,
      guest: guest === 'all' ? null : guest === 'guest',
    },
  }
}

// ─── Probes ───────────────────────────────────────────────────────────────────

/** True when the organization has at least one game event in [from, to). */
export async function hasGameEvents(
  supabase: GameStatsClient,
  orgId: string,
  range: GameRange,
): Promise<boolean> {
  const { data, error } = await supabase
    .from('analytics_events')
    .select('id')
    .eq('organization_id', orgId)
    .eq('event_type', 'game')
    .gte('occurred_at', range.from.toISOString())
    .lt('occurred_at', range.to.toISOString())
    .limit(1)
  if (error) throw new Error(`game events probe failed: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

/** CRM contacts created in the window: the accounts the game API synced to Xphere. Null if unavailable. */
export async function countNewAccounts(supabase: GameStatsClient, range: GameRange): Promise<number | null> {
  const { count, error } = await supabase
    .from('contacts')
    .select('id', { count: 'exact', head: true })
    .is('merged_into_contact_id', null)
    .gte('created_at', range.from.toISOString())
    .lt('created_at', range.to.toISOString())
  if (error) return null
  return typeof count === 'number' ? count : null
}

// ─── Breakdowns (device / browser / OS / connection / source) ─────────────────

export type GameBreakdownDimension = 'device' | 'browser' | 'os' | 'connection' | 'source'

export const GAME_BREAKDOWN_DIMENSIONS: readonly GameBreakdownDimension[] = [
  'device',
  'browser',
  'os',
  'connection',
  'source',
]

export interface GameBreakdownRow {
  key: string
  /** Game sessions in this group. */
  sessions: number
  /** sessions / all sessions of the dimension, 0..1. */
  share: number
  /** Share of the group's sessions that logged a game_error; null without sessions. */
  error_rate: number | null
  loads: number
  load_p50_ms: number | null
  load_p95_ms: number | null
}

/** Merges the error-rate and load-time rows of one dimension into one row per group. */
export function mergeBreakdown(errors: GameErrorRateRow[], loads: GameLoadTimeRow[]): GameBreakdownRow[] {
  const total = errors.reduce((n, r) => n + r.game_sessions, 0)
  const loadByKey = new Map(loads.map((l) => [l.group_key, l]))
  const keys = new Set<string>([...errors.map((e) => e.group_key), ...loads.map((l) => l.group_key)])
  const errorByKey = new Map(errors.map((e) => [e.group_key, e]))
  return [...keys]
    .map((key) => {
      const e = errorByKey.get(key)
      const l = loadByKey.get(key)
      const sessions = e?.game_sessions ?? 0
      return {
        key,
        sessions,
        share: total > 0 ? sessions / total : 0,
        error_rate: e?.error_rate ?? null,
        loads: l?.loads ?? 0,
        load_p50_ms: l?.p50_ms ?? null,
        load_p95_ms: l?.p95_ms ?? null,
      }
    })
    .sort((a, b) => b.sessions - a.sessions || b.loads - a.loads || a.key.localeCompare(b.key))
}

async function loadBreakdown(
  supabase: GameStatsClient,
  filters: GameStatsFilters,
  dimension: GameBreakdownDimension,
): Promise<GameBreakdownRow[]> {
  const groupBy: GameGroupBy = dimension
  const [errors, loads] = await Promise.all([
    getGameErrorRate(supabase, filters, groupBy),
    getGameLoadTimes(supabase, filters, groupBy),
  ])
  return mergeBreakdown(errors, loads)
}

// ─── Tenant data ──────────────────────────────────────────────────────────────

export interface GameTenantData {
  hasEvents: boolean
  /** CRM contacts created in the window (account sign-ups), or null when not readable. */
  newAccounts: number | null
  players: GamePlayerSummary
  /** One row per day; the last row holds the DAU / WAU / MAU "now" numbers. */
  active: GameActivePlayersRow[]
  matches: GameMatchSummary
  daily: GameMatchDailyRow[]
  retention: GameRetentionRow[]
  funnel: GameFunnelStepRow[]
  screenTime: GameScreenTimeRow[]
  exitScreens: GameExitScreenRow[]
  fighters: GameFighterPickRow[]
  skins: GameSkinPickRow[]
  stages: GameStagePickRow[]
  load: GameLoadTimeRow | null
  errors: GameErrorRateRow | null
  errorBreakdown: GameErrorBreakdownRow[]
  breakdowns: Record<GameBreakdownDimension, GameBreakdownRow[]>
}

/**
 * Everything the tenant Game tab shows. `supabase` must be the authenticated
 * server client: RLS cuts every row to the caller's organization, orgId only
 * narrows the query further and keeps the index in play.
 */
export async function loadGameTenantData(
  supabase: GameStatsClient,
  orgId: string,
  range: GameRange,
  tz = 'UTC',
): Promise<GameTenantData> {
  const filters: GameStatsFilters = { from: range.from, to: range.to, orgId }
  const hasEvents = await hasGameEvents(supabase, orgId, range)
  const empty = emptyTenantData()
  if (!hasEvents) return empty

  const [
    newAccounts, players, active, matches, daily, retention, funnel, screenTime, exitScreens,
    fighters, skins, stages, load, errors, errorBreakdown, ...breakdowns
  ] = await Promise.all([
    countNewAccounts(supabase, range),
    getGamePlayerSummary(supabase, filters),
    getGameActivePlayers(supabase, filters, tz),
    getGameMatchSummary(supabase, filters),
    getGameMatchDaily(supabase, filters, tz),
    getGameRetention(supabase, filters, tz),
    getGameScreenFunnel(supabase, filters),
    getGameScreenTime(supabase, filters),
    getGameExitScreens(supabase, filters),
    getGameFighterPicks(supabase, filters),
    getGameSkinPicks(supabase, filters),
    getGameStagePicks(supabase, filters),
    getGameLoadTimes(supabase, filters, 'all'),
    getGameErrorRate(supabase, filters, 'all'),
    getGameErrorBreakdown(supabase, filters),
    ...GAME_BREAKDOWN_DIMENSIONS.map((d) => loadBreakdown(supabase, filters, d)),
  ])

  return {
    hasEvents: true,
    newAccounts,
    players,
    active,
    matches,
    daily,
    retention,
    funnel,
    screenTime,
    exitScreens,
    fighters,
    skins,
    stages,
    load: load[0] ?? null,
    errors: errors[0] ?? null,
    errorBreakdown,
    breakdowns: Object.fromEntries(
      GAME_BREAKDOWN_DIMENSIONS.map((d, i) => [d, breakdowns[i]]),
    ) as Record<GameBreakdownDimension, GameBreakdownRow[]>,
  }
}

export function emptyTenantData(): GameTenantData {
  return {
    hasEvents: false,
    newAccounts: null,
    players: {
      players: 0, signed_in_players: 0, guest_players: 0, players_with_match: 0, matches_started: 0,
      matches_per_player: null, game_sessions: 0, timed_sessions: 0,
      avg_session_s: null, median_session_s: null, p95_session_s: null,
    },
    active: [],
    matches: {
      started: 0, completed: 0, abandoned: 0, in_progress: 0, abandon_rate: null,
      avg_duration_s: null, median_duration_s: null, p1_wins: 0, p2_wins: 0,
    },
    daily: [],
    retention: [],
    funnel: [],
    screenTime: [],
    exitScreens: [],
    fighters: [],
    skins: [],
    stages: [],
    load: null,
    errors: null,
    errorBreakdown: [],
    breakdowns: { device: [], browser: [], os: [], connection: [], source: [] },
  }
}

// ─── Admin data ───────────────────────────────────────────────────────────────

export interface GameAdminData {
  picks: { fighters: GameFighterPickRow[]; skins: GameSkinPickRow[]; stages: GameStagePickRow[] }
  wins: GameFighterWinRow[]
  matchups: GameMatchupRow[]
  matches: GameMatchSummary
  daily: GameMatchDailyRow[]
  trends: { fighters: GamePickTrendRow[]; skins: GamePickTrendRow[]; stages: GamePickTrendRow[] }
  players: GamePlayerSummary
  active: GameActivePlayersRow[]
  retention: GameRetentionRow[]
  funnel: GameFunnelStepRow[]
  exitScreens: GameExitScreenRow[]
  load: { all: GameLoadTimeRow | null; byDevice: GameLoadTimeRow[]; byConnection: GameLoadTimeRow[] }
  errors: {
    all: GameErrorRateRow | null
    byBuild: GameErrorRateRow[]
    byBrowser: GameErrorRateRow[]
    breakdown: GameErrorBreakdownRow[]
  }
}

/**
 * Everything the admin global panels show. `supabase` must be the service-role
 * client and the caller must already have passed the platform-admin check.
 * stats.orgId null = every organization.
 */
export async function loadGameAdminData(
  supabase: GameStatsClient,
  filters: GameAdminFilters,
): Promise<GameAdminData> {
  const { stats, tz } = filters
  const [
    fighters, skins, stages, wins, matchups, matches, daily,
    trendFighters, trendSkins, trendStages,
    players, active, retention, funnel, exitScreens,
    loadAll, loadDevice, loadConnection,
    errAll, errBuild, errBrowser, errBreakdown,
  ] = await Promise.all([
    getGameFighterPicks(supabase, stats),
    getGameSkinPicks(supabase, stats),
    getGameStagePicks(supabase, stats),
    getGameFighterWins(supabase, stats),
    getGameMatchups(supabase, stats),
    getGameMatchSummary(supabase, stats),
    getGameMatchDaily(supabase, stats, tz),
    getGamePickTrend(supabase, 'fighter', stats, { tz }),
    getGamePickTrend(supabase, 'skin', stats, { tz }),
    getGamePickTrend(supabase, 'stage', stats, { tz }),
    getGamePlayerSummary(supabase, stats),
    getGameActivePlayers(supabase, stats, tz),
    getGameRetention(supabase, stats, tz),
    getGameScreenFunnel(supabase, stats),
    getGameExitScreens(supabase, stats),
    getGameLoadTimes(supabase, stats, 'all'),
    getGameLoadTimes(supabase, stats, 'device'),
    getGameLoadTimes(supabase, stats, 'connection'),
    getGameErrorRate(supabase, stats, 'all'),
    getGameErrorRate(supabase, stats, 'build'),
    getGameErrorRate(supabase, stats, 'browser'),
    getGameErrorBreakdown(supabase, stats),
  ])

  return {
    picks: { fighters, skins, stages },
    wins,
    matchups,
    matches,
    daily,
    trends: { fighters: trendFighters, skins: trendSkins, stages: trendStages },
    players,
    active,
    retention,
    funnel,
    exitScreens,
    load: { all: loadAll[0] ?? null, byDevice: loadDevice, byConnection: loadConnection },
    errors: { all: errAll[0] ?? null, byBuild: errBuild, byBrowser: errBrowser, breakdown: errBreakdown },
  }
}

export interface GameAdminOptions {
  orgs: { id: string; name: string; games: string[]; events: number }[]
  games: string[]
  sources: string[]
}

/**
 * Selector options: organizations (with their games) and traffic sources that
 * have game events in the window. Names come from `orgNames` (id -> name).
 */
export async function loadGameAdminOptions(
  supabase: GameStatsClient,
  range: GameRange,
  orgNames: (ids: string[]) => Promise<Record<string, string>>,
): Promise<GameAdminOptions> {
  const [games, sources] = await Promise.all([
    getGameGames(supabase, { from: range.from, to: range.to }),
    getGameErrorRate(supabase, { from: range.from, to: range.to }, 'source'),
  ])
  const byOrg = new Map<string, { games: Set<string>; events: number }>()
  for (const g of games) {
    const cur = byOrg.get(g.organization_id) ?? { games: new Set<string>(), events: 0 }
    cur.games.add(g.game_id)
    cur.events += g.events
    byOrg.set(g.organization_id, cur)
  }
  const names = byOrg.size > 0 ? await orgNames([...byOrg.keys()]) : {}
  return {
    orgs: [...byOrg.entries()]
      .map(([id, v]) => ({ id, name: names[id] ?? id, games: [...v.games].sort(), events: v.events }))
      .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name)),
    games: [...new Set(games.map((g) => g.game_id))].sort(),
    sources: sources.map((s) => s.group_key),
  }
}

// ─── Pick segments (admin) ────────────────────────────────────────────────────

export type GameSegmentBy = 'period' | 'device' | 'guest' | 'source'

export interface GamePickSegment {
  key: string
  label: string
  /** Total picks in the segment. */
  total: number
  fighters: GameFighterPickRow[]
}

export const GAME_SEGMENT_SOURCE_LIMIT = 5

/** Same-length window immediately before `range`. */
export function previousRange(range: GameRange): GameRange {
  const span = range.to.getTime() - range.from.getTime()
  return { from: new Date(range.from.getTime() - span), to: new Date(range.from.getTime()) }
}

/**
 * Fighter picks side by side for one segmentation: the current vs previous
 * period, desktop / mobile / tablet, guests vs signed-in players, or the top
 * sources. The matching filter of `filters` is ignored for that segmentation.
 */
export async function loadGamePickSegments(
  supabase: GameStatsClient,
  filters: GameAdminFilters,
  by: GameSegmentBy,
): Promise<GamePickSegment[]> {
  const base = filters.stats
  const segment = async (key: string, label: string, f: GameStatsFilters): Promise<GamePickSegment> => {
    const fighters = await getGameFighterPicks(supabase, f)
    return { key, label, total: fighters.reduce((n, r) => n + r.picks, 0), fighters }
  }

  switch (by) {
    case 'period': {
      const prev = previousRange(filters.range)
      return Promise.all([
        segment('current', 'This period', base),
        segment('previous', 'Previous period', { ...base, from: prev.from, to: prev.to }),
      ])
    }
    case 'device':
      return Promise.all(
        (['desktop', 'mobile', 'tablet'] as const).map((d) => segment(d, d, { ...base, device: d })),
      )
    case 'guest':
      return Promise.all([
        segment('guest', 'Guests', { ...base, guest: true }),
        segment('signed_in', 'Signed in', { ...base, guest: false }),
      ])
    case 'source': {
      const sources = await getGameErrorRate(supabase, { ...base, source: null }, 'source')
      return Promise.all(
        sources.slice(0, GAME_SEGMENT_SOURCE_LIMIT).map((s) => segment(s.group_key, s.group_key, { ...base, source: s.group_key })),
      )
    }
  }
}

// ─── Pure view helpers ────────────────────────────────────────────────────────

/** Rows sorted ascending by picks (the least used), ties by id. */
export function leastPicked<T extends { picks: number }>(rows: T[], limit = 5): T[] {
  return [...rows].sort((a, b) => a.picks - b.picks).slice(0, limit)
}

export interface FighterSkinGroup {
  fighter_id: string
  total: number
  skins: { skin_id: string | null; picks: number; share: number }[]
}

/** Skin picks grouped under their fighter, most picked fighter first, most picked skin first. */
export function groupSkinsByFighter(rows: GameSkinPickRow[]): FighterSkinGroup[] {
  const map = new Map<string, FighterSkinGroup>()
  for (const r of rows) {
    const g = map.get(r.fighter_id) ?? { fighter_id: r.fighter_id, total: 0, skins: [] }
    g.total += r.picks
    g.skins.push({ skin_id: r.skin_id, picks: r.picks, share: 0 })
    map.set(r.fighter_id, g)
  }
  const groups = [...map.values()]
  for (const g of groups) {
    g.skins.sort((a, b) => b.picks - a.picks || String(a.skin_id).localeCompare(String(b.skin_id)))
    for (const s of g.skins) s.share = g.total > 0 ? s.picks / g.total : 0
  }
  return groups.sort((a, b) => b.total - a.total || a.fighter_id.localeCompare(b.fighter_id))
}

export interface MatchupCell { matches: number; wins: number; win_rate: number }

export interface MatchupMatrix {
  /** Fighters in row / column order (alphabetical). */
  fighters: string[]
  /** cells[row][col] is the row fighter's record against the column fighter. */
  cells: Record<string, Record<string, MatchupCell>>
}

/** Turns the long matchup rows into a square lookup; a missing pair has no cell. */
export function buildMatchupMatrix(rows: GameMatchupRow[]): MatchupMatrix {
  const fighters = [...new Set(rows.flatMap((r) => [r.fighter_id, r.opponent_id]))].sort((a, b) => a.localeCompare(b))
  const cells: MatchupMatrix['cells'] = {}
  for (const r of rows) {
    ;(cells[r.fighter_id] ??= {})[r.opponent_id] = { matches: r.matches, wins: r.wins, win_rate: r.win_rate }
  }
  return { fighters, cells }
}

export interface SideAdvantage {
  p1_wins: number
  p2_wins: number
  decided: number
  p1_share: number | null
  p2_share: number | null
  /** p1_share - p2_share in percentage points / 100; positive favors side 1. */
  edge: number | null
}

export function sideAdvantage(summary: Pick<GameMatchSummary, 'p1_wins' | 'p2_wins'>): SideAdvantage {
  const decided = summary.p1_wins + summary.p2_wins
  if (decided === 0) {
    return { p1_wins: 0, p2_wins: 0, decided: 0, p1_share: null, p2_share: null, edge: null }
  }
  const p1 = summary.p1_wins / decided
  const p2 = summary.p2_wins / decided
  return { p1_wins: summary.p1_wins, p2_wins: summary.p2_wins, decided, p1_share: p1, p2_share: p2, edge: p1 - p2 }
}

/** Local calendar days (YYYY-MM-DD) from the window start to its last instant, in `tz`. */
export function enumerateDays(range: GameRange, tz = 'UTC'): string[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: safeTimeZone(tz), year: 'numeric', month: '2-digit', day: '2-digit' })
  const days: string[] = []
  const last = fmt.format(new Date(range.to.getTime() - 1))
  const step = 12 * 3_600_000
  for (let t = range.from.getTime(); t < range.to.getTime() + step; t += step) {
    const day = fmt.format(new Date(t))
    if (days[days.length - 1] !== day) days.push(day)
    if (day === last) break
  }
  return days
}

/** One entry per day of `days`, taking the row of that day or `fill(day)`. */
export function fillDays<T extends { day: string }>(rows: T[], days: string[], fill: (day: string) => T): T[] {
  const byDay = new Map(rows.map((r) => [r.day, r]))
  return days.map((d) => byDay.get(d) ?? fill(d))
}

export interface TrendSeries {
  /** Items in legend order (most picked first). */
  items: string[]
  /** One object per day: { day, [item]: picks }. Missing combinations are 0. */
  points: Record<string, string | number>[]
}

/** Pivots long (day, item, picks) rows into chart points, zero-filled over `days`. */
export function pivotTrend(rows: GamePickTrendRow[], days: string[]): TrendSeries {
  const totals = new Map<string, number>()
  for (const r of rows) totals.set(r.item, (totals.get(r.item) ?? 0) + r.picks)
  const items = [...totals.keys()].sort((a, b) => (totals.get(b)! - totals.get(a)!) || a.localeCompare(b))
  const byDayItem = new Map<string, number>()
  for (const r of rows) byDayItem.set(`${r.day}|${r.item}`, r.picks)
  const points = days.map((day) => {
    const point: Record<string, string | number> = { day }
    for (const item of items) point[item] = byDayItem.get(`${day}|${item}`) ?? 0
    return point
  })
  return { items, points }
}

/** "1m 05s", "42s", "2h 03m"; "-" for null. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '-'
  const s = Math.round(seconds)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

/** 0.4567 -> "45.7%"; "-" for null. */
export function formatPercent(ratio: number | null | undefined, digits = 1): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return '-'
  return `${(ratio * 100).toFixed(digits)}%`
}

/** 1830 -> "1.8 s", 420 -> "420 ms"; "-" for null. */
export function formatMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '-'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`
}

/** "title" -> "Title", "fighter_select" -> "Fighter select". */
export function humanizeId(id: string | null | undefined): string {
  if (!id) return '-'
  const spaced = id.replace(/[_-]+/g, ' ').trim()
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** DAU / WAU / MAU of the last day of the window (zeros when there is no data). */
export function latestActive(rows: GameActivePlayersRow[]): { dau: number; wau: number; mau: number } {
  const last = rows[rows.length - 1]
  return last ? { dau: last.dau, wau: last.wau, mau: last.mau } : { dau: 0, wau: 0, mau: 0 }
}

export interface RetentionSummary { d1: number | null; d7: number | null; d30: number | null }

/**
 * Player-weighted retention over the cohorts old enough to measure: for Dn,
 * sum(retained) / sum(cohort size) over cohorts whose Dn rate is not null.
 * null when no cohort is old enough.
 */
export function retentionSummary(rows: GameRetentionRow[]): RetentionSummary {
  const weighted = (rate: (r: GameRetentionRow) => number | null, retained: (r: GameRetentionRow) => number): number | null => {
    let size = 0
    let kept = 0
    for (const r of rows) {
      if (rate(r) === null) continue
      size += r.cohort_size
      kept += retained(r)
    }
    return size > 0 ? kept / size : null
  }
  return {
    d1: weighted((r) => r.d1_rate, (r) => r.d1_retained),
    d7: weighted((r) => r.d7_rate, (r) => r.d7_retained),
    d30: weighted((r) => r.d30_rate, (r) => r.d30_retained),
  }
}

// ─── Periods (browser-side window selection) ──────────────────────────────────

export type GamePeriod = 'today' | 'yesterday' | '7d' | '30d' | '90d' | 'month' | 'last_month'

export const GAME_PERIOD_LABELS: Record<GamePeriod, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  '7d': 'Last 7 days',
  '30d': 'Last 30 days',
  '90d': 'Last 90 days',
  month: 'This month',
  last_month: 'Last month',
}

/**
 * ISO window for a period in the runtime's local time zone, as a half-open
 * [from, to) of whole calendar days. Running periods end at tomorrow 00:00, so
 * "Last 7 days" is the six previous days plus today.
 */
export function gamePeriodRange(period: GamePeriod, now: Date = new Date()): { from: string; to: string } {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  const daysBack = (n: number) => new Date(today.getFullYear(), today.getMonth(), today.getDate() - n)
  const pair = (f: Date, t: Date) => ({ from: f.toISOString(), to: t.toISOString() })

  switch (period) {
    case 'today': return pair(today, tomorrow)
    case 'yesterday': return pair(daysBack(1), today)
    case '7d': return pair(daysBack(6), tomorrow)
    case '30d': return pair(daysBack(29), tomorrow)
    case '90d': return pair(daysBack(89), tomorrow)
    case 'month': return pair(new Date(now.getFullYear(), now.getMonth(), 1), tomorrow)
    case 'last_month': return pair(new Date(now.getFullYear(), now.getMonth() - 1, 1), new Date(now.getFullYear(), now.getMonth(), 1))
  }
}

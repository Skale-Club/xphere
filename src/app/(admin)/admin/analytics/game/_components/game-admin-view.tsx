'use client'

// Global game panels for the platform super admin (BS-ANALYTICS-001). Balance and
// engagement numbers across organizations or for one game organization. This is
// studio tooling: there is no player-facing ranking and nothing here is public.

import { useEffect, useMemo, useState } from 'react'
import { Calendar, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  BarList,
  DailyAreaChart,
  FunnelBars,
  GameCard,
  GameEmpty,
  GameSection,
  GameStat,
  GameTable,
  MatchupHeatmap,
  RetentionTable,
  TrendLines,
} from '@/components/analytics/game-widgets'
import {
  GAME_PERIOD_LABELS,
  buildMatchupMatrix,
  enumerateDays,
  fillDays,
  formatDuration,
  formatMs,
  formatPercent,
  gamePeriodRange,
  groupSkinsByFighter,
  humanizeId,
  latestActive,
  leastPicked,
  pivotTrend,
  retentionSummary,
  sideAdvantage,
  type GameAdminData,
  type GameAdminOptions,
  type GamePeriod,
  type GamePickSegment,
  type GameSegmentBy,
} from '@/lib/analytics/game-panels'
import {
  getGameAdminData,
  getGameAdminOptions,
  getGameAdminPickSegments,
} from '../_actions/game-admin-actions'

type TrendKind = 'fighters' | 'skins' | 'stages'

const SEGMENT_LABELS: Record<GameSegmentBy, string> = {
  period: 'Period (this vs previous)',
  device: 'Device',
  guest: 'Guest vs signed in',
  source: 'Source (top 5)',
}

function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
  width = 'w-40',
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  width?: string
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={`h-8 text-xs ${width}`}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export function GameAdminView() {
  const [period, setPeriod] = useState<GamePeriod>('30d')
  const [orgId, setOrgId] = useState('all')
  const [gameId, setGameId] = useState('all')
  const [device, setDevice] = useState('all')
  const [source, setSource] = useState('all')
  const [guest, setGuest] = useState('all')
  const [trendKind, setTrendKind] = useState<TrendKind>('fighters')
  const [segmentBy, setSegmentBy] = useState<GameSegmentBy>('period')

  const [options, setOptions] = useState<GameAdminOptions | null>(null)
  const [data, setData] = useState<GameAdminData | null>(null)
  const [segments, setSegments] = useState<GamePickSegment[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, [])
  const range = useMemo(() => gamePeriodRange(period), [period, reloadKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const input = useMemo(
    () => ({ from: range.from, to: range.to, tz, orgId, gameId, device, source, guest }),
    [range, tz, orgId, gameId, device, source, guest],
  )

  // Selector options follow the period only.
  useEffect(() => {
    let cancelled = false
    getGameAdminOptions({ from: range.from, to: range.to })
      .then((o) => { if (!cancelled) setOptions(o) })
      .catch(() => { if (!cancelled) setOptions(null) })
    return () => { cancelled = true }
  }, [range])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    getGameAdminData(input)
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError('Could not load the game analytics.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [input])

  useEffect(() => {
    let cancelled = false
    setSegments(null)
    getGameAdminPickSegments(input, segmentBy)
      .then((s) => { if (!cancelled) setSegments(s) })
      .catch(() => { if (!cancelled) setSegments([]) })
    return () => { cancelled = true }
  }, [input, segmentBy])

  const days = useMemo(
    () => enumerateDays({ from: new Date(range.from), to: new Date(range.to) }, tz),
    [range, tz],
  )

  const gameOptions = useMemo(() => {
    if (!options) return []
    if (orgId === 'all') return options.games
    return options.orgs.find((o) => o.id === orgId)?.games ?? []
  }, [options, orgId])

  const hasData = Boolean(data && (data.matches.started > 0 || data.players.players > 0))

  return (
    <div className="space-y-8">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <FilterSelect
          value={period}
          onChange={(v) => setPeriod(v as GamePeriod)}
          width="w-40"
          options={(Object.keys(GAME_PERIOD_LABELS) as GamePeriod[]).map((p) => ({ value: p, label: GAME_PERIOD_LABELS[p] }))}
        />
        <FilterSelect
          value={orgId}
          onChange={(v) => { setOrgId(v); setGameId('all') }}
          width="w-48"
          options={[
            { value: 'all', label: 'All organizations' },
            ...(options?.orgs ?? []).map((o) => ({ value: o.id, label: o.name })),
          ]}
        />
        <FilterSelect
          value={gameId}
          onChange={setGameId}
          width="w-40"
          options={[{ value: 'all', label: 'All games' }, ...gameOptions.map((g) => ({ value: g, label: g }))]}
        />
        <FilterSelect
          value={device}
          onChange={setDevice}
          width="w-36"
          options={[
            { value: 'all', label: 'All devices' },
            { value: 'desktop', label: 'Desktop' },
            { value: 'mobile', label: 'Mobile' },
            { value: 'tablet', label: 'Tablet' },
          ]}
        />
        <FilterSelect
          value={source}
          onChange={setSource}
          width="w-40"
          options={[{ value: 'all', label: 'All sources' }, ...(options?.sources ?? []).map((s) => ({ value: s, label: s }))]}
        />
        <FilterSelect
          value={guest}
          onChange={setGuest}
          width="w-40"
          options={[
            { value: 'all', label: 'Guests and signed in' },
            { value: 'guest', label: 'Guests only' },
            { value: 'signed_in', label: 'Signed in only' },
          ]}
        />
        <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)} disabled={loading} aria-label="Refresh">
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
        </Button>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-text-tertiary">
          <Calendar className="h-3.5 w-3.5" />
          {tz}
        </span>
      </div>

      {error && <GameEmpty>{error}</GameEmpty>}
      {!error && !data && <GameEmpty>{loading ? 'Loading...' : 'No data'}</GameEmpty>}
      {!error && data && !hasData && <GameEmpty>No game events match these filters in this period</GameEmpty>}

      {!error && data && hasData && (
        <div className={`space-y-8 transition-opacity ${loading ? 'opacity-60' : ''}`}>
          <Overview data={data} />
          <Matches data={data} days={days} />
          <Picks data={data} />
          <Segments segments={segments} segmentBy={segmentBy} onChange={setSegmentBy} />
          <Balance data={data} />
          <Trends data={data} days={days} kind={trendKind} onKind={setTrendKind} />
          <Engagement data={data} days={days} />
          <Screens data={data} />
          <Health data={data} />
        </div>
      )}
    </div>
  )
}

// ─── Sections ─────────────────────────────────────────────────────────────────

function Overview({ data }: { data: GameAdminData }) {
  const { matches, players } = data
  const side = sideAdvantage(matches)
  return (
    <GameSection title="Overview">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <GameStat label="Matches started" value={matches.started.toLocaleString()} />
        <GameStat label="Completed" value={matches.completed.toLocaleString()} />
        <GameStat
          label="Abandoned"
          value={matches.abandoned.toLocaleString()}
          hint={matches.abandon_rate === null ? undefined : `${formatPercent(matches.abandon_rate)} of finished matches`}
        />
        <GameStat label="In progress" value={matches.in_progress.toLocaleString()} />
        <GameStat label="Average duration" value={formatDuration(matches.avg_duration_s)} hint="completed matches" />
        <GameStat label="Median duration" value={formatDuration(matches.median_duration_s)} hint="completed matches" />
        <GameStat
          label="Side advantage"
          value={side.edge === null ? '-' : `${side.edge >= 0 ? 'P1' : 'P2'} +${Math.abs(side.edge * 100).toFixed(1)} pts`}
          hint={side.decided > 0 ? `P1 ${formatPercent(side.p1_share, 0)} / P2 ${formatPercent(side.p2_share, 0)} of ${side.decided.toLocaleString()} decided` : 'no decided matches'}
        />
        <GameStat
          label="Players"
          value={players.players.toLocaleString()}
          hint={`${players.signed_in_players.toLocaleString()} signed in / ${players.guest_players.toLocaleString()} guests`}
        />
      </div>
    </GameSection>
  )
}

function Matches({ data, days }: { data: GameAdminData; days: string[] }) {
  const series = fillDays(data.daily, days, (day) => ({ day, started: 0, completed: 0, abandoned: 0 }))
  return (
    <GameSection title="Matches over time">
      <GameCard title="Started, completed and abandoned per day">
        <DailyAreaChart
          data={series}
          series={[
            { key: 'started', label: 'Started' },
            { key: 'completed', label: 'Completed', color: '#10b981' },
            { key: 'abandoned', label: 'Abandoned', color: '#f43f5e' },
          ]}
        />
      </GameCard>
    </GameSection>
  )
}

function Picks({ data }: { data: GameAdminData }) {
  const { fighters, skins, stages } = data.picks
  const skinGroups = groupSkinsByFighter(skins)
  const row = (id: string, picks: number, share: number) => ({
    key: id,
    label: humanizeId(id),
    value: picks,
    display: `${picks.toLocaleString()} (${formatPercent(share, 1)})`,
  })
  return (
    <GameSection
      title="Picks"
      note="Per match entered; player 2 counts only when it is not the CPU. A fighter, skin or stage nobody picked does not appear."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <GameCard title="Most picked fighters">
          <BarList limit={12} rows={fighters.map((f) => row(f.fighter_id, f.picks, f.share))} />
        </GameCard>
        <GameCard title="Least picked fighters">
          <BarList limit={6} rows={leastPicked(fighters, 6).map((f) => row(f.fighter_id, f.picks, f.share))} />
        </GameCard>
        <GameCard title="Stages: most and least picked">
          <BarList limit={6} rows={stages.map((s) => row(s.stage_id, s.picks, s.share))} />
          {stages.length > 6 && (
            <>
              <div className="mb-2 mt-4 text-xs font-medium text-text-tertiary">Least picked</div>
              <BarList limit={3} rows={leastPicked(stages, 3).map((s) => row(s.stage_id, s.picks, s.share))} />
            </>
          )}
        </GameCard>
      </div>
      <GameCard title="Skin per fighter" note="Share of the fighter's own picks">
        {skinGroups.length === 0 ? (
          <GameEmpty />
        ) : (
          <div className="grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
            {skinGroups.map((g) => (
              <div key={g.fighter_id}>
                <div className="mb-1.5 flex justify-between text-xs">
                  <span className="font-medium text-text-primary">{humanizeId(g.fighter_id)}</span>
                  <span className="tabular-nums text-text-tertiary">{g.total.toLocaleString()} picks</span>
                </div>
                <BarList
                  limit={6}
                  rows={g.skins.map((s) => ({
                    key: `${g.fighter_id}/${s.skin_id ?? '-'}`,
                    label: s.skin_id ? humanizeId(s.skin_id) : 'Default',
                    value: s.picks,
                    display: `${s.picks.toLocaleString()} (${formatPercent(s.share, 0)})`,
                  }))}
                />
              </div>
            ))}
          </div>
        )}
      </GameCard>
    </GameSection>
  )
}

function Segments({
  segments,
  segmentBy,
  onChange,
}: {
  segments: GamePickSegment[] | null
  segmentBy: GameSegmentBy
  onChange: (by: GameSegmentBy) => void
}) {
  const fighters = useMemo(() => {
    const totals = new Map<string, number>()
    for (const s of segments ?? []) for (const f of s.fighters) totals.set(f.fighter_id, (totals.get(f.fighter_id) ?? 0) + f.picks)
    return [...totals.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([id]) => id)
  }, [segments])

  return (
    <GameSection title="Picks by segment" note="Fighter picks side by side. The matching filter above is ignored for the chosen segmentation.">
      <GameCard title="Compare">
        <div className="mb-4">
          <FilterSelect
            value={segmentBy}
            onChange={(v) => onChange(v as GameSegmentBy)}
            width="w-64"
            options={(Object.keys(SEGMENT_LABELS) as GameSegmentBy[]).map((k) => ({ value: k, label: SEGMENT_LABELS[k] }))}
          />
        </div>
        {segments === null ? (
          <GameEmpty>Loading...</GameEmpty>
        ) : fighters.length === 0 ? (
          <GameEmpty />
        ) : (
          <GameTable
            rows={fighters}
            limit={20}
            rowKey={(id) => id}
            columns={[
              { label: 'Fighter', primary: true, render: (id) => humanizeId(id) },
              ...segments.map((s) => ({
                label: `${s.label} (${s.total.toLocaleString()})`,
                render: (id: string) => {
                  const f = s.fighters.find((x) => x.fighter_id === id)
                  return f ? `${f.picks.toLocaleString()} (${formatPercent(s.total > 0 ? f.picks / s.total : 0, 0)})` : '-'
                },
              })),
            ]}
          />
        )}
      </GameCard>
    </GameSection>
  )
}

function Balance({ data }: { data: GameAdminData }) {
  const wins = [...data.wins].sort((a, b) => b.win_rate - a.win_rate || b.matches - a.matches)
  const matrix = useMemo(() => buildMatchupMatrix(data.matchups), [data.matchups])
  const side = sideAdvantage(data.matches)
  return (
    <GameSection
      title="Wins and balance"
      note="Completed matches with a winner, both sides, CPU included. Results are reported by the game client."
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <GameCard title="Win rate per fighter" className="lg:col-span-2" flush>
          <GameTable
            rows={wins}
            limit={20}
            rowKey={(r) => r.fighter_id}
            columns={[
              { label: 'Fighter', primary: true, render: (r) => humanizeId(r.fighter_id) },
              { label: 'Matches', render: (r) => r.matches.toLocaleString() },
              { label: 'Wins', render: (r) => r.wins.toLocaleString() },
              { label: 'Losses', render: (r) => r.losses.toLocaleString() },
              { label: 'Win rate', render: (r) => formatPercent(r.win_rate) },
            ]}
          />
        </GameCard>
        <GameCard title="Side advantage" note="Wins by side of the screen">
          {side.decided === 0 ? (
            <GameEmpty>No decided matches</GameEmpty>
          ) : (
            <BarList
              rows={[
                { key: 'p1', label: 'Player 1', value: side.p1_wins, display: `${side.p1_wins.toLocaleString()} (${formatPercent(side.p1_share, 1)})` },
                { key: 'p2', label: 'Player 2', value: side.p2_wins, display: `${side.p2_wins.toLocaleString()} (${formatPercent(side.p2_share, 1)})` },
              ]}
            />
          )}
        </GameCard>
      </div>
      <GameCard title="Matchup win-rate matrix" note="Row fighter's win rate against the column fighter. Faded cells have fewer than 5 matches.">
        <MatchupHeatmap matrix={matrix} />
      </GameCard>
    </GameSection>
  )
}

function Trends({
  data,
  days,
  kind,
  onKind,
}: {
  data: GameAdminData
  days: string[]
  kind: TrendKind
  onKind: (k: TrendKind) => void
}) {
  const trend = useMemo(() => pivotTrend(data.trends[kind], days), [data.trends, kind, days])
  return (
    <GameSection title="Picks over time" note="Daily picks of the 8 most picked items of the period.">
      <GameCard title="Trend">
        <div className="mb-4">
          <FilterSelect
            value={kind}
            onChange={(v) => onKind(v as TrendKind)}
            width="w-40"
            options={[
              { value: 'fighters', label: 'Fighters' },
              { value: 'skins', label: 'Skins' },
              { value: 'stages', label: 'Stages' },
            ]}
          />
        </div>
        <TrendLines trend={trend} />
      </GameCard>
    </GameSection>
  )
}

function Engagement({ data, days }: { data: GameAdminData; days: string[] }) {
  const { players, active, retention } = data
  const now = latestActive(active)
  const ret = retentionSummary(retention)
  const series = fillDays(active, days, (day) => ({ day, dau: 0, wau: 0, mau: 0 }))
  return (
    <GameSection title="Engagement and retention" note="Retention ignores the device and source filters: they would move players between cohorts.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <GameStat label="DAU" value={now.dau.toLocaleString()} hint="last day of the period" />
        <GameStat label="WAU" value={now.wau.toLocaleString()} />
        <GameStat label="MAU" value={now.mau.toLocaleString()} />
        <GameStat
          label="Matches per player"
          value={players.matches_per_player === null ? '-' : players.matches_per_player.toFixed(1)}
          hint={`${players.players_with_match.toLocaleString()} players played`}
        />
        <GameStat label="D1 return" value={formatPercent(ret.d1)} />
        <GameStat label="D7 return" value={formatPercent(ret.d7)} />
        <GameStat label="D30 return" value={formatPercent(ret.d30)} />
        <GameStat label="Avg session time" value={formatDuration(players.avg_session_s)} hint={`median ${formatDuration(players.median_session_s)}`} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GameCard title="Active players over time">
          <DailyAreaChart
            data={series}
            series={[
              { key: 'dau', label: 'DAU' },
              { key: 'wau', label: 'WAU' },
              { key: 'mau', label: 'MAU' },
            ]}
          />
        </GameCard>
        <GameCard title="Retention cohorts" flush>
          <RetentionTable rows={retention} />
        </GameCard>
      </div>
    </GameSection>
  )
}

function Screens({ data }: { data: GameAdminData }) {
  return (
    <GameSection title="Screens" note="Share of game sessions reaching each screen in order, and the screen where sessions end.">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GameCard title="Screen funnel">
          <FunnelBars rows={data.funnel} />
        </GameCard>
        <GameCard title="Exit screens">
          <BarList
            rows={data.exitScreens.map((e) => ({
              key: e.screen,
              label: humanizeId(e.screen),
              value: e.game_sessions,
              display: `${e.game_sessions.toLocaleString()} (${formatPercent(e.share, 0)})`,
            }))}
          />
        </GameCard>
      </div>
    </GameSection>
  )
}

function Health({ data }: { data: GameAdminData }) {
  const { load, errors } = data
  const loadColumns = (label: string) => [
    { label, primary: true, render: (r: { group_key: string }) => humanizeId(r.group_key) },
    { label: 'Loads', render: (r: { loads: number }) => r.loads.toLocaleString() },
    { label: 'p50', render: (r: { p50_ms: number | null }) => formatMs(r.p50_ms) },
    { label: 'p95', render: (r: { p95_ms: number | null }) => formatMs(r.p95_ms) },
  ]
  const errorColumns = (label: string) => [
    { label, primary: true, render: (r: { group_key: string }) => r.group_key },
    { label: 'Sessions', render: (r: { game_sessions: number }) => r.game_sessions.toLocaleString() },
    { label: 'Errors', render: (r: { errors: number }) => r.errors.toLocaleString() },
    { label: 'Error rate', render: (r: { error_rate: number | null }) => formatPercent(r.error_rate) },
    { label: 'Crash-free', render: (r: { crash_free_rate: number | null }) => formatPercent(r.crash_free_rate) },
  ]
  return (
    <GameSection title="Health" note="Load time of the game and errors logged by the game.">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <GameStat label="Load p50" value={formatMs(load.all?.p50_ms)} hint={load.all ? `${load.all.loads.toLocaleString()} loads` : undefined} />
        <GameStat label="Load p95" value={formatMs(load.all?.p95_ms)} hint={load.all?.from_cache_share != null ? `${formatPercent(load.all.from_cache_share, 0)} from cache` : undefined} />
        <GameStat label="Sessions with errors" value={formatPercent(errors.all?.error_rate)} hint={errors.all ? `${errors.all.errors.toLocaleString()} errors` : undefined} />
        <GameStat label="Crash-free sessions" value={formatPercent(errors.all?.crash_free_rate)} />
      </div>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <GameCard title="Load time by device" flush>
          <GameTable rows={load.byDevice} rowKey={(r) => r.group_key} columns={loadColumns('Device')} />
        </GameCard>
        <GameCard title="Load time by connection" flush>
          <GameTable rows={load.byConnection} rowKey={(r) => r.group_key} columns={loadColumns('Connection')} />
        </GameCard>
        <GameCard title="Errors by build" flush>
          <GameTable rows={errors.byBuild} rowKey={(r) => r.group_key} columns={errorColumns('Build')} />
        </GameCard>
        <GameCard title="Errors by browser" flush>
          <GameTable rows={errors.byBrowser} rowKey={(r) => r.group_key} columns={errorColumns('Browser')} />
        </GameCard>
      </div>
      <GameCard title="Top errors" flush>
        <GameTable
          rows={errors.breakdown}
          rowKey={(r) => `${r.phase}/${r.code}`}
          empty="No errors in this period"
          columns={[
            { label: 'Phase', primary: true, render: (r) => humanizeId(r.phase) },
            { label: 'Code', render: (r) => r.code },
            { label: 'Errors', render: (r) => r.errors.toLocaleString() },
            { label: 'Sessions', render: (r) => r.game_sessions.toLocaleString() },
            { label: 'Last seen', render: (r) => (r.last_seen_at ? new Date(r.last_seen_at).toLocaleString() : '-') },
          ]}
        />
      </GameCard>
    </GameSection>
  )
}

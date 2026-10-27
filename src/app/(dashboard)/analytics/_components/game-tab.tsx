'use client'

// "Game" tab of the analytics page (BS-ANALYTICS-001). Gameplay numbers only;
// website traffic stays in the Traffic tab. Data comes from one server action
// that runs the game_stats_* rollups through the authenticated client (RLS cuts
// the rows to the current organization).

import { useEffect, useMemo, useState } from 'react'
import { Gamepad2, Swords, Timer, UserPlus, Users } from 'lucide-react'

import { getGameDashboardData } from '../actions'
import {
  BarList,
  DailyAreaChart,
  FunnelBars,
  GameCard,
  GameEmpty,
  GameSection,
  GameStat,
  GameTable,
  RetentionTable,
} from '@/components/analytics/game-widgets'
import {
  enumerateDays,
  fillDays,
  formatDuration,
  formatMs,
  formatPercent,
  groupSkinsByFighter,
  humanizeId,
  latestActive,
  retentionSummary,
  type GameBreakdownDimension,
  type GameBreakdownRow,
  type GameTenantData,
} from '@/lib/analytics/game-panels'

interface Props {
  from: string
  to: string
}

const BREAKDOWN_TITLES: Record<GameBreakdownDimension, string> = {
  device: 'Device',
  browser: 'Browser',
  os: 'Operating system',
  connection: 'Connection',
  source: 'Source',
}

function breakdownRows(rows: GameBreakdownRow[]) {
  return rows.map((r) => ({
    key: r.key,
    label: r.key === 'unknown' ? 'Unknown' : r.key,
    value: r.sessions,
    display: `${r.sessions.toLocaleString()} (${formatPercent(r.share, 0)})`,
    sub: [
      r.load_p50_ms !== null ? `load p50 ${formatMs(r.load_p50_ms)}` : null,
      r.error_rate !== null && r.error_rate > 0 ? `${formatPercent(r.error_rate)} with errors` : null,
    ].filter(Boolean).join(' / ') || undefined,
  }))
}

export function GameTab({ from, to }: Props) {
  const [data, setData] = useState<GameTenantData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    getGameDashboardData(from, to, tz)
      .then((d) => { if (!cancelled) setData(d) })
      .catch(() => { if (!cancelled) setError('Could not load the game analytics. Try again in a moment.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  const days = useMemo(() => {
    const f = new Date(from)
    const t = new Date(to)
    if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime())) return []
    return enumerateDays({ from: f, to: t }, Intl.DateTimeFormat().resolvedOptions().timeZone)
  }, [from, to])

  if (error) return <GameEmpty>{error}</GameEmpty>
  if (!data) return <GameEmpty>{loading ? 'Loading...' : 'No game data for this period'}</GameEmpty>
  if (!data.hasEvents) return <GameEmpty>No game events in this period</GameEmpty>

  const { players, matches, active, daily, retention, funnel, screenTime, exitScreens } = data
  const now = latestActive(active)
  const ret = retentionSummary(retention)
  const dailySeries = fillDays(daily, days, (day) => ({ day, started: 0, completed: 0, abandoned: 0 }))
  const activeSeries = fillDays(active, days, (day) => ({ day, dau: 0, wau: 0, mau: 0 }))
  const skinGroups = groupSkinsByFighter(data.skins)

  return (
    <div className={`space-y-8 transition-opacity ${loading ? 'opacity-60' : ''}`}>
      <p className="text-xs text-text-tertiary">
        Gameplay analytics, separate from website traffic. A player is a signed-in account, or the browser for guests.
      </p>

      <GameSection title="Players">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <GameStat icon={Users} label="Active players" value={players.players.toLocaleString()} hint="in this period" />
          <GameStat label="Signed in" value={players.signed_in_players.toLocaleString()} hint="registered players" />
          <GameStat label="Guests" value={players.guest_players.toLocaleString()} hint="played without an account" />
          <GameStat
            icon={UserPlus}
            label="New accounts"
            value={data.newAccounts === null ? '-' : data.newAccounts.toLocaleString()}
            hint="contacts created in this period"
          />
          <GameStat label="DAU" value={now.dau.toLocaleString()} hint="active on the last day" />
          <GameStat label="WAU" value={now.wau.toLocaleString()} hint="last 7 days" />
          <GameStat label="MAU" value={now.mau.toLocaleString()} hint="last 30 days" />
          <GameStat icon={Gamepad2} label="Game sessions" value={players.game_sessions.toLocaleString()} />
        </div>
        <GameCard title="Active players over time" note="Rolling distinct players: day, 7 days and 30 days">
          <DailyAreaChart
            data={activeSeries}
            series={[
              { key: 'dau', label: 'DAU' },
              { key: 'wau', label: 'WAU' },
              { key: 'mau', label: 'MAU' },
            ]}
          />
        </GameCard>
      </GameSection>

      <GameSection title="Matches">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <GameStat icon={Swords} label="Started" value={matches.started.toLocaleString()} />
          <GameStat label="Completed" value={matches.completed.toLocaleString()} />
          <GameStat
            label="Abandoned"
            value={matches.abandoned.toLocaleString()}
            hint={matches.abandon_rate === null ? undefined : `${formatPercent(matches.abandon_rate)} of finished matches`}
          />
          <GameStat
            label="Matches per player"
            value={players.matches_per_player === null ? '-' : players.matches_per_player.toFixed(1)}
            hint={`${players.players_with_match.toLocaleString()} players played`}
          />
          <GameStat icon={Timer} label="Avg match length" value={formatDuration(matches.avg_duration_s)} hint={`median ${formatDuration(matches.median_duration_s)}`} />
          <GameStat label="Avg session time" value={formatDuration(players.avg_session_s)} hint={`median ${formatDuration(players.median_session_s)}`} />
          <GameStat label="Long session (p95)" value={formatDuration(players.p95_session_s)} hint={`${players.timed_sessions.toLocaleString()} timed sessions`} />
          <GameStat label="In progress" value={matches.in_progress.toLocaleString()} hint="no end reported yet" />
        </div>
        <GameCard title="Matches per day">
          <DailyAreaChart
            data={dailySeries}
            series={[
              { key: 'started', label: 'Started' },
              { key: 'completed', label: 'Completed', color: '#10b981' },
              { key: 'abandoned', label: 'Abandoned', color: '#f43f5e' },
            ]}
          />
        </GameCard>
      </GameSection>

      <GameSection title="Return and frequency" note="Retention by first-seen day. A rate stays blank until the cohort is old enough.">
        <div className="grid grid-cols-3 gap-3">
          <GameStat label="D1 return" value={formatPercent(ret.d1)} hint="back the next day" />
          <GameStat label="D7 return" value={formatPercent(ret.d7)} hint="back 7 days later" />
          <GameStat label="D30 return" value={formatPercent(ret.d30)} hint="back 30 days later" />
        </div>
        <GameCard title="Cohorts" flush>
          <RetentionTable rows={retention} />
        </GameCard>
      </GameSection>

      <GameSection title="Screens" note="Game sessions that opened each screen in order.">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <GameCard title="Screen funnel">
            <FunnelBars rows={funnel} />
          </GameCard>
          <GameCard title="Where sessions end" note="Last screen of each game session">
            <BarList
              rows={exitScreens.map((e) => ({
                key: e.screen,
                label: humanizeId(e.screen),
                value: e.game_sessions,
                display: `${e.game_sessions.toLocaleString()} (${formatPercent(e.share, 0)})`,
              }))}
            />
          </GameCard>
        </div>
        <GameCard title="Time per screen" flush>
          <GameTable
            rows={screenTime}
            rowKey={(r) => r.screen}
            columns={[
              { label: 'Screen', primary: true, render: (r) => humanizeId(r.screen) },
              { label: 'Visits', render: (r) => r.samples.toLocaleString() },
              { label: 'Average', render: (r) => formatDuration(r.avg_seconds) },
              { label: 'Median', render: (r) => formatDuration(r.median_seconds) },
              { label: 'p95', render: (r) => formatDuration(r.p95_seconds) },
            ]}
          />
        </GameCard>
      </GameSection>

      <GameSection title="Picks" note="Per match entered; the second player counts only when it is not the CPU.">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <GameCard title="Fighters">
            <BarList
              rows={data.fighters.map((f) => ({
                key: f.fighter_id,
                label: humanizeId(f.fighter_id),
                value: f.picks,
                display: `${f.picks.toLocaleString()} (${formatPercent(f.share, 0)})`,
              }))}
            />
          </GameCard>
          <GameCard title="Skins">
            {skinGroups.length === 0 ? (
              <GameEmpty />
            ) : (
              <div className="space-y-4">
                {skinGroups.slice(0, 5).map((g) => (
                  <div key={g.fighter_id}>
                    <div className="mb-1.5 text-xs font-medium text-text-primary">{humanizeId(g.fighter_id)}</div>
                    <BarList
                      limit={4}
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
          <GameCard title="Stages">
            <BarList
              rows={data.stages.map((s) => ({
                key: s.stage_id,
                label: humanizeId(s.stage_id),
                value: s.picks,
                display: `${s.picks.toLocaleString()} (${formatPercent(s.share, 0)})`,
              }))}
            />
          </GameCard>
        </div>
      </GameSection>

      <GameSection title="Health" note="Load time of the game and errors logged by the game.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <GameStat label="Load p50" value={formatMs(data.load?.p50_ms)} hint={data.load ? `${data.load.loads.toLocaleString()} loads` : undefined} />
          <GameStat label="Load p95" value={formatMs(data.load?.p95_ms)} hint={data.load?.from_cache_share != null ? `${formatPercent(data.load.from_cache_share, 0)} from cache` : undefined} />
          <GameStat label="Sessions with errors" value={formatPercent(data.errors?.error_rate)} hint={data.errors ? `${data.errors.errors.toLocaleString()} errors` : undefined} />
          <GameStat label="Crash-free sessions" value={formatPercent(data.errors?.crash_free_rate)} />
        </div>
        <GameCard title="Top errors" flush>
          <GameTable
            rows={data.errorBreakdown}
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

      <GameSection title="Who plays" note="Game sessions by device, browser, operating system, connection and source.">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
          {(Object.keys(BREAKDOWN_TITLES) as GameBreakdownDimension[]).map((dim) => (
            <GameCard key={dim} title={BREAKDOWN_TITLES[dim]}>
              <BarList rows={breakdownRows(data.breakdowns[dim])} />
            </GameCard>
          ))}
        </div>
      </GameSection>
    </div>
  )
}

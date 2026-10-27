'use client'

// Presentational building blocks shared by the tenant "Game" tab and the admin
// global game panels (BS-ANALYTICS-001). Same look as the traffic dashboard:
// shadcn Card, recharts with the page's tooltip style, thin bar lists.
// No data fetching here, no player-facing ranking: aggregate counts only.

import type { ReactNode } from 'react'
import {
  Area, AreaChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  formatPercent,
  humanizeId,
  type MatchupMatrix,
  type TrendSeries,
} from '@/lib/analytics/game-panels'
import type { GameRetentionRow } from '@/lib/analytics/game-queries'

/** Distinct, colour-blind friendly series colours; the first follows the page accent. */
export const GAME_SERIES_COLORS = [
  'var(--color-accent)',
  '#6366f1',
  '#10b981',
  '#f59e0b',
  '#f43f5e',
  '#0ea5e9',
  '#8b5cf6',
  '#14b8a6',
] as const

const TOOLTIP_STYLE = {
  fontSize: 12,
  borderRadius: 6,
  border: '1px solid var(--color-border)',
  background: 'var(--color-bg-secondary)',
} as const

// ─── Layout ───────────────────────────────────────────────────────────────────

export function GameSection({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
        {note && <p className="text-xs text-text-tertiary">{note}</p>}
      </div>
      {children}
    </section>
  )
}

export function GameCard({
  title,
  note,
  children,
  className,
  flush,
}: {
  title: string
  note?: string
  children: ReactNode
  className?: string
  /** No inner padding: for tables that bring their own cell padding. */
  flush?: boolean
}) {
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
        {note && <p className="text-xs text-text-tertiary font-normal">{note}</p>}
      </CardHeader>
      <CardContent className={flush ? 'p-0' : undefined}>{children}</CardContent>
    </Card>
  )
}

export function GameEmpty({ children = 'No data for this period' }: { children?: ReactNode }) {
  return <p className="px-1 py-6 text-center text-sm text-text-tertiary">{children}</p>
}

export function GameStat({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string
  value: string
  hint?: string
  icon?: React.ComponentType<{ className?: string }>
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-text-tertiary mb-2">
          {Icon && <Icon className="h-4 w-4" />}
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="text-2xl font-bold text-text-primary tabular-nums">{value}</div>
        {hint && <div className="mt-0.5 text-[11px] text-text-tertiary">{hint}</div>}
      </CardContent>
    </Card>
  )
}

// ─── Bars ─────────────────────────────────────────────────────────────────────

export interface BarRow {
  key: string
  label: string
  value: number
  /** Right-hand text; defaults to the value. */
  display?: string
  /** Small grey text under the label. */
  sub?: string
}

/** Horizontal bars scaled to the largest value (same style as the traffic Locations card). */
export function BarList({ rows, limit = 8, empty }: { rows: BarRow[]; limit?: number; empty?: string }) {
  if (rows.length === 0) return <GameEmpty>{empty}</GameEmpty>
  const shown = rows.slice(0, limit)
  const max = Math.max(...shown.map((r) => r.value), 1)
  return (
    <div className="space-y-2.5">
      {shown.map((r) => (
        <div key={r.key} className="flex items-center gap-2">
          <div className="w-32 shrink-0">
            <div className="truncate text-xs text-text-secondary" title={r.label}>{r.label}</div>
            {r.sub && <div className="truncate text-[10px] text-text-tertiary">{r.sub}</div>}
          </div>
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
            <div className="h-full rounded-full bg-accent/60" style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-text-tertiary">{r.display ?? r.value.toLocaleString()}</span>
        </div>
      ))}
    </div>
  )
}

export interface FunnelRow {
  screen: string
  game_sessions: number
  pct_of_previous: number | null
  pct_of_first: number | null
}

/** Funnel steps as bars relative to the first step, with the step-to-step conversion. */
export function FunnelBars({ rows }: { rows: FunnelRow[] }) {
  const first = rows[0]?.game_sessions ?? 0
  if (rows.length === 0 || first === 0) return <GameEmpty>No game sessions reached the first screen</GameEmpty>
  return (
    <div className="space-y-3">
      {rows.map((r, i) => (
        <div key={r.screen}>
          <div className="mb-1 flex items-baseline justify-between text-xs">
            <span className="text-text-secondary">{i + 1}. {humanizeId(r.screen)}</span>
            <span className="tabular-nums text-text-tertiary">
              {r.game_sessions.toLocaleString()}
              {i > 0 && <> &middot; {formatPercent(r.pct_of_previous, 0)} of previous</>}
              {i > 0 && <> &middot; {formatPercent(r.pct_of_first, 0)} of first</>}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-bg-tertiary">
            <div className="h-full rounded-full bg-accent/60" style={{ width: `${first > 0 ? (r.game_sessions / first) * 100 : 0}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── Charts ───────────────────────────────────────────────────────────────────

function shortDay(day: string): string {
  return day.length >= 10 ? day.slice(5) : day
}

export interface SeriesDef { key: string; label: string; color?: string }

/** Daily area chart (same look as the visitors chart). `data` rows need a `day` field. */
export function DailyAreaChart({
  data,
  series,
  height = 200,
  empty,
}: {
  data: object[]
  series: SeriesDef[]
  height?: number
  empty?: string
}) {
  if (data.length === 0) return <GameEmpty>{empty}</GameEmpty>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="day" tickFormatter={shortDay} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {series.map((s, i) => {
          const color = s.color ?? GAME_SERIES_COLORS[i % GAME_SERIES_COLORS.length]
          return (
            <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={color} fill={color} fillOpacity={0.12} strokeWidth={2} />
          )
        })}
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** One line per item of a pivoted trend (picks per day of the top fighters, skins or stages). */
export function TrendLines({ trend, height = 240, empty }: { trend: TrendSeries; height?: number; empty?: string }) {
  if (trend.items.length === 0 || trend.points.length === 0) return <GameEmpty>{empty}</GameEmpty>
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={trend.points} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
        <XAxis dataKey="day" tickFormatter={(v) => shortDay(String(v))} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <RechartsTooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {trend.items.map((item, i) => (
          <Line
            key={item}
            type="monotone"
            dataKey={item}
            name={item}
            stroke={GAME_SERIES_COLORS[i % GAME_SERIES_COLORS.length]}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── Tables ───────────────────────────────────────────────────────────────────

export interface TableColumn<T> {
  label: string
  render: (row: T) => ReactNode
  /** First column: left aligned, primary text colour. */
  primary?: boolean
}

export function GameTable<T>({
  rows,
  columns,
  rowKey,
  limit = 10,
  empty,
}: {
  rows: T[]
  columns: TableColumn<T>[]
  rowKey: (row: T, index: number) => string
  limit?: number
  empty?: string
}) {
  if (rows.length === 0) return <GameEmpty>{empty}</GameEmpty>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            {columns.map((c) => (
              <th key={c.label} className={`px-5 py-2.5 text-xs font-medium text-text-tertiary ${c.primary ? 'text-left' : 'text-right'}`}>
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, limit).map((row, i) => (
            <tr key={rowKey(row, i)} className="border-b border-border/50 last:border-0 hover:bg-bg-tertiary/30 transition-colors">
              {columns.map((c) => (
                <td
                  key={c.label}
                  className={`px-5 py-2.5 ${c.primary ? 'max-w-[220px] truncate font-medium text-text-primary' : 'text-right tabular-nums text-text-secondary'}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── Retention ────────────────────────────────────────────────────────────────

function rateCell(rate: number | null) {
  if (rate === null) return <span className="text-text-tertiary">-</span>
  return (
    <span
      className="inline-block min-w-12 rounded px-1.5 py-0.5 text-xs tabular-nums"
      style={{ background: `color-mix(in srgb, var(--color-accent) ${Math.round(Math.min(rate, 1) * 60)}%, transparent)` }}
    >
      {formatPercent(rate, 0)}
    </span>
  )
}

/** Cohort table: first-seen day, cohort size and D1 / D7 / D30 (blank while the cohort is too young). */
export function RetentionTable({ rows, limit = 14 }: { rows: GameRetentionRow[]; limit?: number }) {
  const shown = [...rows].filter((r) => r.cohort_size > 0).sort((a, b) => b.cohort_day.localeCompare(a.cohort_day))
  return (
    <GameTable
      rows={shown}
      limit={limit}
      empty="No cohorts in this period"
      rowKey={(r) => r.cohort_day}
      columns={[
        { label: 'First seen', primary: true, render: (r) => r.cohort_day },
        { label: 'Players', render: (r) => r.cohort_size.toLocaleString() },
        { label: 'D1', render: (r) => rateCell(r.d1_rate) },
        { label: 'D7', render: (r) => rateCell(r.d7_rate) },
        { label: 'D30', render: (r) => rateCell(r.d30_rate) },
      ]}
    />
  )
}

// ─── Matchup matrix ───────────────────────────────────────────────────────────

/** Minimum matches before a matchup cell counts as more than noise. */
export const MATCHUP_MIN_SAMPLE = 5

function matchupColor(winRate: number, matches: number): string {
  const strength = Math.min(Math.abs(winRate - 0.5) * 2, 1)
  const alpha = (0.1 + strength * 0.55) * (matches >= MATCHUP_MIN_SAMPLE ? 1 : 0.45)
  return winRate >= 0.5 ? `rgba(34, 197, 94, ${alpha.toFixed(2)})` : `rgba(239, 68, 68, ${alpha.toFixed(2)})`
}

/**
 * Win rate of the row fighter against the column fighter. Green above 50 %, red
 * below; cells under MATCHUP_MIN_SAMPLE matches are faded. Balance tooling for
 * the studio only: it is never shown to players.
 */
export function MatchupHeatmap({ matrix }: { matrix: MatchupMatrix }) {
  if (matrix.fighters.length < 2) return <GameEmpty>No completed matches with a winner yet</GameEmpty>
  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-1 text-xs">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left font-medium text-text-tertiary">Row beats column</th>
            {matrix.fighters.map((f) => (
              <th key={f} className="px-2 py-1 text-center font-medium text-text-tertiary">{humanizeId(f)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {matrix.fighters.map((row) => (
            <tr key={row}>
              <th className="whitespace-nowrap px-2 py-1 text-left font-medium text-text-primary">{humanizeId(row)}</th>
              {matrix.fighters.map((col) => {
                const cell = matrix.cells[row]?.[col]
                if (row === col) {
                  return <td key={col} className="rounded bg-bg-tertiary/40 px-2 py-2 text-center text-text-tertiary">-</td>
                }
                if (!cell) return <td key={col} className="rounded bg-bg-tertiary/20 px-2 py-2 text-center text-text-tertiary">&middot;</td>
                return (
                  <td
                    key={col}
                    className="rounded px-2 py-1.5 text-center tabular-nums"
                    style={{ background: matchupColor(cell.win_rate, cell.matches) }}
                    title={`${humanizeId(row)} vs ${humanizeId(col)}: ${cell.wins} wins in ${cell.matches} matches${cell.matches < MATCHUP_MIN_SAMPLE ? ' (small sample)' : ''}`}
                  >
                    <div className="font-medium text-text-primary">{formatPercent(cell.win_rate, 0)}</div>
                    <div className="text-[10px] text-text-tertiary">n={cell.matches}</div>
                  </td>
                )
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

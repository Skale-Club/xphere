'use client'

import { useState, useEffect, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Users, Globe, MousePointerClick, Eye, TrendingUp, Target,
  Monitor, Smartphone, Tablet, RefreshCw, Calendar,
} from 'lucide-react'
import {
  Area, AreaChart, CartesianGrid, ResponsiveContainer,
  Tooltip as RechartsTooltip, XAxis, YAxis,
} from 'recharts'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { getDashboardData } from '../actions'
import type {
  TrafficMetrics, GeoRow, DeviceRow, RecentSession,
} from '@/lib/traffic/types'
import { trendPct } from '@/lib/traffic/queries'

interface Props {
  setup: { script_token: string; primary_website_url: string | null }
}

type Period = '7d' | '30d' | 'today' | 'yesterday' | 'month' | 'last_month'

function getRangeDates(period: Period): { from: string; to: string } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today.getTime() + 864e5)

  switch (period) {
    case 'today':
      return { from: today.toISOString(), to: tomorrow.toISOString() }
    case 'yesterday': {
      const y = new Date(today.getTime() - 864e5)
      return { from: y.toISOString(), to: today.toISOString() }
    }
    case '7d': {
      const f = new Date(today.getTime() - 7 * 864e5)
      return { from: f.toISOString(), to: tomorrow.toISOString() }
    }
    case '30d': {
      const f = new Date(today.getTime() - 30 * 864e5)
      return { from: f.toISOString(), to: tomorrow.toISOString() }
    }
    case 'month': {
      const f = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: f.toISOString(), to: tomorrow.toISOString() }
    }
    case 'last_month': {
      const f = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const t = new Date(now.getFullYear(), now.getMonth(), 1)
      return { from: f.toISOString(), to: t.toISOString() }
    }
  }
}

function TrendBadge({ current, prev }: { current: number; prev: number }) {
  const pct = trendPct(current, prev)
  if (pct === null) return null
  const up = pct >= 0
  return (
    <span className={`inline-flex items-center text-[11px] font-medium ${up ? 'text-green-600' : 'text-red-500'}`}>
      {up ? '↑' : '↓'} {Math.abs(pct)}%
    </span>
  )
}

function StatCard({
  icon: Icon,
  label,
  value,
  prev,
  formatter,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  prev: number
  formatter?: (v: number) => string
}) {
  const fmt = formatter ?? ((v) => v.toLocaleString())
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-center gap-2 text-text-tertiary mb-2">
          <Icon className="h-4 w-4" />
          <span className="text-xs font-medium">{label}</span>
        </div>
        <div className="flex items-end gap-2">
          <span className="text-2xl font-bold text-text-primary">{fmt(value)}</span>
          <TrendBadge current={value} prev={prev} />
        </div>
      </CardContent>
    </Card>
  )
}

function DeviceIcon({ type }: { type: string }) {
  if (type === 'mobile') return <Smartphone className="h-4 w-4" />
  if (type === 'tablet') return <Tablet className="h-4 w-4" />
  return <Monitor className="h-4 w-4" />
}

type DashboardData = Awaited<ReturnType<typeof getDashboardData>>

export function DashboardView({ setup }: Props) {
  const router = useRouter()
  const [period, setPeriod] = useState<Period>('30d')
  const [data, setData] = useState<DashboardData | null>(null)
  const [isLoading, startTransition] = useTransition()

  function load(p: Period) {
    const { from, to } = getRangeDates(p)
    startTransition(async () => {
      const d = await getDashboardData(from, to)
      setData(d)
    })
  }

  useEffect(() => { load(period) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handlePeriodChange(v: string) {
    const p = v as Period
    setPeriod(p)
    load(p)
  }

  const m: TrafficMetrics | null = data?.metrics ?? null

  return (
    <div className="mx-auto w-full px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text-primary">Traffic</h1>
          <p className="text-sm text-text-tertiary">{setup.primary_website_url}</p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={period} onValueChange={handlePeriodChange}>
            <SelectTrigger className="h-8 w-36 text-xs">
              <Calendar className="h-3.5 w-3.5 mr-1.5" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="yesterday">Yesterday</SelectItem>
              <SelectItem value="7d">Last 7 days</SelectItem>
              <SelectItem value="30d">Last 30 days</SelectItem>
              <SelectItem value="month">This month</SelectItem>
              <SelectItem value="last_month">Last month</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => load(period)} disabled={isLoading}>
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </Button>
          <Button variant="ghost" size="sm" onClick={() => router.push('/settings/traffic')} className="text-xs text-text-tertiary">
            Settings
          </Button>
        </div>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard icon={Users} label="Visitors" value={m?.visitors ?? 0} prev={m?.prev_visitors ?? 0} />
        <StatCard icon={Globe} label="Sessions" value={m?.sessions ?? 0} prev={m?.prev_sessions ?? 0} />
        <StatCard icon={Eye} label="Page Views" value={m?.page_views ?? 0} prev={m?.prev_page_views ?? 0} />
        <StatCard icon={MousePointerClick} label="Conversions" value={m?.conversions ?? 0} prev={m?.prev_conversions ?? 0} />
        <StatCard
          icon={TrendingUp}
          label="Conv. Rate"
          value={m?.conversion_rate ?? 0}
          prev={m && m.prev_sessions > 0 ? Math.round((m.prev_conversions / m.prev_sessions) * 1000) / 10 : 0}
          formatter={(v) => `${v}%`}
        />
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-text-tertiary mb-2">
              <Target className="h-4 w-4" />
              <span className="text-xs font-medium">Top Source</span>
            </div>
            <div className="text-sm font-semibold text-text-primary truncate">{m?.top_source ?? '—'}</div>
          </CardContent>
        </Card>
      </div>

      {/* Sessions over time chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Visitors & sessions over time</CardTitle>
        </CardHeader>
        <CardContent>
          {data?.timeSeries && data.timeSeries.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <AreaChart data={data.timeSeries} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="tv" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--color-accent)" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="var(--color-accent)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="ts" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#6366f1" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <RechartsTooltip
                  contentStyle={{ fontSize: 12, borderRadius: 6, border: '1px solid var(--color-border)', background: 'var(--color-bg-secondary)' }}
                />
                <Area type="monotone" dataKey="visitors" stroke="var(--color-accent)" fill="url(#tv)" strokeWidth={2} name="Visitors" />
                <Area type="monotone" dataKey="sessions" stroke="#6366f1" fill="url(#ts)" strokeWidth={2} name="Sessions" />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex h-48 items-center justify-center text-sm text-text-tertiary">
              {isLoading ? 'Loading…' : 'No data for this period'}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Two-column tables */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TableCard title="Traffic Sources" rows={data?.sources ?? []} columns={[
          { key: 'source', label: 'Source', primary: true },
          { key: 'sessions', label: 'Sessions' },
          { key: 'conversions', label: 'Conv.' },
        ]} />
        <TableCard title="UTM Campaigns" rows={data?.campaigns ?? []} columns={[
          { key: 'campaign', label: 'Campaign', primary: true },
          { key: 'sessions', label: 'Sessions' },
          { key: 'conversions', label: 'Conv.' },
        ]} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <TableCard title="Top Landing Pages" rows={data?.landingPages ?? []} columns={[
          { key: 'path', label: 'Page', primary: true },
          { key: 'sessions', label: 'Sessions' },
          { key: 'views', label: 'Views' },
        ]} />
        <TableCard title="Top Pages" rows={data?.topPages ?? []} columns={[
          { key: 'path', label: 'Page', primary: true },
          { key: 'views', label: 'Views' },
          { key: 'sessions', label: 'Sessions' },
        ]} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Geo */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Locations</CardTitle>
          </CardHeader>
          <CardContent>
            <GeoTable rows={data?.geo ?? []} />
          </CardContent>
        </Card>

        {/* Devices */}
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Devices</CardTitle>
          </CardHeader>
          <CardContent>
            <DeviceTable rows={data?.devices ?? []} total={m?.sessions ?? 0} />
          </CardContent>
        </Card>
      </div>

      {/* Recent sessions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Recent sessions</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <RecentSessionsTable rows={data?.recent ?? []} />
        </CardContent>
      </Card>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function TableCard<T>({
  title,
  rows,
  columns,
}: {
  title: string
  rows: T[]
  columns: { key: Extract<keyof T, string>; label: string; primary?: boolean }[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {rows.length === 0 ? (
          <p className="px-5 py-4 text-sm text-text-tertiary">No data</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                {columns.map((c) => (
                  <th key={c.key} className={`px-5 py-2.5 text-left text-xs font-medium text-text-tertiary ${c.primary ? '' : 'text-right'}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((row, i) => {
                const primaryCol = columns.find((c) => c.primary)
                const rowKey = primaryCol ? `${String(row[primaryCol.key] ?? '')}-${i}` : `row-${i}`
                return (
                  <tr key={rowKey} className="border-b border-border/50 last:border-0 hover:bg-bg-tertiary/30 transition-colors">
                    {columns.map((c) => (
                      <td key={c.key} className={`px-5 py-2.5 ${c.primary ? 'text-text-primary font-medium truncate max-w-[200px]' : 'text-right text-text-secondary tabular-nums'}`}>
                        {String(row[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}

function GeoTable({ rows }: { rows: GeoRow[] }) {
  if (rows.length === 0) return <p className="text-sm text-text-tertiary py-2">No data</p>
  const max = rows[0]?.sessions ?? 1
  return (
    <div className="space-y-2">
      {rows.slice(0, 8).map((r) => (
        <div key={r.country_name} className="flex items-center gap-2">
          <span className="text-xs text-text-secondary w-28 shrink-0 truncate">{r.country_name}</span>
          <div className="flex-1 h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
            <div className="h-full rounded-full bg-accent/60" style={{ width: `${Math.round((r.sessions / max) * 100)}%` }} />
          </div>
          <span className="text-xs text-text-tertiary tabular-nums w-8 text-right">{r.sessions}</span>
        </div>
      ))}
    </div>
  )
}

function DeviceTable({ rows, total }: { rows: DeviceRow[]; total: number }) {
  if (rows.length === 0) return <p className="text-sm text-text-tertiary py-2">No data</p>
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const pct = total > 0 ? Math.round((r.sessions / total) * 100) : 0
        return (
          <div key={r.device_type} className="flex items-center gap-3">
            <DeviceIcon type={r.device_type} />
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-1">
                <span className="capitalize text-text-secondary">{r.device_type}</span>
                <span className="text-text-tertiary tabular-nums">{pct}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-bg-tertiary overflow-hidden">
                <div className="h-full rounded-full bg-accent/60" style={{ width: `${pct}%` }} />
              </div>
            </div>
            <span className="text-xs text-text-tertiary tabular-nums w-8 text-right">{r.sessions}</span>
          </div>
        )
      })}
    </div>
  )
}

function RecentSessionsTable({ rows }: { rows: RecentSession[] }) {
  if (rows.length === 0) return <p className="px-5 py-4 text-sm text-text-tertiary">No sessions yet</p>
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-border">
          <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary">Page</th>
          <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary">Source</th>
          <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary">Device</th>
          <th className="px-5 py-2.5 text-left text-xs font-medium text-text-tertiary">Country</th>
          <th className="px-5 py-2.5 text-right text-xs font-medium text-text-tertiary">Conv.</th>
          <th className="px-5 py-2.5 text-right text-xs font-medium text-text-tertiary">Time</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((s) => {
          let path = s.landing_page ?? '/'
          try { path = new URL(s.landing_page ?? '/').pathname } catch { /* ok */ }
          return (
            <tr key={s.id} className="border-b border-border/50 last:border-0 hover:bg-bg-tertiary/30 transition-colors">
              <td className="px-5 py-2.5 text-text-primary font-medium truncate max-w-[160px]">{path}</td>
              <td className="px-5 py-2.5 text-text-secondary text-xs">{s.utm_source ?? 'direct'}</td>
              <td className="px-5 py-2.5">
                <DeviceIcon type={s.device_type ?? 'desktop'} />
              </td>
              <td className="px-5 py-2.5 text-text-secondary text-xs">{s.country_name ?? '—'}</td>
              <td className="px-5 py-2.5 text-right">
                {s.is_converted ? (
                  <span className="inline-flex items-center rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-600">Yes</span>
                ) : (
                  <span className="text-text-tertiary text-xs">—</span>
                )}
              </td>
              <td className="px-5 py-2.5 text-right text-xs text-text-tertiary tabular-nums">
                {new Date(s.started_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

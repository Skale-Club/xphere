'use client'

import { useId } from 'react'
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ReferenceLine,
} from 'recharts'

export type DailyTrendRow = {
  date: string
  spend: number
  leads: number
  cpl: number | null
  purchases: number
  cpp: number | null
}

function fmtCurrency(n: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtCurrencyShort(n: number, currency: string): string {
  if (n >= 1000) return `${new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n / 1000)}K`
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function SpendConversionChart({
  data,
  currency,
  gradientId,
  conversionKey,
  conversionLabel,
}: {
  data: DailyTrendRow[]
  currency: string
  gradientId: string
  conversionKey: 'leads' | 'purchases'
  conversionLabel: string
}) {
  return (
    <div>
      <p className="text-[12px] font-semibold text-text-primary mb-1">Spend vs {conversionLabel}</p>
      <p className="text-[11px] text-text-tertiary mb-3">Daily trend</p>
      <div className="h-[220px] w-full min-w-0">
        <ResponsiveContainer width="100%" height={220} minWidth={0}>
          <ComposedChart data={data} margin={{ top: 8, right: 40, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.3} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => fmtCurrencyShort(v, currency)}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
              width={36}
              allowDecimals={false}
            />
            <RechartsTooltip
              cursor={{ stroke: 'var(--accent)', strokeWidth: 1, strokeDasharray: '4 4' }}
              contentStyle={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text-primary)',
                boxShadow: 'var(--shadow-md)',
              }}
              labelStyle={{ color: 'var(--text-tertiary)', fontSize: 11 }}
              formatter={(value, name) => {
                const v = typeof value === 'number' ? value : Number(value)
                if (name === 'spend') return [fmtCurrency(v, currency), 'Spend']
                if (name === conversionKey) return [v, conversionLabel]
                return [v, name as string]
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="spend"
              stroke="var(--accent)"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              animationDuration={600}
            />
            <Line
              yAxisId="right"
              type="monotone"
              dataKey={conversionKey}
              stroke="#16A34A"
              strokeWidth={2}
              dot={false}
              animationDuration={600}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-4 mt-2">
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-accent" />
          <span className="text-[11px] text-text-tertiary">Spend</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-2 w-2 rounded-full bg-green-500" />
          <span className="text-[11px] text-text-tertiary">{conversionLabel}</span>
        </div>
      </div>
    </div>
  )
}

function CostPerConversionChart({
  data,
  currency,
  gradientId,
  costKey,
  label,
  emptyMessage,
}: {
  data: DailyTrendRow[]
  currency: string
  gradientId: string
  costKey: 'cpl' | 'cpp'
  label: string
  emptyMessage: string
}) {
  const filtered = data.filter((d) => d[costKey] !== null)
  const avg =
    filtered.length > 0
      ? filtered.reduce((sum, d) => sum + (d[costKey] ?? 0), 0) / filtered.length
      : null

  if (filtered.length === 0) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-secondary/50 px-4 py-6 text-center">
        <p className="text-[12px] text-text-tertiary">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-[12px] font-semibold text-text-primary">{label} Trend</p>
        {avg != null && (
          <span className="text-[11px] text-text-tertiary">
            Avg: {fmtCurrency(avg, currency)}
          </span>
        )}
      </div>
      <p className="text-[11px] text-text-tertiary mb-3">{label} by day</p>
      <div className="h-[160px] w-full min-w-0">
        <ResponsiveContainer width="100%" height={160} minWidth={0}>
          <AreaChart data={filtered} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#D97706" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#D97706" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
            <XAxis
              dataKey="date"
              tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }}
              tickLine={false}
              axisLine={false}
              width={52}
              tickFormatter={(v: number) => fmtCurrencyShort(v, currency)}
            />
            {avg != null && (
              <ReferenceLine
                y={avg}
                stroke="#D97706"
                strokeDasharray="4 4"
                strokeOpacity={0.5}
              />
            )}
            <RechartsTooltip
              cursor={{ stroke: '#D97706', strokeWidth: 1, strokeDasharray: '4 4' }}
              contentStyle={{
                background: 'var(--bg-elevated)',
                border: '1px solid var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text-primary)',
                boxShadow: 'var(--shadow-md)',
              }}
              labelStyle={{ color: 'var(--text-tertiary)', fontSize: 11 }}
              formatter={(value) => [fmtCurrency(typeof value === 'number' ? value : Number(value), currency), label]}
            />
            <Area
              type="monotone"
              dataKey={costKey}
              stroke="#D97706"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              animationDuration={600}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

export function MetaTrendCharts({
  data,
  currency,
  loading,
  adObjective,
}: {
  data: DailyTrendRow[]
  currency: string
  loading: boolean
  adObjective: 'leads' | 'sales'
}) {
  const spendGradId = useId()
  const costGradId = useId()

  if (loading) {
    return (
      <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4 space-y-4 md:col-span-2">
        <div className="h-4 w-32 rounded bg-bg-tertiary animate-pulse" />
        <div className="h-[220px] rounded-lg bg-bg-tertiary animate-pulse" />
        <div className="h-[160px] rounded-lg bg-bg-tertiary animate-pulse" />
      </div>
    )
  }

  if (data.length < 2) {
    return (
      <div className="rounded-xl border border-border-subtle bg-bg-secondary p-6 md:col-span-2 flex items-center justify-center">
        <p className="text-[13px] text-text-tertiary">
          Daily trend requires at least 2 days of data. Select a wider date range.
        </p>
      </div>
    )
  }

  const isSales = adObjective === 'sales'

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4 md:col-span-2 space-y-6">
      <SpendConversionChart
        data={data}
        currency={currency}
        gradientId={spendGradId}
        conversionKey={isSales ? 'purchases' : 'leads'}
        conversionLabel={isSales ? 'Purchases' : 'Leads'}
      />
      <div className="border-t border-border-subtle" />
      <CostPerConversionChart
        data={data}
        currency={currency}
        gradientId={costGradId}
        costKey={isSales ? 'cpp' : 'cpl'}
        label={isSales ? 'Cost per Purchase' : 'CPL'}
        emptyMessage={
          isSales
            ? 'No purchase data for this period.'
            : 'No CPL data for this period — leads required.'
        }
      />
    </div>
  )
}

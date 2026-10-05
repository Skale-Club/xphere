'use client'

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'

/** Daily clicks (left axis) and impressions (right axis). */
export function GscPerformanceChart({ data }: { data: Array<{ label: string; clicks: number; impressions: number }> }) {
  return (
    <div className="h-[260px] w-full min-w-0">
      <ResponsiveContainer width="100%" height={260} minWidth={0}>
        <LineChart data={data} margin={{ top: 8, right: 0, left: -8, bottom: 0 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} tickLine={false} axisLine={false} minTickGap={24} />
          <YAxis yAxisId="clicks" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} tickLine={false} axisLine={false} width={44} allowDecimals={false} />
          <YAxis yAxisId="impressions" orientation="right" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} tickLine={false} axisLine={false} width={52} allowDecimals={false} />
          <RechartsTooltip
            contentStyle={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
            labelStyle={{ color: 'var(--text-tertiary)', fontSize: 11 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Line yAxisId="clicks" type="monotone" dataKey="clicks" name="Clicks" stroke="var(--accent)" strokeWidth={2} dot={false} animationDuration={600} />
          <Line
            yAxisId="impressions"
            type="monotone"
            dataKey="impressions"
            name="Impressions"
            stroke="var(--text-tertiary)"
            strokeWidth={1.5}
            strokeDasharray="4 3"
            dot={false}
            animationDuration={600}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

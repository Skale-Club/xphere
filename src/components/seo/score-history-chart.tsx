'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts'

/** Health score per completed audit, oldest → newest. */
export function ScoreHistoryChart({ data }: { data: { label: string; score: number }[] }) {
  if (data.length < 2) {
    return <p className="py-10 text-center text-sm text-text-tertiary">The trend appears after the second audit.</p>
  }
  return (
    <div className="h-[180px] w-full min-w-0">
      <ResponsiveContainer width="100%" height={180} minWidth={0}>
        <LineChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid stroke="var(--border-subtle)" strokeDasharray="2 4" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} tickLine={false} axisLine={false} />
          <YAxis domain={[0, 100]} ticks={[0, 50, 100]} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} tickLine={false} axisLine={false} width={40} />
          <RechartsTooltip
            contentStyle={{
              background: 'var(--bg-elevated)',
              border: '1px solid var(--border)',
              borderRadius: 8,
              fontSize: 12,
              color: 'var(--text-primary)',
            }}
            labelStyle={{ color: 'var(--text-tertiary)', fontSize: 11 }}
            formatter={(v) => [v, 'Health score']}
          />
          <Line type="monotone" dataKey="score" stroke="var(--accent)" strokeWidth={2} dot={{ r: 3 }} animationDuration={600} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

'use client'

import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

export type PerfDay = { date: string; impressions: number; calls: number; website: number; directions: number }
export type SearchKeyword = { keyword: string; impressions: number | null; threshold: number | null }

const SERIES = [
  { key: 'impressions', label: 'Profile views', color: '#6366f1' },
  { key: 'calls', label: 'Calls', color: '#10b981' },
  { key: 'website', label: 'Website clicks', color: '#0ea5e9' },
  { key: 'directions', label: 'Directions', color: '#f59e0b' },
] as const

export function GbpPerformance({ days, keywords, month }: { days: PerfDay[]; keywords: SearchKeyword[]; month: string | null }) {
  const totals = SERIES.map((s) => ({ ...s, total: days.reduce((a, d) => a + d[s.key], 0) }))
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-semibold text-text-primary">Google Business Profile — last 90 days</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {totals.map((t) => (
          <div key={t.key} className="rounded-xl border border-border-subtle p-3">
            <div className="text-[12px] text-text-secondary">{t.label}</div>
            <div className="text-xl font-semibold tabular-nums text-text-primary">{t.total.toLocaleString()}</div>
          </div>
        ))}
      </div>
      {days.length > 1 && (
        <div className="h-[280px] rounded-xl border border-border-subtle p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={days} margin={{ top: 8, right: 16, bottom: 0, left: -8 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle, #e5e7eb)" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="views" tick={{ fontSize: 11 }} />
              <YAxis yAxisId="actions" orientation="right" tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {SERIES.map((s) => (
                <Line
                  key={s.key}
                  yAxisId={s.key === 'impressions' ? 'views' : 'actions'}
                  type="monotone"
                  dataKey={s.key}
                  name={s.label}
                  stroke={s.color}
                  strokeWidth={2}
                  dot={false}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {keywords.length > 0 && (
        <div className="rounded-xl border border-border-subtle p-4">
          <h3 className="mb-2 text-[13px] font-semibold text-text-primary">
            Searches that showed the profile{month ? ` · ${new Date(month).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}` : ''}
          </h3>
          <ol className="grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
            {keywords.map((k) => (
              <li key={k.keyword} className="flex justify-between gap-3">
                <span className="truncate text-text-primary">{k.keyword}</span>
                <span className="tabular-nums text-text-secondary">{k.impressions !== null ? k.impressions.toLocaleString() : `< ${k.threshold}`}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  )
}

import { ArrowDown, ArrowUp } from 'lucide-react'

import { cn } from '@/lib/utils'

import { BAND_COLORS, type GridPin } from './geogrid-pins'

export type MetricSet = { arp: number | null; atrp: number | null; solv: number | null; foundPct: number | null }

/** Delta chip. For rank metrics lower is better, so the arrow colour flips. */
function Delta({ now, before, lowerIsBetter, suffix = '' }: { now: number | null; before: number | null; lowerIsBetter?: boolean; suffix?: string }) {
  if (now === null || before === null) return null
  const diff = Math.round((now - before) * 100) / 100
  if (diff === 0) return <span className="text-[11px] text-text-tertiary">no change</span>
  const better = lowerIsBetter ? diff < 0 : diff > 0
  const Icon = diff > 0 ? ArrowUp : ArrowDown
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-[11px] font-medium', better ? 'text-success' : 'text-danger')}>
      <Icon className="h-3 w-3" />
      {Math.abs(diff)}
      {suffix}
    </span>
  )
}

function Donut({ pins }: { pins: GridPin[] }) {
  const done = pins.filter((p) => p.status === 'done')
  const bands = [
    { key: 'top3', label: 'Top 3', color: BAND_COLORS.top3, n: done.filter((p) => p.rank !== null && p.rank <= 3).length },
    { key: 'mid', label: '4–10', color: BAND_COLORS.mid, n: done.filter((p) => p.rank !== null && p.rank > 3 && p.rank <= 10).length },
    { key: 'low', label: '11–20', color: BAND_COLORS.low, n: done.filter((p) => p.rank !== null && p.rank > 10).length },
    { key: 'none', label: '20+', color: BAND_COLORS.none, n: done.filter((p) => p.rank === null).length },
  ]
  const total = done.length || 1
  const r = 36
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90" aria-hidden>
        <circle cx={50} cy={50} r={r} fill="none" strokeWidth={14} className="stroke-bg-tertiary" />
        {bands.map((b) => {
          const len = (b.n / total) * c
          const el = (
            <circle
              key={b.key}
              cx={50}
              cy={50}
              r={r}
              fill="none"
              stroke={b.color}
              strokeWidth={14}
              strokeDasharray={`${len} ${c - len}`}
              strokeDashoffset={-offset}
            />
          )
          offset += len
          return el
        })}
      </svg>
      <ul className="space-y-1 text-[12px]">
        {bands.map((b) => (
          <li key={b.key} className="flex items-center gap-2 text-text-secondary">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: b.color }} />
            <span className="w-10">{b.label}</span>
            <span className="tabular-nums text-text-primary">{b.n}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function ScanMetrics({ metrics, previous, pins }: { metrics: MetricSet; previous: MetricSet | null; pins: GridPin[] }) {
  return (
    <div className="space-y-5 rounded-xl border border-border-subtle p-5">
      <div>
        <div className="text-[12px] text-text-secondary">Average rank</div>
        <div className="flex items-baseline gap-2">
          <span className="text-4xl font-semibold tabular-nums text-text-primary">{metrics.arp ?? '—'}</span>
          <Delta now={metrics.arp} before={previous?.arp ?? null} lowerIsBetter />
        </div>
        <p className="mt-1 text-[11.5px] text-text-tertiary">Across the points where the business shows up.</p>
      </div>
      <Donut pins={pins} />
      <dl className="grid grid-cols-3 gap-3 border-t border-border-subtle pt-4 text-[12px]">
        <div>
          <dt className="text-text-tertiary" title="Share of Local Voice: points where the business is in the top 3">SoLV</dt>
          <dd className="font-semibold tabular-nums text-text-primary">{metrics.solv !== null ? `${metrics.solv}%` : '—'}</dd>
          <Delta now={metrics.solv} before={previous?.solv ?? null} suffix="pp" />
        </div>
        <div>
          <dt className="text-text-tertiary" title="Average over every point, counting a miss as 21">ATRP</dt>
          <dd className="font-semibold tabular-nums text-text-primary">{metrics.atrp ?? '—'}</dd>
          <Delta now={metrics.atrp} before={previous?.atrp ?? null} lowerIsBetter />
        </div>
        <div>
          <dt className="text-text-tertiary" title="Points where the business appears in the top 20">Found</dt>
          <dd className="font-semibold tabular-nums text-text-primary">{metrics.foundPct !== null ? `${metrics.foundPct}%` : '—'}</dd>
          <Delta now={metrics.foundPct} before={previous?.foundPct ?? null} suffix="pp" />
        </div>
      </dl>
    </div>
  )
}

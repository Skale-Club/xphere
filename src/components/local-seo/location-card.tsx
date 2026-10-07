import { formatDistanceToNow } from 'date-fns'
import { MapPin, Star } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type LocationCardData = {
  id: string
  name: string
  businessName: string
  address: string | null
  category: string | null
  rating: number | null
  reviews: number | null
  isActive: boolean
  keywords: number
  solv: number | null
  arp: number | null
  lastScanAt: string | null
  trend: number[]
  openAlerts: number
}

/** SoLV over the last scans, scaled to its own range; a placeholder until there is movement to show. */
function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (values.length < 2 || max === min) {
    return (
      <div className="flex h-9 items-center justify-center rounded-md border border-dashed border-border-subtle text-[11.5px] text-text-tertiary">
        {values.length < 2 ? 'Trend appears after a few scans' : 'No change across recent scans'}
      </div>
    )
  }
  const w = 240
  const h = 36
  const step = w / (values.length - 1)
  const y = (v: number) => (h - 3 - ((v - min) / (max - min)) * (h - 6)).toFixed(1)
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="h-9 w-full text-accent" aria-hidden>
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="currentColor" opacity={0.08} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

function Stat({ label, value, muted, title }: { label: string; value: string; muted?: boolean; title?: string }) {
  return (
    <div className="min-w-0 px-3 py-2.5" title={title}>
      <div className={cn('truncate text-base font-semibold sm:text-lg tabular-nums', muted ? 'text-text-tertiary' : 'text-text-primary')}>{value}</div>
      <div className="truncate text-[11.5px] text-text-tertiary">{label}</div>
    </div>
  )
}

export function LocationCard({ data }: { data: LocationCardData }) {
  const scanned = data.lastScanAt !== null
  // A finished scan without an average rank means the business never showed in
  // the grid's results — the label says so instead of leaving a bare dash.
  const unranked = scanned && data.arp === null
  const subtitle = [data.businessName !== data.name ? data.businessName : null, data.category].filter(Boolean).join(' · ')

  return (
    <Card className="h-full transition-colors group-hover:border-accent/40">
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-text-primary">{data.name}</h3>
              {!data.isActive && <Badge variant="secondary">Paused</Badge>}
              {data.openAlerts > 0 && (
                <Badge variant="warning">
                  {data.openAlerts} alert{data.openAlerts === 1 ? '' : 's'}
                </Badge>
              )}
            </div>
            {subtitle && <p className="truncate text-[12.5px] text-text-secondary">{subtitle}</p>}
            {data.address && (
              <p className="mt-0.5 flex items-center gap-1 truncate text-[12px] text-text-tertiary">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{data.address}</span>
              </p>
            )}
          </div>
          {data.rating !== null && (
            <span className="flex shrink-0 items-center gap-1 rounded-full bg-bg-tertiary px-2 py-0.5 text-[12px] font-medium text-text-primary">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              {Number(data.rating).toFixed(1)}
              {data.reviews !== null && <span className="font-normal text-text-tertiary">({data.reviews})</span>}
            </span>
          )}
        </div>

        <div className="grid grid-cols-3 divide-x divide-border-subtle rounded-lg border border-border-subtle bg-bg-tertiary/40">
          <Stat
            label="Visibility"
            value={data.solv !== null ? `${data.solv}%` : '—'}
            muted={!data.solv}
            title="Share of local voice: how much of the grid shows this business in the top 3"
          />
          <Stat
            label={unranked ? 'Not ranked' : 'Avg. rank'}
            value={data.arp !== null ? String(data.arp) : '—'}
            muted={data.arp === null}
            title={unranked ? 'Not found in the results at any grid point' : 'Average position across the grid, where it ranks'}
          />
          <Stat label={data.keywords === 1 ? 'Keyword' : 'Keywords'} value={String(data.keywords)} muted={data.keywords === 0} />
        </div>

        <Sparkline values={data.trend} />

        <div className="mt-auto flex items-center justify-end gap-3 border-t border-border-subtle pt-3 text-[12px] text-text-tertiary">
          <span className="truncate">
            {scanned ? `Scanned ${formatDistanceToNow(new Date(data.lastScanAt!), { addSuffix: true })}` : 'Not scanned yet'}
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

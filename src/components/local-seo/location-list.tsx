import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { ChevronRight, MapPin, Star } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { cn } from '@/lib/utils'

export type LocationRow = {
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
  /** SoLV of recent scans, oldest → newest. */
  trend: number[]
  openAlerts: number
}

// Location | Rating | Visibility | Avg. rank | Keywords | Trend | Last scan | ›
const COLS = '@3xl:grid-cols-[minmax(0,2.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,0.8fr)_minmax(0,0.7fr)_minmax(0,1fr)_minmax(0,1fr)_16px]'

/** SoLV over recent scans, scaled to its own range; nothing until it has moved. */
function Sparkline({ values }: { values: number[] }) {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (values.length < 2 || max === min) return <span className="text-[12px] text-text-tertiary">—</span>
  const w = 96
  const h = 24
  const step = w / (values.length - 1)
  const y = (v: number) => (h - 2 - ((v - min) / (max - min)) * (h - 4)).toFixed(1)
  const line = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${y(v)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-6 w-24 text-accent" aria-label="Visibility trend">
      <path d={`${line} L${w},${h} L0,${h} Z`} fill="currentColor" opacity={0.1} />
      <path d={line} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  )
}

function Visibility({ solv }: { solv: number | null }) {
  if (solv === null) return <span className="text-text-tertiary">—</span>
  return (
    <div className="w-full max-w-[96px]" title="Share of local voice: share of grid points where it shows in the top 3">
      <span className={cn('tabular-nums', solv > 0 ? 'text-text-primary' : 'text-text-tertiary')}>{solv}%</span>
      <div className="mt-1 h-1 overflow-hidden rounded-full bg-bg-tertiary">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.min(100, solv)}%` }} />
      </div>
    </div>
  )
}

/** Tracked locations as one table-like list: one row per location, columns aligned. */
export function LocationList({ rows }: { rows: LocationRow[] }) {
  return (
    <Card className="@container overflow-hidden p-0">
      <div className={cn('hidden gap-4 border-b border-border-subtle px-5 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary @3xl:grid', COLS)}>
        <span>Location</span>
        <span>Rating</span>
        <span>Visibility</span>
        <span>Rank</span>
        <span>Keywords</span>
        <span>Trend</span>
        <span>Last scan</span>
        <span />
      </div>

      <div className="divide-y divide-border-subtle">
        {rows.map((r) => {
          const subtitle = [r.businessName !== r.name ? r.businessName : null, r.category].filter(Boolean).join(' · ')
          return (
            <Link
              key={r.id}
              href={`/seo/local/${r.id}`}
              className={cn('group grid items-center gap-x-4 gap-y-2 px-5 py-3.5 text-[13px] transition-colors hover:bg-bg-tertiary/40', COLS)}
            >
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/10 text-accent">
                  <MapPin className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={cn('truncate font-semibold', r.isActive ? 'text-text-primary' : 'text-text-tertiary')}>{r.name}</span>
                    {!r.isActive && <Badge variant="secondary">Paused</Badge>}
                    {r.openAlerts > 0 && (
                      <Badge variant="warning">
                        {r.openAlerts} alert{r.openAlerts === 1 ? '' : 's'}
                      </Badge>
                    )}
                  </div>
                  <div className="truncate text-[12px] text-text-tertiary">{subtitle || r.address || '—'}</div>
                </div>
              </div>

              <div className="hidden @3xl:block">
                {r.rating !== null ? (
                  <span className="flex items-center gap-1">
                    <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                    <span className="tabular-nums text-text-primary">{Number(r.rating).toFixed(1)}</span>
                    {r.reviews !== null && <span className="text-[12px] text-text-tertiary">({r.reviews})</span>}
                  </span>
                ) : (
                  <span className="text-text-tertiary">—</span>
                )}
              </div>
              <div className="hidden @3xl:block">
                <Visibility solv={r.solv} />
              </div>
              <div className="hidden @3xl:block">
                {r.arp !== null ? (
                  <span className="tabular-nums text-text-primary">{r.arp}</span>
                ) : (
                  <span className="text-[12px] text-text-tertiary" title={r.lastScanAt ? 'Not found in the results at any grid point' : undefined}>
                    {r.lastScanAt ? 'Not ranked' : '—'}
                  </span>
                )}
              </div>
              <div className="hidden @3xl:block">
                <span className={cn('tabular-nums', r.keywords ? 'text-text-primary' : 'text-text-tertiary')}>{r.keywords}</span>
              </div>
              <div className="hidden @3xl:block">
                <Sparkline values={r.trend} />
              </div>

              {/* Phone: the columns above fold into one line. */}
              <div className="flex items-center gap-3 text-[12px] text-text-tertiary @3xl:hidden">
                {r.rating !== null && (
                  <span className="flex items-center gap-1">
                    <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                    {Number(r.rating).toFixed(1)}
                  </span>
                )}
                <span>Visibility {r.solv ?? 0}%</span>
                <span>{r.arp !== null ? `Rank ${r.arp}` : 'Not ranked'}</span>
              </div>

              <div className="text-[12px] text-text-secondary">
                {r.lastScanAt ? formatDistanceToNow(new Date(r.lastScanAt), { addSuffix: true }) : <span className="text-text-tertiary">Not scanned yet</span>}
              </div>
              <ChevronRight className="hidden h-4 w-4 text-text-tertiary transition-transform group-hover:translate-x-0.5 group-hover:text-text-primary @3xl:block" />
            </Link>
          )
        })}
      </div>
    </Card>
  )
}

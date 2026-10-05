import { MapPin, Star } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'

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
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <div className="h-8" />
  const w = 120
  const h = 32
  const max = Math.max(100, ...values)
  const step = w / (values.length - 1)
  const d = values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-8 w-[120px]" aria-hidden>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} className="text-accent" />
    </svg>
  )
}

export function LocationCard({ data }: { data: LocationCardData }) {
  return (
    <Card className="h-full transition-colors hover:border-border-strong">
      <CardContent className="flex h-full flex-col gap-4 p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-[15px] font-semibold text-text-primary">{data.name}</h3>
              {!data.isActive && <Badge variant="secondary">Paused</Badge>}
            </div>
            {data.businessName !== data.name && (
              <p className="truncate text-[12.5px] text-text-secondary">{data.businessName}</p>
            )}
            {data.address && (
              <p className="mt-1 flex items-center gap-1 truncate text-[12px] text-text-tertiary">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{data.address}</span>
              </p>
            )}
          </div>
          {data.rating !== null && (
            <span className="flex shrink-0 items-center gap-1 text-[12.5px] text-text-secondary">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              {Number(data.rating).toFixed(1)}
              {data.reviews !== null && <span className="text-text-tertiary">({data.reviews})</span>}
            </span>
          )}
        </div>

        <div className="mt-auto flex items-end justify-between gap-3">
          <div className="flex gap-5">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-text-tertiary">SoLV</div>
              <div className="text-xl font-semibold tabular-nums text-text-primary">
                {data.solv !== null ? `${data.solv}%` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-text-tertiary">Avg rank</div>
              <div className="text-xl font-semibold tabular-nums text-text-primary">{data.arp ?? '—'}</div>
            </div>
          </div>
          <Sparkline values={data.trend} />
        </div>

        <div className="flex items-center justify-between text-[12px] text-text-tertiary">
          <span>
            {data.keywords} keyword{data.keywords === 1 ? '' : 's'}
          </span>
          <span>{data.lastScanAt ? `Last scan ${new Date(data.lastScanAt).toLocaleDateString()}` : 'Not scanned yet'}</span>
        </div>
      </CardContent>
    </Card>
  )
}

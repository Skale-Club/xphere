'use client'

import { Star } from 'lucide-react'

import { cn } from '@/lib/utils'

interface RatingDistributionProps {
  distribution: { rating: number; count: number }[]
  className?: string
}

export function RatingDistribution({ distribution, className }: RatingDistributionProps) {
  const total = distribution.reduce((sum, d) => sum + d.count, 0)
  const max = Math.max(...distribution.map((d) => d.count), 1)

  return (
    <div className={cn('space-y-2', className)}>
      {distribution.map((row) => {
        const pct = total === 0 ? 0 : Math.round((row.count / max) * 100)
        const sharePct = total === 0 ? 0 : Math.round((row.count / total) * 100)
        return (
          <div key={row.rating} className="flex items-center gap-3">
            <div className="flex w-8 items-center gap-1 text-xs font-medium text-muted-foreground tabular-nums">
              <span>{row.rating}</span>
              <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
            </div>
            <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-amber-300 to-amber-500 transition-all duration-700 ease-out"
                style={{ width: `${pct}%` }}
                aria-hidden
              />
            </div>
            <div className="w-12 text-right text-xs text-muted-foreground tabular-nums">
              {row.count} <span className="opacity-60">({sharePct}%)</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

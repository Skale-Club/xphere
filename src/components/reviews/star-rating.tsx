import { Star } from 'lucide-react'

import { cn } from '@/lib/utils'

interface StarRatingProps {
  rating: number
  /** 1..5 outOf, default 5 */
  outOf?: number
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
  showValue?: boolean
}

const SIZES = {
  sm: 'h-3 w-3',
  md: 'h-4 w-4',
  lg: 'h-5 w-5',
  xl: 'h-7 w-7',
} as const

/**
 * Visual star rating with filled / half / empty states.
 * The half state uses a clipped overlay so it renders crisp at any size.
 */
export function StarRating({ rating, outOf = 5, size = 'md', className, showValue = false }: StarRatingProps) {
  const stars: Array<'full' | 'half' | 'empty'> = []
  for (let i = 1; i <= outOf; i++) {
    if (rating >= i) stars.push('full')
    else if (rating >= i - 0.5) stars.push('half')
    else stars.push('empty')
  }
  const sizeClass = SIZES[size]
  return (
    <span
      className={cn('inline-flex items-center gap-0.5', className)}
      role="img"
      aria-label={`${rating} out of ${outOf} stars`}
    >
      {stars.map((state, idx) => (
        <span key={idx} className="relative inline-block">
          <Star className={cn(sizeClass, 'text-amber-200/60')} />
          {state !== 'empty' ? (
            <span
              className="absolute inset-0 overflow-hidden"
              style={{ width: state === 'half' ? '50%' : '100%' }}
              aria-hidden
            >
              <Star className={cn(sizeClass, 'fill-amber-400 text-amber-400')} />
            </span>
          ) : null}
        </span>
      ))}
      {showValue ? (
        <span className="ml-1.5 text-xs font-medium tabular-nums">{rating.toFixed(1)}</span>
      ) : null}
    </span>
  )
}

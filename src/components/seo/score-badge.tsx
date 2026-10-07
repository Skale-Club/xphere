import { cn } from '@/lib/utils'

export function scoreTone(score: number | null | undefined): 'success' | 'warning' | 'danger' | 'muted' {
  if (score === null || score === undefined) return 'muted'
  if (score >= 80) return 'success'
  if (score >= 50) return 'warning'
  return 'danger'
}

const TONE_TEXT = {
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
  muted: 'text-text-tertiary',
} as const

const SIZES = {
  sm: { box: 40, stroke: 4, text: 'text-[13px]' },
  md: { box: 56, stroke: 5, text: 'text-base' },
  lg: { box: 96, stroke: 7, text: 'text-3xl' },
} as const

/** Health score as a progress ring: green ≥ 80, amber ≥ 50, red below. */
export function ScoreBadge({ score, size = 'md' }: { score: number | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const { box, stroke, text } = SIZES[size]
  const r = (box - stroke) / 2
  const circumference = 2 * Math.PI * r
  const pct = score === null || score === undefined ? 0 : Math.max(0, Math.min(100, score)) / 100
  const tone = TONE_TEXT[scoreTone(score)]

  return (
    <div
      className={cn('relative flex shrink-0 items-center justify-center', tone)}
      style={{ width: box, height: box }}
      role="img"
      aria-label={score === null || score === undefined ? 'No score yet' : `Health score ${score} of 100`}
    >
      <svg width={box} height={box} viewBox={`0 0 ${box} ${box}`} className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx={box / 2} cy={box / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-bg-tertiary" />
        {pct > 0 && (
          <circle
            cx={box / 2}
            cy={box / 2}
            r={r}
            fill="none"
            stroke="currentColor"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={`${circumference * pct} ${circumference}`}
          />
        )}
      </svg>
      <span className={cn('relative font-semibold tabular-nums', text, score == null ? 'text-text-tertiary' : 'text-text-primary')}>
        {score ?? '—'}
      </span>
    </div>
  )
}

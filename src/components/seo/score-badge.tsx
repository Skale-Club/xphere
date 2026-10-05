import { cn } from '@/lib/utils'

export function scoreTone(score: number | null | undefined): 'success' | 'warning' | 'danger' | 'muted' {
  if (score === null || score === undefined) return 'muted'
  if (score >= 80) return 'success'
  if (score >= 50) return 'warning'
  return 'danger'
}

const TONE_CLASS = {
  success: 'text-success border-success/40 bg-[var(--success-muted)]',
  warning: 'text-warning border-warning/40 bg-[var(--warning-muted)]',
  danger: 'text-danger border-danger/40 bg-[var(--danger-muted)]',
  muted: 'text-text-tertiary border-border bg-bg-tertiary',
} as const

/** Health score in a circle: green ≥ 80, amber ≥ 50, red below. */
export function ScoreBadge({ score, size = 'md' }: { score: number | null | undefined; size?: 'md' | 'lg' }) {
  return (
    <div
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full border-2 font-semibold tabular-nums',
        size === 'lg' ? 'h-24 w-24 text-3xl' : 'h-12 w-12 text-base',
        TONE_CLASS[scoreTone(score)],
      )}
      aria-label={score === null || score === undefined ? 'No score yet' : `Health score ${score} of 100`}
    >
      {score ?? '—'}
    </div>
  )
}

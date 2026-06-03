/**
 * Shared period (date-range) helpers for the /dashboard overview.
 *
 * A "period" is one of a small set of presets the user can switch from the
 * hero card selector. Each preset resolves to:
 *   - from / to:         the current window the widgets query
 *   - prevFrom / prevTo: the immediately-preceding window of the same length,
 *                        used for trend deltas (current vs previous)
 *   - days:              integer length of the window, drives sparkline
 *                        bucket count (we cap at 30 so the chart stays legible)
 *
 * The selector and every widget that respects the range go through this util
 * so the math stays in one place. Default period is '7d' (last 7 days).
 */

export type Period =
  | 'today'
  | 'yesterday'
  | '7d'
  | '30d'
  | 'month'
  | 'last_month'
  | 'all_time'

export const PERIODS: { value: Period; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'all_time', label: 'All time' },
]

export const DEFAULT_PERIOD: Period = '7d'

const VALID = new Set<Period>(PERIODS.map((p) => p.value))

/** Narrow an arbitrary URL string back to a Period, falling back to default. */
export function parsePeriod(raw: string | undefined | null): Period {
  if (raw && (VALID as Set<string>).has(raw)) return raw as Period
  return DEFAULT_PERIOD
}

export interface ResolvedPeriod {
  period: Period
  /** Human label used in widget hints e.g. "Today" or "Last 7 days". */
  label: string
  /** Inclusive lower bound of the current window. */
  from: Date
  /** Exclusive upper bound (matches Supabase .lt('col', to.toISOString())). */
  to: Date
  /** Same-shape previous window for trend math. */
  prevFrom: Date
  prevTo: Date
  /** Window length in whole days. Bucket count for the sparkline (capped at 30). */
  days: number
  /**
   * Origin date for sparkline bucketing. Equals `from` for fixed windows, but
   * for 'all_time' it's pinned to the most recent `days` so the chart shows
   * recent trend instead of an empty band (bucketing from 1970 would push all
   * data far past the bucket count).
   */
  bucketStart: Date
}

const MS_DAY = 86_400_000

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

export function resolvePeriod(period: Period): ResolvedPeriod {
  const now = new Date()
  const today = startOfDay(now)
  const tomorrow = new Date(today.getTime() + MS_DAY)

  let from: Date
  let to: Date

  switch (period) {
    case 'today':
      from = today
      to = tomorrow
      break
    case 'yesterday':
      from = new Date(today.getTime() - MS_DAY)
      to = today
      break
    case '7d':
      from = new Date(today.getTime() - 7 * MS_DAY)
      to = tomorrow
      break
    case '30d':
      from = new Date(today.getTime() - 30 * MS_DAY)
      to = tomorrow
      break
    case 'month':
      from = new Date(now.getFullYear(), now.getMonth(), 1)
      to = tomorrow
      break
    case 'last_month':
      from = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      to = new Date(now.getFullYear(), now.getMonth(), 1)
      break
    case 'all_time':
      // Epoch → tomorrow. No meaningful previous window, so trends suppress.
      from = new Date(0)
      to = tomorrow
      break
  }

  const length = to.getTime() - from.getTime()

  let prevFrom: Date
  let prevTo: Date
  let days: number
  let bucketStart: Date

  if (period === 'all_time') {
    // No comparison window — zero-length so prevCount=0 → trend renders null.
    prevFrom = from
    prevTo = from
    // Sparkline shows the most recent 30 days of the (unbounded) range.
    days = 30
    bucketStart = new Date(today.getTime() - (days - 1) * MS_DAY)
  } else {
    prevFrom = new Date(from.getTime() - length)
    prevTo = new Date(from.getTime())
    // Day count rounded up so a partial last day still counts as one bucket.
    days = Math.max(1, Math.min(30, Math.ceil(length / MS_DAY)))
    bucketStart = from
  }

  const label = PERIODS.find((p) => p.value === period)?.label ?? period

  return { period, label, from, to, prevFrom, prevTo, days, bucketStart }
}

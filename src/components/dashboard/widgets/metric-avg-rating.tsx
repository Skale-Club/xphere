import { Star } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { MetricCard } from '@/components/design-system/metric-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'

/**
 * Average Google review rating across linked business profiles, with a
 * rating-distribution sparkline (count per star bucket).
 */
export async function MetricAvgRating() {
  let avg: number | null = null
  let totalReviews = 0
  let distribution: { value: number }[] = []
  let hasProfile = false

  try {
    const supabase = await createClient()

    const { data: profiles } = await supabase
      .from('google_business_profiles')
      .select('average_rating, total_reviews_count, is_active')
    hasProfile = (profiles ?? []).some((p) => p.is_active)

    if (hasProfile) {
      const active = (profiles ?? []).filter((p) => p.is_active)
      const weightedSum = active.reduce(
        (s, p) =>
          s + (Number(p.average_rating) || 0) * (Number(p.total_reviews_count) || 0),
        0,
      )
      const weight = active.reduce((s, p) => s + (Number(p.total_reviews_count) || 0), 0)
      avg = weight > 0 ? weightedSum / weight : null
      totalReviews = weight
    }

    // Star distribution from google_reviews
    const { data: revs } = await supabase
      .from('google_reviews')
      .select('rating')
      .eq('is_removed', false)
      .limit(2000)

    const bucket = [0, 0, 0, 0, 0]
    for (const r of revs ?? []) {
      const v = Math.round(Number(r.rating))
      if (v >= 1 && v <= 5) bucket[v - 1] += 1
    }
    distribution = bucket.map((v) => ({ value: v }))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:metric-avg-rating]', err)
  }

  if (!hasProfile) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm">
        <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Avg rating
        </div>
        <WidgetEmpty
          icon="star"
          title="No reviews tracked"
          description="Connect a Google Business profile to monitor your reputation."
          cta={{ label: 'Connect Reviews', href: '/integrations/google-reviews' }}
          size="compact"
        />
      </div>
    )
  }

  return (
    <MetricCard
      label="Avg rating"
      value={avg !== null ? `★ ${avg.toFixed(1)}` : '—'}
      animate={false}
      icon="star"
      trend={null}
      data={distribution}
      tone="warning"
      href="/reviews"
      hint={totalReviews > 0 ? `${totalReviews.toLocaleString()} reviews` : undefined}
      index={3}
    />
  )
}

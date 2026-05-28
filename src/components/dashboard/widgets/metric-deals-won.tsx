import { Trophy } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { MetricCard } from '@/components/design-system/metric-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'
import { formatCurrency } from '@/lib/pipeline/format'
import type { ResolvedPeriod } from '@/lib/dashboard/period'

/**
 * Deals won inside the selected period — count + summed value + per-day
 * sparkline. We key on `updated_at` here because that's when the deal
 * transitioned to `status='won'` (the pipeline never back-dates closes).
 */
interface Props {
  range: ResolvedPeriod
}

export async function MetricDealsWon({ range }: Props) {
  let count = 0
  let value = 0
  let prevCount = 0
  let series: { value: number }[] = []
  let everCount = 0

  try {
    const supabase = await createClient()

    const fromIso = range.from.toISOString()
    const toIso = range.to.toISOString()
    const prevFromIso = range.prevFrom.toISOString()
    const prevToIso = range.prevTo.toISOString()

    const [{ data: curRows }, { count: prev }, { count: ever }] = await Promise.all([
      supabase
        .from('opportunities')
        .select('value, updated_at')
        .eq('status', 'won')
        .gte('updated_at', fromIso)
        .lt('updated_at', toIso),
      supabase
        .from('opportunities')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'won')
        .gte('updated_at', prevFromIso)
        .lt('updated_at', prevToIso),
      supabase.from('opportunities').select('id', { count: 'exact', head: true }),
    ])

    count = (curRows ?? []).length
    value = (curRows ?? []).reduce((s, r) => s + (Number(r.value) || 0), 0)
    prevCount = prev ?? 0
    everCount = ever ?? 0
    series = bucketByDay(curRows ?? [], range, (r) => r.updated_at)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:metric-deals-won]', err)
  }

  if (everCount === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm h-full">
        <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Deals won
        </div>
        <WidgetEmpty
          icon={Trophy}
          title="No deals yet"
          description="Create your first opportunity to start tracking pipeline value."
          cta={{ label: 'Open pipeline', href: '/pipeline' }}
          size="compact"
        />
      </div>
    )
  }

  const trend = prevCount === 0 ? null : Math.round(((count - prevCount) / prevCount) * 100)

  return (
    <MetricCard
      label="Deals won"
      value={count}
      icon="trophy"
      trend={trend}
      data={series}
      tone="success"
      href="/pipeline?status=won"
      hint={value > 0 ? `${formatCurrency(value)} · ${range.label}` : range.label}
      index={2}
    />
  )
}

function bucketByDay<T>(
  rows: T[],
  range: ResolvedPeriod,
  ts: (r: T) => string | null | undefined,
): { value: number }[] {
  const startMs = range.from.getTime()
  const dayMs = 86_400_000
  const buckets = new Array(range.days).fill(0)
  for (const r of rows) {
    const v = ts(r)
    if (!v) continue
    const t = new Date(v).getTime()
    const idx = Math.floor((t - startMs) / dayMs)
    if (idx >= 0 && idx < range.days) buckets[idx] += 1
  }
  return buckets.map((value) => ({ value }))
}

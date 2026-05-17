import { Trophy } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { MetricCard } from '@/components/design-system/metric-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'
import { formatCurrency } from '@/lib/pipeline/format'

/**
 * Deals won this month — count + summed BRL value + 4-week sparkline.
 */
export async function MetricDealsWon() {
  let countThis = 0
  let valueThis = 0
  let countLast = 0
  let series: { value: number }[] = []
  let everCount = 0

  try {
    const supabase = await createClient()

    const now = new Date()
    const startThisMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const endLastMonth = startThisMonth

    const { data: thisMonthRows } = await supabase
      .from('opportunities')
      .select('value, updated_at')
      .eq('status', 'won')
      .gte('updated_at', startThisMonth.toISOString())

    countThis = (thisMonthRows ?? []).length
    valueThis = (thisMonthRows ?? []).reduce((s, r) => s + (Number(r.value) || 0), 0)

    const { count: last } = await supabase
      .from('opportunities')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'won')
      .gte('updated_at', startLastMonth.toISOString())
      .lt('updated_at', endLastMonth.toISOString())
    countLast = last ?? 0

    const { count: ever } = await supabase
      .from('opportunities')
      .select('id', { count: 'exact', head: true })
    everCount = ever ?? 0

    // 4-week sparkline of won deals
    const fourWeeksAgo = new Date(Date.now() - 28 * 24 * 60 * 60 * 1000)
    const { data: wonRows } = await supabase
      .from('opportunities')
      .select('updated_at')
      .eq('status', 'won')
      .gte('updated_at', fourWeeksAgo.toISOString())

    const bucket = new Array(4).fill(0)
    for (const r of wonRows ?? []) {
      const t = new Date(r.updated_at)
      const diff = Math.floor((Date.now() - t.getTime()) / (7 * 24 * 60 * 60 * 1000))
      const idx = 3 - diff
      if (idx >= 0 && idx < 4) bucket[idx] += 1
    }
    series = bucket.map((v) => ({ value: v }))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:metric-deals-won]', err)
  }

  if (everCount === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm">
        <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Deals won (mo)
        </div>
        <WidgetEmpty
          icon="trophy"
          title="No deals yet"
          description="Create your first opportunity to start tracking pipeline value."
          cta={{ label: 'Open pipeline', href: '/pipeline' }}
          size="compact"
        />
      </div>
    )
  }

  const trend = countLast === 0 ? null : Math.round(((countThis - countLast) / countLast) * 100)

  return (
    <MetricCard
      label="Deals won (mo)"
      value={countThis}
      icon="trophy"
      trend={trend}
      data={series}
      tone="success"
      href="/pipeline?status=won"
      hint={valueThis > 0 ? formatCurrency(valueThis) : undefined}
      index={2}
    />
  )
}

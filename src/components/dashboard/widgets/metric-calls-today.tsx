import { Phone } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { MetricCard } from '@/components/design-system/metric-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'

/**
 * Calls today (inbound + outbound) with a 7-day sparkline and a
 * "X missed" sub-label when present.
 */
export async function MetricCallsToday() {
  let todayCount = 0
  let yesterdayCount = 0
  let missedToday = 0
  let series: { value: number }[] = []
  let everCount = 0

  try {
    const supabase = await createClient()

    const startToday = new Date()
    startToday.setHours(0, 0, 0, 0)
    const startYesterday = new Date(startToday.getTime() - 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(startToday.getTime() - 6 * 24 * 60 * 60 * 1000)

    // Today
    const { count: today } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .gte('started_at', startToday.toISOString())
    todayCount = today ?? 0

    // Yesterday
    const { count: yesterday } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .gte('started_at', startYesterday.toISOString())
      .lt('started_at', startToday.toISOString())
    yesterdayCount = yesterday ?? 0

    // Missed today
    const { count: missed } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
      .gte('started_at', startToday.toISOString())
      .in('status', ['no-answer', 'missed', 'failed'])
    missedToday = missed ?? 0

    // Ever (for empty state)
    const { count: ever } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
    everCount = ever ?? 0

    // 7-day sparkline
    const { data: rows } = await supabase
      .from('call_logs')
      .select('started_at, created_at')
      .gte('created_at', sevenDaysAgo.toISOString())

    const bucket = new Array(7).fill(0)
    for (const r of rows ?? []) {
      const ts = r.started_at ?? r.created_at
      if (!ts) continue
      const t = new Date(ts)
      const diff = Math.floor((Date.now() - t.getTime()) / (24 * 60 * 60 * 1000))
      const idx = 6 - diff
      if (idx >= 0 && idx < 7) bucket[idx] += 1
    }
    series = bucket.map((v) => ({ value: v }))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:metric-calls-today]', err)
  }

  if (everCount === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm">
        <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Calls today
        </div>
        <WidgetEmpty
          icon={Phone}
          title="No calls yet"
          description="Connect Twilio to handle SMS + voice from one inbox."
          cta={{ label: 'Connect Twilio', href: '/integrations/twilio' }}
          size="compact"
        />
      </div>
    )
  }

  const trend = yesterdayCount === 0 ? null : Math.round(((todayCount - yesterdayCount) / yesterdayCount) * 100)

  return (
    <MetricCard
      label="Calls today"
      value={todayCount}
      icon="phone"
      trend={trend}
      data={series}
      tone="success"
      href="/calls"
      hint={missedToday > 0 ? `${missedToday} missed` : undefined}
      index={1}
    />
  )
}

import { Phone } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { getTwilioIntegration } from '@/app/(dashboard)/integrations/twilio/actions'
import { MetricCard } from '@/components/design-system/metric-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'
import type { ResolvedPeriod } from '@/lib/dashboard/period'

/**
 * Calls in the selected period (inbound + outbound), with a per-day
 * sparkline and a "X missed" hint when applicable.
 */
interface Props {
  range: ResolvedPeriod
}

export async function MetricCallsToday({ range }: Props) {
  let count = 0
  let prevCount = 0
  let missed = 0
  let series: { value: number }[] = []
  let everCount = 0
  let twilioConnected = false

  try {
    const supabase = await createClient()

    const fromIso = range.from.toISOString()
    const toIso = range.to.toISOString()
    const prevFromIso = range.prevFrom.toISOString()
    const prevToIso = range.prevTo.toISOString()

    const twilio = await getTwilioIntegration()
    twilioConnected = twilio.hasAccountSid && twilio.hasAuthToken

    const [{ count: cur }, { count: prev }, { count: missedC }, { count: ever }, { data: rows }] =
      await Promise.all([
        supabase
          .from('call_logs')
          .select('id', { count: 'exact', head: true })
          .gte('started_at', fromIso)
          .lt('started_at', toIso),
        supabase
          .from('call_logs')
          .select('id', { count: 'exact', head: true })
          .gte('started_at', prevFromIso)
          .lt('started_at', prevToIso),
        supabase
          .from('call_logs')
          .select('id', { count: 'exact', head: true })
          .gte('started_at', fromIso)
          .lt('started_at', toIso)
          .in('status', ['no-answer', 'missed', 'failed']),
        supabase.from('call_logs').select('id', { count: 'exact', head: true }),
        supabase
          .from('call_logs')
          .select('started_at')
          .gte('started_at', fromIso)
          .lt('started_at', toIso),
      ])

    count = cur ?? 0
    prevCount = prev ?? 0
    missed = missedC ?? 0
    everCount = ever ?? 0
    series = bucketByDay(rows ?? [], range, (r) => r.started_at)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:metric-calls-today]', err)
  }

  if (everCount === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm h-full">
        <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Calls
        </div>
        <WidgetEmpty
          icon={Phone}
          title="No calls yet"
          description={
            twilioConnected
              ? 'Calls will appear here as they come in.'
              : 'Connect Twilio to handle SMS + voice from one inbox.'
          }
          cta={
            twilioConnected
              ? undefined
              : { label: 'Connect Twilio', href: '/settings/integrations?open=twilio' }
          }
          size="compact"
        />
      </div>
    )
  }

  const trend = prevCount === 0 ? null : Math.round(((count - prevCount) / prevCount) * 100)

  return (
    <MetricCard
      label="Calls"
      value={count}
      icon="phone"
      trend={trend}
      data={series}
      tone="success"
      href="/calls"
      hint={missed > 0 ? `${missed} missed · ${range.label}` : range.label}
      index={1}
    />
  )
}

function bucketByDay<T>(
  rows: T[],
  range: ResolvedPeriod,
  ts: (r: T) => string | null | undefined,
): { value: number }[] {
  const startMs = range.bucketStart.getTime()
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

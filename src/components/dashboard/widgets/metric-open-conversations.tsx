import { MessageSquare } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { MetricCard } from '@/components/design-system/metric-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'
import type { ResolvedPeriod } from '@/lib/dashboard/period'

/**
 * New conversations created inside the selected period (was: open-now snapshot).
 * The selector on the hero card drives `range`; we count `created_at`
 * inside the window, compare with the same-length previous window for the
 * trend, and bucket new conversations per day for the sparkline.
 *
 * Server Component | re-renders whenever the URL ?range= changes because the
 * parent passes a fresh `range` prop.
 */
interface Props {
  range: ResolvedPeriod
}

export async function MetricOpenConversations({ range }: Props) {
  let count = 0
  let prevCount = 0
  let series: { value: number }[] = []
  let total = 0

  try {
    const supabase = await createClient()

    const [{ count: currentCount }, { count: previousCount }, { count: ever }, { data: rows }] =
      await Promise.all([
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', range.from.toISOString())
          .lt('created_at', range.to.toISOString()),
        supabase
          .from('conversations')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', range.prevFrom.toISOString())
          .lt('created_at', range.prevTo.toISOString()),
        supabase.from('conversations').select('id', { count: 'exact', head: true }),
        supabase
          .from('conversations')
          .select('created_at')
          .gte('created_at', range.from.toISOString())
          .lt('created_at', range.to.toISOString()),
      ])
    count = currentCount ?? 0
    prevCount = previousCount ?? 0
    total = ever ?? 0
    series = bucketByDay(rows ?? [], range, (r) => r.created_at)
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:metric-open-conversations]', err)
  }

  // Empty state when there has never been any conversation at all
  if (total === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm h-full">
        <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Conversations
        </div>
        <WidgetEmpty
          icon={MessageSquare}
          title="No conversations yet"
          description="Connect WhatsApp or another channel to start receiving messages."
          cta={{ label: 'Connect a channel', href: '/integrations' }}
          size="compact"
        />
      </div>
    )
  }

  const trend = prevCount === 0 ? null : Math.round(((count - prevCount) / prevCount) * 100)

  return (
    <MetricCard
      label="Conversations"
      value={count}
      icon="conversations"
      trend={trend}
      data={series}
      tone="info"
      href="/chat"
      hint={range.label}
      index={0}
    />
  )
}

/**
 * Bucket a list of timestamped rows into `range.days` daily slots, oldest
 * first. Shared shape lets the sparkline component stay row-count agnostic.
 */
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

import { MessageSquare } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { MetricCard } from '@/components/design-system/metric-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'

/**
 * Open conversations count + 7-day new-conversation sparkline.
 * Server Component — each render runs its own query.
 */
export async function MetricOpenConversations() {
  let openCount = 0
  let yesterdayCount = 0
  let series: { value: number }[] = []
  let total = 0

  try {
    const supabase = await createClient()

    // Count open conversations
    const { count: openNow } = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
    openCount = openNow ?? 0

    // Total ever (for empty-state detection)
    const { count: anyEver } = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
    total = anyEver ?? 0

    // Same-time-yesterday open count — best-effort: count created prior to "yesterday now"
    // that were still open as of yesterday. We approximate with count of created_at <= 24h ago AND status='open'.
    const yest = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const { count: openYesterday } = await supabase
      .from('conversations')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'open')
      .lte('created_at', yest)
    yesterdayCount = openYesterday ?? 0

    // 7-day sparkline — new conversations per day
    const sevenDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000)
    sevenDaysAgo.setHours(0, 0, 0, 0)
    const { data: rows } = await supabase
      .from('conversations')
      .select('created_at')
      .gte('created_at', sevenDaysAgo.toISOString())

    const bucket = new Array(7).fill(0)
    for (const r of rows ?? []) {
      const t = new Date(r.created_at)
      const diff = Math.floor((Date.now() - t.getTime()) / (24 * 60 * 60 * 1000))
      const idx = 6 - diff
      if (idx >= 0 && idx < 7) bucket[idx] += 1
    }
    series = bucket.map((v) => ({ value: v }))
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:metric-open-conversations]', err)
  }

  // Empty state when there has never been any conversation at all
  if (total === 0) {
    return (
      <div className="rounded-[12px] border border-border bg-bg-secondary p-5 shadow-elevation-sm h-full">
        <div className="text-[12px] font-medium uppercase tracking-[0.06em] text-text-tertiary">
          Open conversations
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

  const trend = yesterdayCount === 0 ? null : Math.round(((openCount - yesterdayCount) / yesterdayCount) * 100)

  return (
    <MetricCard
      label="Conversations"
      value={openCount}
      icon="conversations"
      trend={trend}
      data={series}
      tone="info"
      href="/chat"
      index={0}
    />
  )
}

import { Activity } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { WidgetCard } from '@/components/dashboard/widget-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'
import { getActivityFeed } from '@/app/(dashboard)/actions'
import { ActivityFeedClient } from '@/components/dashboard/widgets/activity-feed-client'

/**
 * Unified activity feed across messages, calls, deal activity, and
 * Google reviews. Server-renders the initial page, then hands off to the
 * client component which subscribes to Supabase Realtime broadcast on
 * `dashboard:{org_id}` and prepends new events as they arrive.
 */
export async function ActivityFeed() {
  const initial = await getActivityFeed(0, 'all', 15)

  let orgId: string | null = null
  try {
    const supabase = await createClient()
    const { data } = await supabase.rpc('get_current_org_id')
    orgId = (data as string | null) ?? null
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:activity-feed] org lookup failed', err)
  }

  return (
    <WidgetCard title="Recent activity across your workspace" icon={Activity}>
      {initial.length === 0 ? (
        <WidgetEmpty
          icon={Activity}
          title="No activity yet"
          description="Once messages, calls, and deals start flowing, they'll show up here in real time."
        />
      ) : (
        <ActivityFeedClient initial={initial} orgId={orgId} />
      )}
    </WidgetCard>
  )
}

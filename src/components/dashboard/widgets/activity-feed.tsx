import { Activity } from 'lucide-react'

import { WidgetCard } from '@/components/dashboard/widget-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'
import { getActivityFeed } from '@/app/(dashboard)/actions'
import { ActivityFeedClient } from '@/components/dashboard/widgets/activity-feed-client'

/**
 * Unified activity feed across messages, calls, deal activity, and
 * Google reviews. Server-renders the initial page, then hands off to the
 * client component which polls the first page and prepends new events.
 */
export async function ActivityFeed() {
  const initial = await getActivityFeed(0, 'all', 15)

  return (
    <WidgetCard title="Recent activity across your workspace" icon={Activity}>
      {initial.length === 0 ? (
        <WidgetEmpty
          icon={Activity}
          title="No activity yet"
          description="Once messages, calls, and deals start flowing, they'll show up here in real time."
        />
      ) : (
        <ActivityFeedClient initial={initial} />
      )}
    </WidgetCard>
  )
}

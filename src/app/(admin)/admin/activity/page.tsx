import { getPlatformActivity } from '../_actions/get-platform-activity'
import { ActivityFeed } from '@/components/admin/activity/activity-feed'

export const dynamic = 'force-dynamic'

export default async function AdminActivityPage() {
  let events
  try {
    events = await getPlatformActivity(72)
  } catch {
    return (
      <div className="p-6">
        <p className="text-sm text-text-secondary">Failed to load activity. Check your connection and refresh.</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Activity Feed</h1>
        <p className="text-sm text-text-secondary mt-1">Cross-platform events from the last 72 hours</p>
      </div>
      <ActivityFeed events={events} />
    </div>
  )
}

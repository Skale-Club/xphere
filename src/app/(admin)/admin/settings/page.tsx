import { getPlatformStats } from '../_actions/get-platform-stats'
import { PlatformOverviewView } from '@/components/admin/platform-overview-view'

export default async function AdminSettingsPage() {
  let stats
  try {
    stats = await getPlatformStats()
  } catch {
    return (
      <div className="p-6">
        <p className="text-sm text-text-secondary">Failed to load platform stats. Check your connection and refresh the page.</p>
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Platform Settings</h1>
        <p className="text-sm text-text-secondary mt-1">Stats, feature flags, AI provider and platform email — applies to every organization on this install.</p>
      </div>
      <PlatformOverviewView stats={stats} />
    </div>
  )
}

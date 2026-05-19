import { getPlatformStats } from '../_actions/get-platform-stats'
import { PlatformSettingsView } from '@/components/admin/platform-settings-view'

export default async function AdminSettingsPage() {
  let stats
  try {
    stats = await getPlatformStats()
  } catch {
    return (
      <div className="p-6">
        <p className="text-[#A1A1AA] text-sm">Failed to load platform stats. Check your connection and refresh the page.</p>
      </div>
    )
  }

  return <PlatformSettingsView stats={stats} />
}

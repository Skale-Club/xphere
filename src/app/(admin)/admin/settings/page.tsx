import { getPlatformStats } from '../_actions/get-platform-stats'
import { getPlatformSettingsForAdmin } from './global-actions'
import { getPlatformEmailSettings } from './email-actions'
import { PlatformSettingsView } from '@/components/admin/platform-settings-view'

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

  const globalResult = await getPlatformSettingsForAdmin()
  const emailResult  = await getPlatformEmailSettings()

  const globalSettings = 'error' in globalResult ? [] : globalResult.settings

  return (
    <PlatformSettingsView
      stats={stats}
      globalSettings={globalSettings}
      emailSettings={emailResult.settings ?? null}
    />
  )
}

import { getPlatformSettingsForAdmin } from '../global-actions'
import { PlatformSettingsForm } from '@/components/settings/platform-settings-form'

export default async function AdminSettingsAiPage() {
  const result = await getPlatformSettingsForAdmin()
  const settings = 'error' in result ? [] : result.settings
  const aiSettings = settings.filter((s) => s.tab === 'AI provider')

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">AI Provider</h1>
        <p className="text-sm text-text-secondary mt-1">Platform-wide AI keys — used when no org-level key is configured.</p>
      </div>
      <PlatformSettingsForm settings={aiSettings} />
    </div>
  )
}

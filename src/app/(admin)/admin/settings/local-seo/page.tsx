import { getPlatformSettingsForAdmin } from '../global-actions'
import { PlatformSettingsForm } from '@/components/settings/platform-settings-form'

export default async function AdminSettingsLocalSeoPage() {
  const result = await getPlatformSettingsForAdmin()
  const settings = 'error' in result ? [] : result.settings
  const localSeoSettings = settings.filter((setting) => setting.tab === 'Local SEO')

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Local SEO</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Platform-wide rank provider credentials used for geogrid scans and business search.
        </p>
      </div>
      <PlatformSettingsForm settings={localSeoSettings} />
    </div>
  )
}

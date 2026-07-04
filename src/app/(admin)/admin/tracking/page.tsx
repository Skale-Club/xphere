import { getPlatformTrackingConfig } from './_actions/tracking-config'
import { TrackingConfigForm } from '@/components/admin/tracking-config-form'

export default async function AdminTrackingPage() {
  const { settings } = await getPlatformTrackingConfig()

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Tracking</h1>
        <p className="text-sm text-text-secondary mt-1">
          Platform-wide Google Tag Manager and Facebook Pixel configuration. Applies to
          the entire app — this tracks new Xphere signups, not your tenants&rsquo; contacts.
        </p>
      </div>
      <TrackingConfigForm settings={settings} />
    </div>
  )
}

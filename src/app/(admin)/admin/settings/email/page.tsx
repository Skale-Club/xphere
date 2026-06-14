import { getPlatformEmailSettings } from '../email-actions'
import { PlatformEmailForm } from '@/components/settings/platform-email-form'

export default async function AdminSettingsEmailPage() {
  const result = await getPlatformEmailSettings()

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Platform Email</h1>
        <p className="text-sm text-text-secondary mt-1">Resend account used for system emails — invites, auth, alerts.</p>
      </div>
      <PlatformEmailForm initial={result.settings ?? null} />
    </div>
  )
}

import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getPlatformSettingsForAdmin } from './actions'
import { PlatformSettingsForm } from '@/components/settings/platform-settings-form'

export default async function PlatformSettingsPage() {
  const user = await getUser()
  const adminEmail = process.env.PLATFORM_ADMIN_EMAIL

  if (!user || !adminEmail || user.email !== adminEmail) {
    redirect('/')
  }

  const result = await getPlatformSettingsForAdmin()

  if ('error' in result) {
    redirect('/')
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Platform Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Global configuration for the Operator platform. Changes take effect immediately.
        </p>
      </div>
      <PlatformSettingsForm settings={result.settings} />
    </div>
  )
}

import { redirect } from 'next/navigation'
import { ShieldCheck } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { getPlatformSettingsForAdmin } from './actions'
import { PlatformSettingsForm } from '@/components/settings/platform-settings-form'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

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
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Platform admin"
        eyebrowIcon={ShieldCheck}
        title="Platform settings"
        description="Global configuration for the Operator platform. Changes take effect immediately."
      />
      <PlatformSettingsForm settings={result.settings} />
    </PageContainer>
  )
}

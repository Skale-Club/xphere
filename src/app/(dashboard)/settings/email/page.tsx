import { redirect } from 'next/navigation'
import { Mail } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { TenantEmailSettings } from './tenant-email-settings'
import { getTenantEmailIntegration } from './actions'

export default async function EmailSettingsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const { integration } = await getTenantEmailIntegration()

  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Integrations"
        eyebrowIcon={Mail}
        title="Email (Resend)"
        description="Connect your Resend account to send emails from your domain to contacts and leads."
      />
      <TenantEmailSettings initial={integration} />
    </PageContainer>
  )
}

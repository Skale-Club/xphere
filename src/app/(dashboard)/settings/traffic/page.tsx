import { redirect } from 'next/navigation'
import { BarChart3 } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { getOrCreateTrafficSetup } from '@/app/(dashboard)/traffic/actions'
import { TrafficSettingsForm } from './_components/traffic-settings-form'

export default async function TrafficSettingsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const setup = await getOrCreateTrafficSetup()
  if (!setup) redirect('/organizations')

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Analytics"
        eyebrowIcon={BarChart3}
        title="Traffic"
        description="Manage your website tracking install, verify it again, or reset the setup."
      />
      <TrafficSettingsForm
        scriptToken={setup.script_token}
        primaryWebsiteUrl={setup.primary_website_url}
        gtmContainerId={setup.gtm_container_id}
        verificationState={setup.verification_state}
        verifiedAt={setup.verified_at}
      />
    </PageContainer>
  )
}

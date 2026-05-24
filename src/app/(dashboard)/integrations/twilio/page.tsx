import { redirect } from 'next/navigation'
import { Phone } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { TwilioSettings } from '@/components/integrations/twilio-settings'
import { getTwilioIntegration } from './actions'

export const dynamic = 'force-dynamic'

export default async function TwilioIntegrationPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const integration = await getTwilioIntegration()

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Twilio"
        eyebrowIcon={Phone}
        title="Twilio"
        description="Per-org Twilio credentials for SMS, browser-based voice calls, and SIP routing. Each section can be configured independently."
        back={{ href: '/integrations', label: 'All integrations' }}
      />

      <TwilioSettings initial={integration} />
    </PageContainer>
  )
}

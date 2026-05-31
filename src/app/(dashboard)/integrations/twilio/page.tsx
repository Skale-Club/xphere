import { redirect } from 'next/navigation'
import Link from 'next/link'
import { BookOpen } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { TwilioLogo } from '@/components/brand/twilio-logo'
import { TwilioSettings } from '@/components/integrations/twilio-settings'
import { Button } from '@/components/ui/button'
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
        eyebrowIcon={TwilioLogo}
        title="Twilio"
        description="Per-org Twilio credentials for SMS, browser-based voice calls, and SIP routing. Each section can be configured independently."
        back={{ href: '/integrations', label: 'All integrations' }}
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/integrations/twilio/sms-webhook-setup">
              <BookOpen className="h-3.5 w-3.5" />
              SMS webhook guide
            </Link>
          </Button>
        }
      />

      <TwilioSettings initial={integration} />
    </PageContainer>
  )
}

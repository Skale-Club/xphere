import Link from 'next/link'
import { BookOpen, Phone } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { listTwilioNumbers } from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { getTwilioIntegration } from '@/app/(dashboard)/integrations/twilio/actions'
import { PhoneNumbersList } from '@/components/phone-numbers/phone-numbers-list'
import { Button } from '@/components/ui/button'

export default async function PhoneNumbersSettingsPage() {
  const [numbers, twilio] = await Promise.all([listTwilioNumbers(), getTwilioIntegration()])
  const twilioConnected = twilio.hasAccountSid && twilio.hasAuthToken

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Settings"
        eyebrowIcon={Phone}
        title="Phone Numbers"
        description="Each number is a first-class operational resource. Configure its purpose, Vapi assistant, responsible owner, chat routing, and workflow behavior independently of account defaults."
        actions={
          <Button asChild variant="secondary" size="sm">
            <Link href="/integrations/twilio/sms-webhook-setup">
              <BookOpen className="h-3.5 w-3.5" />
              SMS webhook guide
            </Link>
          </Button>
        }
      />
      <PhoneNumbersList initial={numbers} twilioConnected={twilioConnected} />
    </PageContainer>
  )
}

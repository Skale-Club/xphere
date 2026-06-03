import { PageContainer } from '@/components/layout/page-header'
import { listTwilioNumbers } from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { getTwilioIntegration } from '@/app/(dashboard)/integrations/twilio/actions'
import { PhoneNumbersList } from '@/components/phone-numbers/phone-numbers-list'

export default async function PhoneNumbersSettingsPage() {
  const [numbers, twilio] = await Promise.all([listTwilioNumbers(), getTwilioIntegration()])
  const twilioConnected = twilio.hasAccountSid && twilio.hasAuthToken

  return (
    <PageContainer>
      <PhoneNumbersList initial={numbers} twilioConnected={twilioConnected} />
    </PageContainer>
  )
}

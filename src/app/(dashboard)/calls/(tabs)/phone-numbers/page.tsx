import { listTwilioNumbers } from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { getTwilioIntegration } from '@/app/(dashboard)/integrations/twilio/actions'
import { PhoneNumbersList } from '@/components/phone-numbers/phone-numbers-list'

export const metadata = { title: 'Phone Numbers' }

export default async function CallsPhoneNumbersPage() {
  const [numbers, twilio] = await Promise.all([listTwilioNumbers(), getTwilioIntegration()])
  const twilioConnected = twilio.hasAccountSid && twilio.hasAuthToken

  return (
    <div className="pt-2 pb-8">
      <PhoneNumbersList initial={numbers} twilioConnected={twilioConnected} />
    </div>
  )
}

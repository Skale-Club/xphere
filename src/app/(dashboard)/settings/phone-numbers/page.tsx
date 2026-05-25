import { Phone } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { listTwilioNumbers } from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { PhoneNumbersList } from '@/components/phone-numbers/phone-numbers-list'

export default async function PhoneNumbersSettingsPage() {
  const numbers = await listTwilioNumbers()

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Settings"
        eyebrowIcon={Phone}
        title="Phone Numbers"
        description="Each number is a first-class operational resource. Configure its purpose, Vapi assistant, responsible owner, chat routing, and workflow behavior independently of account defaults."
      />
      <PhoneNumbersList initial={numbers} />
    </PageContainer>
  )
}

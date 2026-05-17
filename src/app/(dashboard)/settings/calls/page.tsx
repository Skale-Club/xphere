import { Phone } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { CallSettingsForm } from '@/components/calls/call-settings-form'
import { getCurrentCallSettings, getSipDomain } from '@/app/(dashboard)/voice/actions'

export const dynamic = 'force-dynamic'

export default async function CallSettingsPage() {
  const [settings, sipDomain] = await Promise.all([
    getCurrentCallSettings(),
    getSipDomain(),
  ])

  return (
    <PageContainer size="wide">
      <PageHeader
        eyebrow="Settings"
        eyebrowIcon={Phone}
        title="Call routing"
        description="Decide how inbound calls reach you and how you place outbound ones — pick one of three modes and switch any time."
      />
      <CallSettingsForm
        initial={settings ?? {
          id: null,
          routing_mode: 'phone_forward',
          phone_forward: null,
          sip_username: null,
          sip_password: null,
          twilio_client_identity: null,
          record_calls: true,
        }}
        sipDomain={sipDomain}
      />
    </PageContainer>
  )
}

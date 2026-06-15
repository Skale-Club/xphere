import { PhoneCall } from 'lucide-react'

import { PageHeader } from '@/components/layout/page-header'
import { CallSettingsForm } from '@/components/calls/call-settings-form'
import { getCurrentCallSettings, getSipDomain } from '@/app/(dashboard)/voice/actions'

export const metadata = { title: 'My Phone' }

export default async function CallsMyPhonePage() {
  const [settings, sipDomain] = await Promise.all([
    getCurrentCallSettings(),
    getSipDomain(),
  ])

  return (
    <div className="space-y-6 pt-2 pb-8">
      <PageHeader
        eyebrow="Calls"
        eyebrowIcon={PhoneCall}
        title="My Phone"
        description="Choose how your user receives calls: browser, SIP softphone, or phone forwarding."
      />
      {settings ? (
        <CallSettingsForm initial={settings} sipDomain={sipDomain} />
      ) : null}
    </div>
  )
}

import { redirect } from 'next/navigation'
import { Phone } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { SubSidebarLayout } from '@/components/layout/sub-sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { listTwilioNumbers } from '@/app/(dashboard)/integrations/twilio/numbers-actions'
import { getTwilioIntegration } from '@/app/(dashboard)/integrations/twilio/actions'
import { CallsOnboardingGate } from '@/components/calls/calls-onboarding-gate'
import { CallsSubNav } from '@/components/calls/calls-sub-nav'

export default async function CallsLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser()
  if (!user) redirect('/')

  const numbers = await listTwilioNumbers()
  const hasAnyNumber = numbers.length > 0

  // Only decrypt the Twilio credential blob when we'll actually render the
  // onboarding gate. Skips an AES-GCM decrypt + extra query on the happy path.
  let twilioConnected = false
  if (!hasAnyNumber) {
    const twilio = await getTwilioIntegration()
    twilioConnected = twilio.hasAccountSid && twilio.hasAuthToken
  }

  return (
    <TooltipProvider delayDuration={200}>
      <SubSidebarLayout
        storageKey="sub-sidebar:calls"
        title="Calls"
        expandedWidth={208}
        nav={<CallsSubNav />}
      >
        <PageContainer className="pt-6">
          <PageHeader
            eyebrow="Engage"
            eyebrowIcon={Phone}
            title="Calls"
            description="Every AI and human call across your workspace | with transcripts, recordings, routing and campaigns."
          />
          {hasAnyNumber ? (
            <div>{children}</div>
          ) : (
            <div className="pt-4">
              <CallsOnboardingGate twilioConnected={twilioConnected} />
            </div>
          )}
        </PageContainer>
      </SubSidebarLayout>
    </TooltipProvider>
  )
}

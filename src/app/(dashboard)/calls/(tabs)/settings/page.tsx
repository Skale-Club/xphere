import Link from 'next/link'
import { AlertTriangle, ArrowRight } from 'lucide-react'

import { CallSettingsForm } from '@/components/calls/call-settings-form'
import { getCurrentCallSettings, getSipDomain } from '@/app/(dashboard)/voice/actions'
import { getTwilioIntegration } from '@/app/(dashboard)/integrations/twilio/actions'

export const dynamic = 'force-dynamic'

export default async function CallsSettingsPage() {
  const [settings, sipDomain, twilio] = await Promise.all([
    getCurrentCallSettings(),
    getSipDomain(),
    getTwilioIntegration(),
  ])

  const showVoiceBanner = settings?.routing_mode === 'browser' && !twilio.voiceConfigured
  const showSipBanner = settings?.routing_mode === 'sip' && !twilio.sipConfigured

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-[18px] font-semibold tracking-tight text-text-primary">Call routing</h2>
        <p className="mt-1 text-[13px] text-text-secondary max-w-2xl">
          Decide how inbound calls reach you and how you place outbound ones | pick one of three modes and switch any time.
        </p>
      </div>

      {showVoiceBanner && (
        <TwilioConfigBanner
          title="Voice SDK is not configured for this organization"
          description="In-browser calling requires Twilio API Key SID, API Key Secret, and TwiML App SID."
          ctaLabel="Configure Twilio Voice SDK"
        />
      )}

      {showSipBanner && (
        <TwilioConfigBanner
          title="SIP domain is not configured for this organization"
          description="SIP routing needs the *.sip.twilio.com domain saved on the Twilio integration."
          ctaLabel="Configure Twilio SIP domain"
        />
      )}

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
    </div>
  )
}

function TwilioConfigBanner({
  title,
  description,
  ctaLabel,
}: {
  title: string
  description: string
  ctaLabel: string
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-[12px] border border-amber-400/30 bg-amber-400/[0.06] p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-300" />
        <div>
          <div className="text-[13.5px] font-medium text-amber-100">{title}</div>
          <p className="mt-0.5 max-w-2xl text-[12.5px] text-amber-100/80">{description}</p>
        </div>
      </div>
      <Link
        href="/integrations/twilio"
        className="inline-flex items-center gap-1 rounded-[8px] border border-amber-400/40 bg-amber-400/[0.1] px-3 py-1.5 text-[12.5px] font-medium text-amber-100 transition-colors hover:bg-amber-400/[0.16]"
      >
        {ctaLabel}
        <ArrowRight className="h-3 w-3" />
      </Link>
    </div>
  )
}

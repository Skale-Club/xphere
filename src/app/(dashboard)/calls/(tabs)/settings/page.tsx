import Link from 'next/link'
import type React from 'react'
import {
  Bot,
  GitBranch,
  KeyRound,
  Phone,
  PhoneCall,
  Route,
  Settings2,
} from 'lucide-react'

export default function CallsSettingsPage() {
  return (
    <div className="space-y-6 pt-2 pb-8">
      <div className="max-w-2xl">
        <h2 className="text-[17px] font-semibold text-text-primary">Call setup</h2>
        <p className="mt-1 text-[13px] leading-relaxed text-text-secondary">
          Configure the operational call center here. Provider credentials stay in
          Integrations; call behavior, ownership, routing, and assistant mapping live in Calls.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <SetupLink
          href="/calls/phone-numbers"
          icon={Phone}
          title="Phone Numbers"
          description="Manage lines, labels, capabilities, owners, and per-number defaults."
        />
        <SetupLink
          href="/calls/routing"
          icon={Route}
          title="Call Routing"
          description="Build global ring stages. Active global routing overrides number defaults."
        />
        <SetupLink
          href="/calls/my-phone"
          icon={PhoneCall}
          title="My Phone"
          description="Choose how your user receives calls: browser, SIP, or phone forwarding."
        />
        <SetupLink
          href="/calls/assistants"
          icon={Bot}
          title="Connected Assistants"
          description="Vapi assistants synced from your account, used to route inbound voice."
        />
        <SetupLink
          href="/campaigns?channel=calls"
          icon={GitBranch}
          title="Voice Campaigns"
          description="Run outbound call campaigns from the multi-channel Campaigns module."
        />
        <SetupLink
          href="/integrations/twilio"
          icon={KeyRound}
          title="Twilio Integration"
          description="Manage credentials, webhooks, Voice SDK, SIP domain, and technical tests."
        />
      </div>

      <div className="rounded-[12px] border border-border bg-bg-secondary p-4">
        <div className="flex gap-3">
          <Settings2 className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" />
          <div>
            <h3 className="text-[13px] font-medium text-text-primary">Source of truth</h3>
            <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
              Inbound calls resolve in this order: active global routing first,
              then the called phone number's default routing mode, then the user's
              phone settings. This page keeps those layers visible so setup does not
              feel scattered across the app.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}

function SetupLink({
  href,
  icon: Icon,
  title,
  description,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  title: string
  description: string
}) {
  return (
    <Link
      href={href}
      className="group rounded-[12px] border border-border bg-bg-secondary p-4 transition-colors hover:border-border-strong hover:bg-bg-tertiary/50"
    >
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-bg-tertiary text-text-secondary transition-colors group-hover:text-text-primary">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[13.5px] font-medium text-text-primary">{title}</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-text-secondary">{description}</p>
        </div>
      </div>
    </Link>
  )
}

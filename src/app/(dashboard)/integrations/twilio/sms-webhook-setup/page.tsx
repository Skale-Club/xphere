import Link from 'next/link'
import { redirect } from 'next/navigation'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  MessageSquareText,
  Phone,
  Send,
  Settings,
  ShieldCheck,
} from 'lucide-react'

import { TwilioLogo } from '@/components/brand/twilio-logo'
import { TwilioWebhookUrlCopy } from '@/components/integrations/twilio-webhook-url-copy'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'

const SMS_WEBHOOK_URL = 'https://xphere.app/api/twilio/sms'

const SETUP_STEPS = [
  {
    title: 'Open the Twilio number',
    body: 'In Twilio Console, go to Phone Numbers, then Manage, then Active numbers. Select the phone number you use in Xphere.',
  },
  {
    title: 'Find Messaging configuration',
    body: 'Scroll to the Messaging section. Look for the field named "A message comes in".',
  },
  {
    title: 'Set the webhook URL',
    body: `Paste ${SMS_WEBHOOK_URL} into the webhook URL field and set the method to HTTP POST.`,
  },
  {
    title: 'Save and test inbound SMS',
    body: 'Save the Twilio number, then send a text message from a real mobile phone to that Twilio number. The reply should appear in Xphere Chat.',
  },
]

const CHECKS = [
  'The Twilio phone number is active in Xphere under Calls > Phone Numbers.',
  'The number has SMS capability enabled in Xphere.',
  'The Twilio Account SID and Auth Token are saved in the Twilio integration.',
  'The remote Twilio SMS webhook is not pointing to an old CRM, Chatwoot, Studio Flow, or another callback URL.',
]

const TROUBLESHOOTING = [
  {
    title: 'Xphere can send SMS, but replies do not appear',
    body: 'Outbound SMS only needs valid Twilio credentials. Inbound replies require the phone number webhook above. Check the remote SMS URL in Twilio first.',
  },
  {
    title: 'Twilio shows a signature validation error',
    body: 'Make sure the public webhook URL exactly matches the production Xphere URL. For production, use https://xphere.app/api/twilio/sms.',
  },
  {
    title: 'A previous tool still receives the messages',
    body: 'Twilio sends each inbound SMS to the configured URL on the phone number. Replace any old callback URL before testing again.',
  },
]

export const dynamic = 'force-dynamic'

export default async function TwilioSmsWebhookSetupPage() {
  const user = await getUser()
  if (!user) redirect('/')

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Twilio"
        eyebrowIcon={TwilioLogo}
        title="SMS webhook setup"
        description="Configure Twilio so inbound SMS replies reach Xphere Chat."
        back={{ href: '/integrations/twilio', label: 'Twilio settings' }}
        actions={
          <Button asChild variant="secondary" size="sm">
            <a
              href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming"
              target="_blank"
              rel="noreferrer"
            >
              Open Twilio Console
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        }
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <section className="rounded-[14px] border border-border bg-bg-secondary p-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary text-text-secondary">
                  <MessageSquareText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-text-tertiary">
                    Inbound SMS
                  </p>
                  <h1 className="mt-1 text-[22px] font-semibold leading-tight text-text-primary">
                    Route Twilio replies into Xphere Chat
                  </h1>
                </div>
              </div>

              <p className="mt-4 max-w-3xl text-[13.5px] leading-relaxed text-text-secondary">
                Xphere can send outbound SMS with your Twilio credentials, but inbound replies only arrive when the
                Twilio phone number sends its Messaging webhook to Xphere. If this URL points to another system, replies
                will bypass Xphere entirely.
              </p>
            </div>

            <div className="rounded-[10px] border border-border-subtle bg-bg-tertiary/50 px-3 py-2 text-[12px] text-text-secondary">
              Production endpoint
            </div>
          </div>

          <div className="mt-6 space-y-2">
            <label className="text-[12px] font-medium text-text-secondary">Webhook URL</label>
            <TwilioWebhookUrlCopy value={SMS_WEBHOOK_URL} />
            <p className="text-[12px] text-text-tertiary">
              Use this value for the Twilio number field named "A message comes in". Method must be HTTP POST.
            </p>
          </div>
        </section>

        <section className="rounded-[14px] border border-border bg-bg-secondary p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary text-text-secondary">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-medium text-text-primary">What Xphere checks</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
                These conditions keep the number connected to the right tenant and conversation inbox.
              </p>
            </div>
          </div>
          <ul className="mt-4 space-y-3">
            {CHECKS.map((item) => (
              <li key={item} className="flex gap-2 text-[12.5px] leading-relaxed text-text-secondary">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="rounded-[14px] border border-border bg-bg-secondary p-6">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary text-text-secondary">
            <Settings className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-[15px] font-medium text-text-primary">Twilio Console steps</h2>
            <p className="mt-1 text-[12.5px] text-text-secondary">
              Complete these steps for every Twilio number that should receive SMS replies in Xphere.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 lg:grid-cols-4">
          {SETUP_STEPS.map((step, index) => (
            <article
              key={step.title}
              className="rounded-[12px] border border-border-subtle bg-bg-primary p-4"
            >
              <div className="flex h-7 w-7 items-center justify-center rounded-[8px] bg-bg-tertiary text-[12px] font-semibold text-text-secondary">
                {index + 1}
              </div>
              <h3 className="mt-3 text-[13.5px] font-medium text-text-primary">{step.title}</h3>
              <p className="mt-1.5 text-[12.5px] leading-relaxed text-text-secondary">{step.body}</p>
            </article>
          ))}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-[14px] border border-border bg-bg-secondary p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary text-text-secondary">
              <Phone className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-medium text-text-primary">What Xphere does automatically</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
                When a Twilio number is imported or saved in Xphere with SMS enabled, Xphere attempts to sync the remote
                SMS webhook to the production endpoint. This page is the manual verification path when a number was
                changed directly in Twilio or came from a previous system.
              </p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm">
              <Link href="/calls/phone-numbers">Open phone numbers</Link>
            </Button>
            <Button asChild variant="outline" size="sm">
              <Link href="/integrations/twilio">Open Twilio settings</Link>
            </Button>
          </div>
        </section>

        <section className="rounded-[14px] border border-border bg-bg-secondary p-6">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary text-warning">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-medium text-text-primary">Troubleshooting</h2>
              <p className="mt-1 text-[12.5px] text-text-secondary">
                Start here when replies do not show up in the conversation panel.
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            {TROUBLESHOOTING.map((item) => (
              <div key={item.title} className="rounded-[10px] border border-border-subtle bg-bg-primary p-3">
                <h3 className="text-[13px] font-medium text-text-primary">{item.title}</h3>
                <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">{item.body}</p>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="rounded-[14px] border border-border bg-bg-secondary p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-bg-tertiary text-text-secondary">
              <Send className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-[15px] font-medium text-text-primary">Final test</h2>
              <p className="mt-1 text-[12.5px] leading-relaxed text-text-secondary">
                Send an SMS from a personal mobile phone to the Twilio number. The inbound message should appear in the
                matching Xphere conversation within a few seconds.
              </p>
            </div>
          </div>
          <Button asChild variant="secondary" size="sm">
            <Link href="/inbox">Open Chat</Link>
          </Button>
        </div>
      </section>
    </PageContainer>
  )
}

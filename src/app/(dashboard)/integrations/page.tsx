import Link from 'next/link'
import {
  ArrowRight,
  Bot,
  Brain,
  CalendarClock,
  MessageCircleMore,
  Phone,
  Plug,
  Send,
  Sparkles,
  Star,
  Users,
  type LucideIcon,
} from 'lucide-react'

import { getIntegrations } from './actions'
import { IntegrationsTable } from '@/components/integrations/integrations-table'
import { StatusPill } from '@/components/design-system/status-pill'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { cn } from '@/lib/utils'

interface DedicatedIntegration {
  href: string
  icon: LucideIcon
  name: string
  description: string
  connected?: boolean
  /** Optional sub-label shown beneath the description (e.g. "3 numbers configured"). */
  meta?: string
  tone?: 'accent' | 'green' | 'pink' | 'amber' | 'sky'
}

const toneStyles: Record<NonNullable<DedicatedIntegration['tone']>, string> = {
  accent: 'from-accent-muted/40 to-transparent text-accent',
  green:  'from-[var(--success-muted)]/40 to-transparent text-success',
  pink:   'from-[var(--ch-instagram)]/15 to-transparent text-[var(--ch-instagram)]',
  amber:  'from-[var(--warning-muted)]/40 to-transparent text-warning',
  sky:    'from-[var(--info-muted)]/40 to-transparent text-info',
}

export default async function IntegrationsPage() {
  const integrations = await getIntegrations()

  // Best-effort connection state for dedicated integrations
  const hasManychat = integrations.some((i) => i.provider === 'manychat' && i.is_active)
  const hasGoogleContacts = integrations.some((i) => i.provider === 'google_contacts' && i.is_active)
  const hasTwilioIntegration = integrations.some((i) => i.provider === 'twilio' && i.is_active)
  const { getEvolutionInstance } = await import('./evolution/actions')
  const evolutionInstance = await getEvolutionInstance()
  const hasEvolution = evolutionInstance !== null && evolutionInstance.status === 'connected'

  // v2.3: Twilio is "connected" only if credentials exist AND at least one active number is registered.
  const { listTwilioNumbers } = await import('./twilio/numbers-actions')
  const twilioNumbers = await listTwilioNumbers()
  const activeTwilioNumberCount = twilioNumbers.filter((n) => n.is_active).length
  const hasTwilio = hasTwilioIntegration && activeTwilioNumberCount > 0
  const twilioMeta = hasTwilioIntegration
    ? activeTwilioNumberCount === 0
      ? 'Credentials saved · 0 numbers'
      : activeTwilioNumberCount === 1
        ? '1 number configured'
        : `${activeTwilioNumberCount} numbers configured`
    : undefined

  const dedicated: DedicatedIntegration[] = [
    {
      href: '/integrations/meta',
      icon: MessageCircleMore,
      name: 'Meta Messaging',
      description: 'Connect Facebook once to sync Messenger pages and linked Instagram pro accounts.',
      tone: 'pink',
    },
    {
      href: '/integrations/evolution',
      icon: MessageCircleMore,
      name: 'Evolution Go (WhatsApp)',
      description: 'Self-hosted WhatsApp gateway. Connect via QR code and send/receive messages per org.',
      connected: hasEvolution,
      tone: 'green',
    },
    {
      href: '/integrations/manychat',
      icon: MessageCircleMore,
      name: 'ManyChat',
      description: 'Receive subscriber events from ManyChat and route them to actions.',
      connected: hasManychat,
      tone: 'accent',
    },
    {
      href: '/integrations/google-contacts',
      icon: Users,
      name: 'Google Contacts',
      description: 'Create, update, find, and delete contacts via the action engine.',
      connected: hasGoogleContacts,
      tone: 'sky',
    },
    {
      href: '/integrations/google-reviews',
      icon: Star,
      name: 'Google Reviews',
      description: 'Scrape your Google Business reviews daily and serve them via embeddable widget.',
      tone: 'amber',
    },
    {
      href: '/integrations/twilio',
      icon: Phone,
      name: 'Twilio (SMS + Voice)',
      description: 'Per-org SMS + browser voice + SIP credentials. Register multiple Twilio numbers per org and pick a default for outbound.',
      connected: hasTwilio,
      meta: twilioMeta,
      tone: 'sky',
    },
  ]

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Connections"
        eyebrowIcon={Plug}
        title="Integrations"
        description="Wire Operator into the rest of your stack — messaging, voice, CRM, scheduling, and AI providers."
      />

      {/* Dedicated channel/integration cards */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          <Sparkles className="h-3.5 w-3.5 text-accent" />
          <span>Channels & dedicated</span>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {dedicated.map((item, idx) => (
            <DedicatedCard key={item.href} item={item} index={idx} />
          ))}
        </div>
      </section>

      {/* Generic API-key integrations */}
      <section className="space-y-3">
        <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
          <ProviderClusterIcon />
          <span>API key providers</span>
        </div>
        <IntegrationsTable integrations={integrations} />
      </section>
    </PageContainer>
  )
}

function DedicatedCard({ item, index }: { item: DedicatedIntegration; index: number }) {
  const tone = item.tone ?? 'accent'
  return (
    <Link
      href={item.href}
      className={cn(
        'group relative flex flex-col gap-4 overflow-hidden rounded-[12px] border border-border bg-bg-secondary p-5',
        'shadow-elevation-sm transition-[transform,box-shadow,border-color] duration-200 ease-out',
        'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-elevation-md',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
        'animate-fade-in',
      )}
      style={{ animationDelay: `${index * 60}ms` }}
    >
      <div
        aria-hidden
        className={cn(
          'absolute inset-x-0 top-0 h-24 opacity-50 pointer-events-none',
          'bg-gradient-to-b',
          toneStyles[tone],
        )}
      />

      <div className="relative flex items-start justify-between">
        <div
          className={cn(
            'flex h-10 w-10 items-center justify-center rounded-[10px] ring-1 ring-border-subtle',
            'bg-bg-tertiary',
            toneStyles[tone].split(' ').filter((c) => c.startsWith('text-')).join(' '),
          )}
        >
          <item.icon className="h-5 w-5" />
        </div>
        {item.connected !== undefined && (
          item.connected ? (
            <StatusPill tone="success">Connected</StatusPill>
          ) : (
            <StatusPill tone="idle">Not connected</StatusPill>
          )
        )}
      </div>

      <div className="relative flex min-w-0 flex-col gap-1">
        <h3 className="text-[15px] font-semibold tracking-tight text-text-primary">
          {item.name}
        </h3>
        <p className="text-[12.5px] leading-relaxed text-text-secondary">
          {item.description}
        </p>
        {item.meta && (
          <p className="mt-0.5 text-[11.5px] text-text-tertiary">{item.meta}</p>
        )}
      </div>

      <div className="relative mt-auto inline-flex items-center gap-1 text-[12px] font-medium text-text-secondary group-hover:text-text-primary">
        Configure
        <ArrowRight className="h-3 w-3 -translate-x-0.5 transition-transform duration-200 group-hover:translate-x-0" />
      </div>
    </Link>
  )
}

function ProviderClusterIcon() {
  return (
    <span className="inline-flex items-center -space-x-1">
      <Brain className="h-3.5 w-3.5 text-accent" />
      <Phone className="h-3.5 w-3.5 text-info" />
      <CalendarClock className="h-3.5 w-3.5 text-success" />
      <Send className="h-3.5 w-3.5 text-warning" />
      <Bot className="h-3.5 w-3.5 text-text-tertiary" />
    </span>
  )
}

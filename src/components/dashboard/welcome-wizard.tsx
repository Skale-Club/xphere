import Link from 'next/link'
import {
  ArrowRight,
  Check,
  MessageCircle,
  Bot,
  Users,
  TrendingUp,
  Star,
  Sparkles,
} from 'lucide-react'

import { cn } from '@/lib/utils'

interface WizardStep {
  id: string
  title: string
  description: string
  icon: React.ComponentType<{ className?: string }>
  href: string
  cta: string
  done: boolean
}

interface Props {
  userName: string
  onDismissHref?: string
  hasIntegration: boolean
  hasContacts: boolean
  hasAgent: boolean
  hasDeals: boolean
  hasReviews: boolean
}

/**
 * Full-screen setup wizard shown to fresh organizations that have not yet
 * recorded any meaningful data. Replaces the entire normal dashboard for
 * the first session, with a "skip for now" link that simply reloads the
 * page with the dismiss cookie set (handled by the orchestrator).
 */
export function WelcomeWizard({
  userName,
  hasIntegration,
  hasContacts,
  hasAgent,
  hasDeals,
  hasReviews,
}: Props) {
  const steps: WizardStep[] = [
    {
      id: 'integration',
      title: 'Connect your first channel',
      description: 'WhatsApp via Evolution, SMS/Voice via Twilio, or Meta | pick what you use most.',
      icon: MessageCircle,
      href: '/integrations',
      cta: 'Go to integrations',
      done: hasIntegration,
    },
    {
      id: 'agent',
      title: 'Create an AI agent',
      description: 'Spin up an AI worker that answers messages with your brand voice.',
      icon: Bot,
      href: '/agents',
      cta: 'Create an agent',
      done: hasAgent,
    },
    {
      id: 'contacts',
      title: 'Bring in your contacts',
      description: 'Import a CSV, sync from GoHighLevel, or add a few manually to get started.',
      icon: Users,
      href: '/contacts',
      cta: 'Add contacts',
      done: hasContacts,
    },
    {
      id: 'pipeline',
      title: 'Track your first deal',
      description: 'Set up a sales pipeline and start moving opportunities through your stages.',
      icon: TrendingUp,
      href: '/pipeline',
      cta: 'Open pipeline',
      done: hasDeals,
    },
    {
      id: 'reviews',
      title: 'Monitor your reputation',
      description: 'Connect a Google Business profile and we will track new reviews in real time.',
      icon: Star,
      href: '/integrations/google-reviews',
      cta: 'Connect reviews',
      done: hasReviews,
    },
  ]

  const completed = steps.filter((s) => s.done).length
  const pct = Math.round((completed / steps.length) * 100)

  return (
    <div className="animate-fade-in mx-auto w-full max-w-4xl px-4 py-12 sm:px-6 sm:py-16">
      <div className="rounded-[16px] border border-border bg-gradient-to-br from-accent-muted via-bg-secondary to-transparent p-6 sm:p-8 shadow-elevation-md">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 rounded-[5px] bg-accent-muted px-2 py-0.5 text-[11px] font-medium uppercase tracking-[0.08em] text-accent">
              <Sparkles className="h-3 w-3" />
              Welcome
            </div>
            <div className="mt-3 flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/api/pwa/icons/48" alt="" width={32} height={32} className="rounded-[8px]" />
              <h1 className="text-[26px] font-semibold tracking-tight text-text-primary sm:text-[32px]">
                Welcome to Xphere, {userName}.
              </h1>
            </div>
            <p className="mt-2 max-w-xl text-[14px] text-text-secondary leading-relaxed">
              Let&apos;s get your workspace running in 5 quick steps. You can always
              come back to this checklist by reloading the dashboard.
            </p>
          </div>
          <Link
            href="/?welcome=skip"
            className="shrink-0 text-[12px] font-medium text-text-tertiary transition-colors hover:text-text-secondary"
          >
            Skip for now
          </Link>
        </div>

        <div className="mt-5 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-bg-tertiary">
            <div
              className="h-full bg-accent transition-all duration-500 ease-out"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 text-[12px] font-medium tabular text-text-secondary">
            {completed} / {steps.length}
          </span>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {steps.map((s, i) => {
          const Icon = s.icon
          return (
            <Link
              key={s.id}
              href={s.href}
              className={cn(
                'group relative flex items-start gap-3 rounded-[12px] border border-border bg-bg-secondary p-4 shadow-elevation-sm transition-all duration-200',
                'hover:-translate-y-0.5 hover:border-border-strong hover:shadow-elevation-md',
                s.done && 'opacity-70',
              )}
              style={{ animationDelay: `${i * 60}ms` }}
            >
              <div
                className={cn(
                  'flex h-9 w-9 shrink-0 items-center justify-center rounded-[8px] ring-1',
                  s.done
                    ? 'bg-success-muted text-success ring-success/20'
                    : 'bg-bg-tertiary text-text-secondary ring-border-subtle',
                )}
              >
                {s.done ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'text-[13.5px] font-medium',
                      s.done ? 'text-text-secondary line-through' : 'text-text-primary',
                    )}
                  >
                    {s.title}
                  </span>
                </div>
                <p className="mt-0.5 text-[12.5px] text-text-tertiary leading-relaxed">
                  {s.description}
                </p>
                {!s.done && (
                  <div className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium text-accent">
                    {s.cta}
                    <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </div>
                )}
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}

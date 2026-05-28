import Link from 'next/link'
import { MessageSquarePlus, UserPlus, TrendingUp, Sparkles } from 'lucide-react'

import { createClient, getUser } from '@/lib/supabase/server'
import { StatusPill } from '@/components/design-system/status-pill'
import { PeriodSelector } from '@/components/dashboard/period-selector'

/**
 * Hero / overview row for the home dashboard.
 *
 * Shows a greeting, today's agent spend, a workspace health pill, and
 * three quick-action chips. Server component | fetches its data inline.
 * Any failure is caught by the wrapping WidgetErrorBoundary; the catch
 * here only logs and degrades gracefully (no throw).
 */
export async function HeroSection() {
  let userName = 'there'
  let healthLabel = 'All systems operational'
  let healthTone: 'live' | 'warning' | 'danger' | 'idle' = 'live'

  try {
    const user = await getUser()
    if (user?.user_metadata?.full_name && typeof user.user_metadata.full_name === 'string') {
      userName = user.user_metadata.full_name.trim().split(/\s+/)[0]
    } else if (user?.email) {
      userName = user.email.split('@')[0]
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:hero] getUser failed', err)
  }

  // Workspace health | count disconnected integrations
  try {
    const supabase = await createClient()
    const [{ data: evos }, { data: ints }] = [
      await supabase.from('evolution_instances').select('status').eq('is_active', true),
      await supabase.from('integrations').select('id, is_active'),
    ]

    const evoDisconnected = (evos ?? []).filter((e) => e.status === 'disconnected').length
    const totalConnected = (ints ?? []).filter((i) => i.is_active).length + (evos ?? []).filter((e) => e.status === 'connected').length

    if (evoDisconnected > 0) {
      healthLabel = `${evoDisconnected} integration${evoDisconnected === 1 ? '' : 's'} disconnected`
      healthTone = 'warning'
    } else if (totalConnected === 0) {
      healthLabel = 'No channels connected yet'
      healthTone = 'idle'
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:hero] health lookup failed', err)
  }

  const greeting = greetingFor(new Date())

  return (
    <div className="animate-fade-in rounded-[12px] border border-border bg-bg-secondary p-6 shadow-elevation-sm">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            <Sparkles className="h-3.5 w-3.5 text-accent" />
            <span>Overview</span>
          </div>
          <h1 className="mt-2 text-[26px] font-semibold tracking-tight text-text-primary sm:text-[28px]">
            {greeting}, {userName}.
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill tone={healthTone}>{healthLabel}</StatusPill>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <QuickChip href="/chat" icon={MessageSquarePlus} label="New conversation" />
          <QuickChip href="/contacts/new" icon={UserPlus} label="New contact" />
          <QuickChip href="/pipeline" icon={TrendingUp} label="New deal" />
        </div>
      </div>

      {/* Bottom-right period selector — drives every period-aware widget on
          the dashboard via the ?range= URL param. Lives here so the chosen
          window is right next to the greeting/status block it scopes. */}
      <div className="mt-5 flex justify-end">
        <PeriodSelector />
      </div>
    </div>
  )
}

function greetingFor(date: Date): string {
  const h = date.getHours()
  if (h < 6) return 'Good early morning'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function QuickChip({
  href,
  icon: Icon,
  label,
}: {
  href: string
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <Link
      href={href}
      className="group inline-flex items-center gap-1.5 rounded-[6px] border border-border-subtle bg-bg-tertiary px-2.5 py-1.5 text-[12px] font-medium text-text-secondary transition-all hover:-translate-y-0.5 hover:border-border-strong hover:bg-bg-tertiary/70 hover:text-text-primary hover:shadow-elevation-sm"
    >
      <Icon className="h-3.5 w-3.5 text-text-tertiary group-hover:text-accent" />
      <span>{label}</span>
    </Link>
  )
}

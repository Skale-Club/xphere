import Link from 'next/link'
import { Inbox, Send, Phone, UserPlus, TrendingUp, Star, Calendar } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { WidgetCard } from '@/components/dashboard/widget-card'
import { cn } from '@/lib/utils'

interface Stat {
  id: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: number
  href: string
  tone: 'info' | 'success' | 'warning' | 'accent' | 'default'
  hint?: string
}

/**
 * Snapshot of today's activity numbers — each stat is clickable and
 * deep-links to the relevant area filtered to today.
 */
export async function ActivitySnapshot() {
  let messagesReceived = 0
  let messagesSent = 0
  let callsTotal = 0
  let callsMissed = 0
  let newContacts = 0
  let newDeals = 0
  let newReviews = 0

  try {
    const supabase = await createClient()
    const startToday = new Date()
    startToday.setHours(0, 0, 0, 0)
    const startIso = startToday.toISOString()

    // Messages: role-based bucket (inbound = user/contact, outbound = agent/staff)
    const { data: msgRows } = await supabase
      .from('conversation_messages')
      .select('role')
      .gte('created_at', startIso)

    for (const m of msgRows ?? []) {
      const role = (m.role ?? '').toLowerCase()
      if (role === 'user' || role === 'contact' || role === 'visitor' || role === 'customer') {
        messagesReceived += 1
      } else {
        messagesSent += 1
      }
    }

    const [{ count: callC }, { count: missC }, { count: contC }, { count: oppC }, { count: revC }] = [
      await supabase.from('call_logs').select('id', { count: 'exact', head: true }).gte('started_at', startIso),
      await supabase
        .from('call_logs')
        .select('id', { count: 'exact', head: true })
        .gte('started_at', startIso)
        .in('status', ['no-answer', 'missed', 'failed']),
      await supabase.from('contacts').select('id', { count: 'exact', head: true }).gte('created_at', startIso),
      await supabase.from('opportunities').select('id', { count: 'exact', head: true }).gte('created_at', startIso),
      await supabase.from('google_reviews').select('id', { count: 'exact', head: true }).gte('first_seen_at', startIso),
    ]
    callsTotal = callC ?? 0
    callsMissed = missC ?? 0
    newContacts = contC ?? 0
    newDeals = oppC ?? 0
    newReviews = revC ?? 0
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:activity-snapshot]', err)
  }

  const stats: Stat[] = [
    {
      id: 'msg-in',
      icon: Inbox,
      label: 'Messages received',
      value: messagesReceived,
      href: '/chat',
      tone: 'info',
    },
    {
      id: 'msg-out',
      icon: Send,
      label: 'Messages sent',
      value: messagesSent,
      href: '/chat',
      tone: 'default',
    },
    {
      id: 'calls',
      icon: Phone,
      label: 'Calls',
      value: callsTotal,
      href: '/voice',
      tone: callsMissed > 0 ? 'warning' : 'success',
      hint: callsMissed > 0 ? `${callsMissed} missed` : undefined,
    },
    {
      id: 'contacts',
      icon: UserPlus,
      label: 'New contacts',
      value: newContacts,
      href: '/contacts',
      tone: 'accent',
    },
    {
      id: 'deals',
      icon: TrendingUp,
      label: 'New deals',
      value: newDeals,
      href: '/pipeline',
      tone: 'success',
    },
    {
      id: 'reviews',
      icon: Star,
      label: 'New reviews',
      value: newReviews,
      href: '/reviews',
      tone: 'warning',
    },
  ]

  return (
    <WidgetCard title="Today by the numbers" icon={Calendar}>
      <ul className="-mx-2 flex flex-col">
        {stats.map((s) => {
          const Icon = s.icon
          return (
            <li key={s.id}>
              <Link
                href={s.href}
                className="group flex items-center gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-bg-tertiary"
              >
                <div
                  className={cn(
                    'flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] ring-1 ring-border-subtle',
                    toneBg(s.tone),
                  )}
                >
                  <Icon className={cn('h-3.5 w-3.5', toneText(s.tone))} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-text-secondary">{s.label}</div>
                  {s.hint && (
                    <div className="text-[10.5px] text-text-tertiary">{s.hint}</div>
                  )}
                </div>
                <div className="shrink-0 text-[16px] font-semibold tabular text-text-primary">
                  {s.value.toLocaleString()}
                </div>
              </Link>
            </li>
          )
        })}
      </ul>
    </WidgetCard>
  )
}

function toneBg(t: Stat['tone']): string {
  switch (t) {
    case 'info':
      return 'bg-[var(--info-muted)]'
    case 'success':
      return 'bg-[var(--success-muted)]'
    case 'warning':
      return 'bg-[var(--warning-muted)]'
    case 'accent':
      return 'bg-accent-muted'
    default:
      return 'bg-bg-tertiary'
  }
}

function toneText(t: Stat['tone']): string {
  switch (t) {
    case 'info':
      return 'text-info'
    case 'success':
      return 'text-success'
    case 'warning':
      return 'text-warning'
    case 'accent':
      return 'text-accent'
    default:
      return 'text-text-secondary'
  }
}

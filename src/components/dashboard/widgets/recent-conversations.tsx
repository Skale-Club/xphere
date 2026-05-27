import Link from 'next/link'
import { Inbox, MessageSquare } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { WidgetCard } from '@/components/dashboard/widget-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { relativeTime, initialsOf } from '@/lib/pipeline/format'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { cn } from '@/lib/utils'

interface RowData {
  id: string
  name: string
  initials: string
  channel: Channel
  preview: string
  time: string
  unread: boolean
}

function mapChannel(raw: string | null | undefined): Channel {
  if (!raw) return 'unknown'
  const v = raw.toLowerCase()
  if (v.includes('whatsapp') || v === 'evolution') return 'whatsapp'
  if (v === 'instagram') return 'instagram'
  if (v === 'messenger') return 'messenger'
  if (v === 'sms' || v === 'twilio') return 'sms'
  if (v === 'voice' || v === 'phone') return 'voice'
  if (v === 'widget' || v === 'web') return 'web'
  return 'unknown'
}

function formatPhone(p: string | null | undefined): string {
  if (!p) return 'Unknown contact'
  return formatPhoneDisplay(p) || p
}

/**
 * Top 5 most recent conversations sorted by updated_at DESC. Joined with
 * contacts table for names when available; falls back to visitor_name then
 * formatted phone.
 */
export async function RecentConversations() {
  let rows: RowData[] = []

  try {
    const supabase = await createClient()

    const { data } = await supabase
      .from('conversations')
      .select(
        `id, channel, status, last_message, last_message_at, updated_at, visitor_name, visitor_phone, bot_status,
         contacts:contact_id ( id, name, phone )`,
      )
      .order('updated_at', { ascending: false })
      .limit(5)

    type ConvRow = {
      id: string
      channel: string | null
      status: string | null
      last_message: string | null
      last_message_at: string | null
      updated_at: string
      visitor_name: string | null
      visitor_phone: string | null
      bot_status: string | null
      contacts: { id: string; name: string | null; phone: string | null } | null
    }

    rows = ((data as unknown as ConvRow[] | null) ?? []).map((c) => {
      const displayName =
        c.contacts?.name?.trim() ||
        c.visitor_name?.trim() ||
        formatPhone(c.contacts?.phone ?? c.visitor_phone)
      const preview = c.last_message?.trim() || 'No messages yet'
      return {
        id: c.id,
        name: displayName,
        initials: initialsOf(displayName, '?'),
        channel: mapChannel(c.channel),
        preview,
        time: c.last_message_at ?? c.updated_at,
        unread: c.bot_status === 'unread' || c.status === 'open',
      }
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:recent-conversations]', err)
  }

  return (
    <WidgetCard title="Recent activity in Inbox" icon={Inbox} href="/chat">
      {rows.length === 0 ? (
        <WidgetEmpty
          icon={MessageSquare}
          title="Your inbox is empty"
          description="Connect WhatsApp or another channel to start receiving messages."
          cta={{ label: 'Connect a channel', href: '/integrations' }}
        />
      ) : (
        <ul className="-mx-2 flex flex-col">
          {rows.map((r) => (
            <li key={r.id}>
              <Link
                href={`/chat?conversation=${r.id}`}
                className={cn(
                  'group flex items-center gap-3 rounded-[8px] px-2 py-2.5 transition-colors hover:bg-bg-tertiary',
                )}
              >
                <div className="relative h-9 w-9 shrink-0">
                  <div className="flex h-full w-full items-center justify-center rounded-full bg-bg-tertiary text-[11px] font-medium tracking-tight text-text-secondary ring-1 ring-border-subtle">
                    {r.initials}
                  </div>
                  {r.unread && (
                    <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-accent ring-2 ring-bg-secondary" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-[13px] font-medium text-text-primary">{r.name}</span>
                    <ChannelBadge channel={r.channel} showLabel={false} />
                  </div>
                  <p className="truncate text-[12px] text-text-tertiary">{r.preview}</p>
                </div>
                <span className="shrink-0 text-[11px] tabular text-text-tertiary">
                  {relativeTime(r.time)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  )
}

'use client'

import {
  StickyNote,
  PhoneCall,
  MessageCircle,
  Camera,
  ArrowRight,
  Trophy,
  Frown,
  Sparkles,
  Mail,
} from 'lucide-react'

import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { cn } from '@/lib/utils'
import { relativeTime } from '@/lib/pipeline/format'
import type { ActivityWithMeta } from '@/app/(dashboard)/pipeline/actions'

interface ActivityFeedItemProps {
  activity: ActivityWithMeta
  last?: boolean
}

const TYPE_STYLES: Record<
  string,
  { bg: string; fg: string; ring: string; icon: React.ComponentType<{ className?: string }> }
> = {
  note:         { bg: 'bg-amber-500/10',   fg: 'text-amber-400',   ring: 'ring-amber-500/20',   icon: StickyNote },
  call:         { bg: 'bg-emerald-500/10', fg: 'text-emerald-400', ring: 'ring-emerald-500/20', icon: PhoneCall },
  whatsapp:     { bg: 'bg-green-500/10',   fg: 'text-green-400',   ring: 'ring-green-500/20',   icon: MessageCircle },
  sms:          { bg: 'bg-sky-500/10',     fg: 'text-sky-400',     ring: 'ring-sky-500/20',     icon: MessageCircle },
  instagram:    { bg: 'bg-pink-500/10',    fg: 'text-pink-400',    ring: 'ring-pink-500/20',    icon: Camera },
  email:        { bg: 'bg-slate-500/10',   fg: 'text-slate-400',   ring: 'ring-slate-500/20',   icon: Mail },
  stage_change: { bg: 'bg-accent-muted',   fg: 'text-accent',      ring: 'ring-accent/20',      icon: ArrowRight },
  created:      { bg: 'bg-accent-muted',   fg: 'text-accent',      ring: 'ring-accent/20',      icon: Sparkles },
  won:          { bg: 'bg-emerald-500/15', fg: 'text-emerald-400', ring: 'ring-emerald-500/30', icon: Trophy },
  lost:         { bg: 'bg-rose-500/10',    fg: 'text-rose-400',    ring: 'ring-rose-500/20',    icon: Frown },
}

export function ActivityFeedItem({ activity, last = false }: ActivityFeedItemProps) {
  const style = TYPE_STYLES[activity.type] ?? TYPE_STYLES.note
  const Icon = style.icon
  const meta = (activity.metadata ?? {}) as Record<string, unknown>

  let title = ''
  let body: React.ReactNode = null

  switch (activity.type) {
    case 'note':
      title = 'Note'
      body = activity.content
      break
    case 'call': {
      const dir = (meta.direction as string) ?? 'call'
      const dur = (meta.duration_seconds as number | null) ?? null
      const status = (meta.status as string | null) ?? null
      const recording = (meta.recording_url as string | null) ?? null
      title = `${dir === 'inbound' ? 'Inbound' : 'Outbound'} call`
      body = (
        <span className="text-text-secondary">
          {status ? `${status} · ` : ''}
          {dur != null
            ? `${Math.floor(dur / 60)}:${(dur % 60).toString().padStart(2, '0')}`
            : '|'}
          {recording ? ' · recorded' : ''}
        </span>
      )
      break
    }
    case 'whatsapp':
    case 'sms':
    case 'instagram':
      title = `${activity.type === 'whatsapp' ? 'WhatsApp' : activity.type === 'sms' ? 'SMS' : 'Instagram'} message`
      body = activity.conversation?.last_message ?? activity.content ?? '|'
      break
    case 'email':
      title = 'Email'
      body = activity.content
      break
    case 'stage_change':
      title = 'Stage changed'
      body = activity.content
      break
    case 'created':
      title = 'Opportunity created'
      body = activity.content
      break
    case 'won':
      title = 'Marked won'
      body = activity.content
      break
    case 'lost':
      title = 'Marked lost'
      body = activity.content
      break
    default:
      title = activity.type
      body = activity.content
  }

  return (
    <div className="relative flex gap-3 pb-5">
      {/* Connector line */}
      {!last && (
        <div className="absolute left-[15px] top-8 bottom-0 w-px bg-border-subtle" />
      )}
      <div
        className={cn(
          'relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ring-1',
          style.bg,
          style.fg,
          style.ring,
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <div className="flex items-center justify-between gap-2">
          <h4 className="text-[12.5px] font-medium text-text-primary truncate">{title}</h4>
          <time className="text-[11px] text-text-tertiary tabular-nums shrink-0">
            {relativeTime(activity.created_at)}
          </time>
        </div>
        {body ? (
          <div className="mt-1 text-[12.5px] text-text-secondary whitespace-pre-wrap leading-relaxed">
            {body}
          </div>
        ) : null}
        {activity.conversation && (
          <div className="mt-1.5">
            <ChannelBadge
              channel={activity.conversation.channel as Channel}
              showLabel
              size="sm"
            />
          </div>
        )}
      </div>
    </div>
  )
}

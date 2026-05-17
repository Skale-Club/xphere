'use client'

import * as React from 'react'
import {
  Bot,
  MessageSquare,
  Phone,
  Star,
  Zap,
  AlertTriangle,
  type LucideIcon,
} from 'lucide-react'
import { formatDistanceToNowStrict, format } from 'date-fns'

import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ChannelBadge, type Channel } from './channel-badge'

export type ActivityEventType =
  | 'message'
  | 'call'
  | 'agent'
  | 'tool'
  | 'review'
  | 'error'

export interface ActivityEvent {
  id: string
  type: ActivityEventType
  title: string
  description?: string
  timestamp: string | Date
  channel?: Channel
  href?: string
}

const typeMeta: Record<ActivityEventType, { icon: LucideIcon; color: string; bg: string }> = {
  message: { icon: MessageSquare, color: 'text-[var(--ch-whatsapp)]', bg: 'bg-[var(--ch-whatsapp)]/12' },
  call:    { icon: Phone,         color: 'text-[var(--ch-voice)]',    bg: 'bg-[var(--ch-voice)]/12' },
  agent:   { icon: Bot,           color: 'text-accent',               bg: 'bg-accent-muted' },
  tool:    { icon: Zap,           color: 'text-warning',              bg: 'bg-[var(--warning-muted)]' },
  review:  { icon: Star,          color: 'text-info',                 bg: 'bg-[var(--info-muted)]' },
  error:   { icon: AlertTriangle, color: 'text-danger',               bg: 'bg-[var(--danger-muted)]' },
}

interface ActivityFeedProps {
  events: ActivityEvent[]
  emptyText?: string
  className?: string
}

export function ActivityFeed({ events, emptyText = 'No recent activity yet', className }: ActivityFeedProps) {
  if (events.length === 0) {
    return (
      <div className={cn('flex items-center justify-center py-12 text-[13px] text-text-tertiary', className)}>
        {emptyText}
      </div>
    )
  }

  return (
    <ol className={cn('flex flex-col', className)}>
      {events.map((event, idx) => {
        const meta = typeMeta[event.type]
        const Icon = meta.icon
        const date = new Date(event.timestamp)
        const isLast = idx === events.length - 1

        return (
          <li key={event.id} className="relative flex gap-3 pb-4">
            {/* Timeline line */}
            {!isLast && (
              <span
                aria-hidden
                className="absolute left-[15px] top-8 bottom-0 w-px bg-border-subtle"
              />
            )}

            {/* Icon */}
            <div
              className={cn(
                'relative flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-[8px] ring-1 ring-border-subtle',
                meta.bg,
              )}
            >
              <Icon className={cn('h-[14px] w-[14px]', meta.color)} />
            </div>

            {/* Content */}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
              <div className="flex items-center gap-2">
                <p className="text-[13px] font-medium text-text-primary truncate">{event.title}</p>
                {event.channel && <ChannelBadge channel={event.channel} showLabel={false} />}
              </div>
              {event.description && (
                <p className="text-[12.5px] text-text-secondary leading-relaxed line-clamp-2">
                  {event.description}
                </p>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="text-[11px] text-text-tertiary tabular w-fit cursor-default">
                    {formatDistanceToNowStrict(date, { addSuffix: true })}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="right">{format(date, 'PPpp')}</TooltipContent>
              </Tooltip>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

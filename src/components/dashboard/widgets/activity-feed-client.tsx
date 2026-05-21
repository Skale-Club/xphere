'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { Loader2, MessageSquare, Phone, Bot, Zap, Star, AlertTriangle, type LucideIcon } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'

import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { getActivityFeed } from '@/app/(dashboard)/actions'
import type { ActivityFeedEvent, ActivityFeedFilter } from '@/app/(dashboard)/activity-feed-types'

const FILTERS: { id: ActivityFeedFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'messages', label: 'Messages' },
  { id: 'calls', label: 'Calls' },
  { id: 'deals', label: 'Deals' },
  { id: 'reviews', label: 'Reviews' },
]

const typeMeta: Record<
  ActivityFeedEvent['type'],
  { icon: LucideIcon; color: string; bg: string }
> = {
  message: { icon: MessageSquare, color: 'text-info', bg: 'bg-[var(--info-muted)]' },
  call: { icon: Phone, color: 'text-[var(--ch-voice)]', bg: 'bg-[var(--ch-voice)]/12' },
  agent: { icon: Bot, color: 'text-success', bg: 'bg-success-muted' },
  tool: { icon: Zap, color: 'text-warning', bg: 'bg-[var(--warning-muted)]' },
  review: { icon: Star, color: 'text-warning', bg: 'bg-[var(--warning-muted)]' },
  error: { icon: AlertTriangle, color: 'text-danger', bg: 'bg-[var(--danger-muted)]' },
}

interface Props {
  initial: ActivityFeedEvent[]
  orgId: string | null
}

export function ActivityFeedClient({ initial, orgId }: Props) {
  const [events, setEvents] = useState<ActivityFeedEvent[]>(initial)
  const [filter, setFilter] = useState<ActivityFeedFilter>('all')
  const [offset, setOffset] = useState(initial.length)
  const [hasMore, setHasMore] = useState(initial.length >= 15)
  const [pending, startTransition] = useTransition()

  // Realtime broadcast subscription | best-effort. Failures are silent;
  // the server-rendered list still works.
  useEffect(() => {
    if (!orgId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`dashboard:${orgId}`, { config: { broadcast: { self: false } } })
      .on('broadcast', { event: 'activity' }, (payload) => {
        const evt = payload.payload as ActivityFeedEvent | null
        if (!evt || !evt.id) return
        setEvents((prev) => {
          if (prev.some((e) => e.id === evt.id)) return prev
          return [evt, ...prev].slice(0, 200)
        })
      })
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [orgId])

  // Filter changes refetch from offset 0.
  useEffect(() => {
    if (filter === 'all' && offset === initial.length && events === initial) return
    startTransition(async () => {
      const next = await getActivityFeed(0, filter, 15)
      setEvents(next)
      setOffset(next.length)
      setHasMore(next.length >= 15)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter])

  const filteredEvents = useMemo(() => events, [events])

  const loadMore = () => {
    startTransition(async () => {
      const next = await getActivityFeed(offset, filter, 15)
      setEvents((prev) => [...prev, ...next])
      setOffset((prev) => prev + next.length)
      if (next.length < 15) setHasMore(false)
    })
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-[6px] border px-2 py-1 text-[11.5px] font-medium transition-colors',
              filter === f.id
                ? 'border-accent/40 bg-accent-muted text-accent'
                : 'border-border-subtle bg-bg-tertiary/40 text-text-secondary hover:border-border-strong hover:bg-bg-tertiary hover:text-text-primary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <ol className="flex flex-col">
        {filteredEvents.map((event, idx) => {
          const meta = typeMeta[event.type] ?? typeMeta.tool
          const Icon = meta.icon
          const isLast = idx === filteredEvents.length - 1
          const Body = (
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5">
              <p className="truncate text-[13px] font-medium text-text-primary">{event.title}</p>
              {event.description && (
                <p className="line-clamp-2 text-[12px] text-text-secondary leading-relaxed">
                  {event.description}
                </p>
              )}
              <span className="text-[11px] tabular text-text-tertiary">
                {formatDistanceToNowStrict(new Date(event.timestamp), { addSuffix: true })}
              </span>
            </div>
          )

          return (
            <li
              key={event.id}
              className="relative flex gap-3 pb-4 animate-fade-in"
            >
              {!isLast && (
                <span
                  aria-hidden
                  className="absolute left-[15px] top-8 bottom-0 w-px bg-border-subtle"
                />
              )}
              <div
                className={cn(
                  'relative flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-[8px] ring-1 ring-border-subtle',
                  meta.bg,
                )}
              >
                <Icon className={cn('h-[14px] w-[14px]', meta.color)} />
              </div>
              {event.href ? (
                <Link
                  href={event.href}
                  className="-mx-2 flex min-w-0 flex-1 rounded-[6px] px-2 transition-colors hover:bg-bg-tertiary"
                >
                  {Body}
                </Link>
              ) : (
                Body
              )}
            </li>
          )
        })}
      </ol>

      {hasMore && (
        <div className="flex justify-center pt-2">
          <button
            type="button"
            onClick={loadMore}
            disabled={pending}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-[6px] border border-border-subtle bg-bg-tertiary px-2.5 py-1.5 text-[11.5px] font-medium text-text-secondary transition-colors',
              'hover:border-border-strong hover:bg-bg-tertiary/70 hover:text-text-primary',
              pending && 'opacity-60',
            )}
          >
            {pending && <Loader2 className="h-3 w-3 animate-spin" />}
            Load 15 more
          </button>
        </div>
      )}
    </div>
  )
}

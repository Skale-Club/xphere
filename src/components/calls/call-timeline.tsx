'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  Mic,
  Clock,
  PhoneOff,
} from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { cn } from '@/lib/utils'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import type { CallLogWithContact } from '@/app/(dashboard)/voice/actions'

type Filter = 'all' | 'inbound' | 'outbound' | 'missed'

const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'inbound', label: 'Inbound' },
  { id: 'outbound', label: 'Outbound' },
  { id: 'missed', label: 'Missed' },
]

interface CallTimelineProps {
  rows: CallLogWithContact[]
  filter: Filter
}

export function CallTimeline({ rows, filter }: CallTimelineProps) {
  const router = useRouter()
  const sp = useSearchParams()

  function setFilter(next: Filter) {
    const params = new URLSearchParams(Array.from(sp.entries()))
    if (next === 'all') params.delete('filter')
    else params.set('filter', next)
    router.push(`/voice${params.toString() ? `?${params.toString()}` : ''}`)
  }

  // Group by day
  const groups = React.useMemo(() => groupByDay(rows), [rows])

  return (
    <div className="space-y-6">
      {/* Filter pills */}
      <div className="inline-flex rounded-[10px] border border-border bg-bg-secondary p-1">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            className={cn(
              'rounded-[8px] px-3 py-1.5 text-[12.5px] font-medium transition-colors',
              filter === f.id
                ? 'bg-bg-tertiary text-text-primary shadow-sm'
                : 'text-text-tertiary hover:text-text-primary',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyTimeline />
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <div key={group.key} className="space-y-2">
              <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                {group.label}
              </div>
              <div className="flex flex-col gap-1.5">
                {group.rows.map((row) => (
                  <CallRow key={row.id} row={row} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CallRow({ row }: { row: CallLogWithContact }) {
  const isMissed = row.direction === 'inbound' &&
    ['no-answer', 'busy', 'failed', 'canceled'].includes(row.status ?? '')
  const Icon = isMissed
    ? PhoneMissed
    : row.direction === 'inbound'
      ? PhoneIncoming
      : PhoneOutgoing

  const displayName = row.contact_name
    || (row.direction === 'inbound' ? row.from_number : row.to_number)
    || 'Unknown'

  return (
    <Link
      href={`/voice/${row.id}`}
      className="group flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[12px] border border-border bg-bg-secondary px-3.5 py-3 transition-colors hover:border-border-strong hover:bg-bg-tertiary/40"
    >
      <Avatar className="h-9 w-9">
        <AvatarFallback className="bg-bg-tertiary text-[12px] font-medium text-text-secondary">
          {initialsOf(displayName)}
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1 basis-40">
        <div className="flex items-center gap-2">
          <span className="truncate text-[13.5px] font-medium text-text-primary">
            {displayName}
          </span>
          <Icon
            className={cn(
              'h-3.5 w-3.5 shrink-0',
              isMissed
                ? 'text-rose-400'
                : row.direction === 'inbound'
                  ? 'text-emerald-400'
                  : 'text-accent',
            )}
          />
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-text-tertiary">
          <span>
            {formatPhoneDisplay(row.direction === 'inbound' ? row.from_number : row.to_number) || '-'}
          </span>
          {row.routing_mode && (
            <>
              <span>·</span>
              <span className="capitalize">{routingLabel(row.routing_mode)}</span>
            </>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-x-3 gap-y-1.5 ml-auto">
        {row.recording_url && (
          <span className="inline-flex items-center gap-1 rounded-full bg-accent-muted/30 px-2 py-0.5 text-[10.5px] font-medium text-accent">
            <Mic className="h-3 w-3" />
            Recorded
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-[11.5px] text-text-tertiary">
          <Clock className="h-3 w-3" />
          {formatDuration(row.duration_seconds)}
        </span>
        <StatusPill status={row.status ?? null} />
      </div>
    </Link>
  )
}

function StatusPill({ status }: { status: string | null }) {
  if (!status) return null
  const map: Record<string, { label: string; tone: 'success' | 'warn' | 'danger' | 'muted' }> = {
    completed: { label: 'Completed', tone: 'success' },
    'in-progress': { label: 'In progress', tone: 'warn' },
    ringing: { label: 'Ringing', tone: 'warn' },
    initiated: { label: 'Initiated', tone: 'muted' },
    'no-answer': { label: 'No answer', tone: 'danger' },
    busy: { label: 'Busy', tone: 'danger' },
    failed: { label: 'Failed', tone: 'danger' },
    canceled: { label: 'Canceled', tone: 'danger' },
  }
  const meta = map[status] ?? { label: status, tone: 'muted' as const }
  const tones: Record<string, string> = {
    success: 'bg-emerald-500/15 text-emerald-300',
    warn: 'bg-amber-400/15 text-amber-300',
    danger: 'bg-rose-500/15 text-rose-300',
    muted: 'bg-bg-tertiary text-text-tertiary',
  }
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', tones[meta.tone])}>
      {meta.label}
    </span>
  )
}

function EmptyTimeline() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-[14px] border border-dashed border-border bg-bg-secondary py-16 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-bg-tertiary text-text-tertiary">
        <PhoneOff className="h-5 w-5" />
      </div>
      <div>
        <h3 className="text-[14px] font-medium text-text-primary">No calls yet</h3>
        <p className="mt-1 max-w-sm text-[12.5px] text-text-secondary">
          Connect a Twilio number and pick a routing mode in <span className="text-text-primary">Calls → My Phone</span>
          {' '}to start receiving calls here.
        </p>
      </div>
    </div>
  )
}

function initialsOf(name: string | null | undefined): string {
  const base = (name ?? '?').replace(/[^a-zA-Z0-9 ]/g, ' ').trim()
  const parts = base.split(/\s+/)
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return base.slice(0, 2).toUpperCase()
}

function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds < 0) return '-'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function routingLabel(mode: string): string {
  if (mode === 'phone_forward') return 'Forward'
  if (mode === 'sip') return 'SIP'
  if (mode === 'browser') return 'Browser'
  return mode
}

function groupByDay(rows: CallLogWithContact[]): Array<{ key: string; label: string; rows: CallLogWithContact[] }> {
  const groups = new Map<string, CallLogWithContact[]>()
  const now = new Date()
  const todayKey = startOfDay(now).toISOString()
  const yesterdayKey = startOfDay(new Date(now.getTime() - 86400000)).toISOString()

  for (const row of rows) {
    const ts = row.started_at ?? row.created_at
    if (!ts) continue
    const dayKey = startOfDay(new Date(ts)).toISOString()
    if (!groups.has(dayKey)) groups.set(dayKey, [])
    groups.get(dayKey)!.push(row)
  }

  return Array.from(groups.entries()).map(([key, rows]) => {
    let label = new Date(key).toLocaleDateString([], {
      weekday: 'long',
      month: 'short',
      day: 'numeric',
    })
    if (key === todayKey) label = 'Today'
    else if (key === yesterdayKey) label = 'Yesterday'
    return { key, label, rows }
  })
}

function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}

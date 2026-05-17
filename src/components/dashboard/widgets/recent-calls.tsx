import Link from 'next/link'
import { Phone, PhoneIncoming, PhoneOutgoing, Mic } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { WidgetCard } from '@/components/dashboard/widget-card'
import { WidgetEmpty } from '@/components/dashboard/widget-empty'
import { StatusPill } from '@/components/design-system/status-pill'
import { relativeTime, initialsOf } from '@/lib/pipeline/format'

interface CallRow {
  id: string
  name: string
  initials: string
  direction: 'inbound' | 'outbound'
  duration: number | null
  status: string | null
  startedAt: string
  recording: boolean
}

function formatDuration(s: number | null): string {
  if (!s || s <= 0) return '—'
  const m = Math.floor(s / 60)
  const sec = s % 60
  return `${m}:${sec.toString().padStart(2, '0')}`
}

function statusTone(status: string | null): 'success' | 'warning' | 'danger' | 'idle' {
  if (!status) return 'idle'
  const s = status.toLowerCase()
  if (s === 'completed' || s === 'answered') return 'success'
  if (s === 'no-answer' || s === 'missed' || s === 'busy') return 'warning'
  if (s === 'failed' || s === 'canceled') return 'danger'
  return 'idle'
}

/**
 * Recent call log. Shows today's most recent 5 calls; if there are no
 * calls today, falls back to the most recent 5 of all-time so the panel
 * isn't dead during quiet days.
 */
export async function RecentCalls() {
  let rows: CallRow[] = []
  let everCount = 0

  try {
    const supabase = await createClient()

    const startToday = new Date()
    startToday.setHours(0, 0, 0, 0)

    type RawRow = {
      id: string
      direction: 'inbound' | 'outbound'
      duration_seconds: number | null
      status: string | null
      from_number: string | null
      to_number: string | null
      started_at: string | null
      created_at: string
      recording_url: string | null
      contacts: { id: string; name: string | null; phone: string | null } | null
    }

    // Try today first
    const { data: todayRows } = await supabase
      .from('call_logs')
      .select(
        `id, direction, duration_seconds, status, from_number, to_number, started_at, created_at, recording_url,
         contacts:contact_id ( id, name, phone )`,
      )
      .gte('started_at', startToday.toISOString())
      .order('started_at', { ascending: false })
      .limit(5)

    let raw: RawRow[] = (todayRows as unknown as RawRow[] | null) ?? []

    if (raw.length === 0) {
      // Fallback: any 5 most recent
      const { data: anyRows } = await supabase
        .from('call_logs')
        .select(
          `id, direction, duration_seconds, status, from_number, to_number, started_at, created_at, recording_url,
           contacts:contact_id ( id, name, phone )`,
        )
        .order('started_at', { ascending: false, nullsFirst: false })
        .limit(5)
      raw = (anyRows as unknown as RawRow[] | null) ?? []
    }

    const { count: ever } = await supabase
      .from('call_logs')
      .select('id', { count: 'exact', head: true })
    everCount = ever ?? 0

    rows = raw.map((c) => {
      const phone = c.direction === 'inbound' ? c.from_number : c.to_number
      const name = c.contacts?.name?.trim() || phone || 'Unknown'
      return {
        id: c.id,
        name,
        initials: initialsOf(name, '?'),
        direction: c.direction,
        duration: c.duration_seconds,
        status: c.status,
        startedAt: c.started_at ?? c.created_at,
        recording: Boolean(c.recording_url),
      }
    })
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[dashboard:recent-calls]', err)
  }

  if (everCount === 0) {
    return (
      <WidgetCard title="Recent calls" icon={Phone} href="/voice">
        <WidgetEmpty
          icon={Phone}
          title="No calls yet"
          description="Connect Twilio to start placing and receiving calls."
          cta={{ label: 'Connect Twilio', href: '/integrations/twilio' }}
        />
      </WidgetCard>
    )
  }

  return (
    <WidgetCard title="Recent calls" icon={Phone} href="/voice">
      {rows.length === 0 ? (
        <WidgetEmpty
          icon={Phone}
          title="No calls yet today"
          description="Quiet day so far."
          size="compact"
        />
      ) : (
        <ul className="-mx-2 flex flex-col">
          {rows.map((r) => {
            const Dir = r.direction === 'inbound' ? PhoneIncoming : PhoneOutgoing
            return (
              <li key={r.id}>
                <Link
                  href={`/calls/${r.id}`}
                  className="group flex items-center gap-3 rounded-[8px] px-2 py-2 transition-colors hover:bg-bg-tertiary"
                >
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-tertiary ring-1 ring-border-subtle">
                    <Dir
                      className={
                        r.direction === 'inbound'
                          ? 'h-3.5 w-3.5 text-info'
                          : 'h-3.5 w-3.5 text-success'
                      }
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-text-primary">{r.name}</span>
                      {r.recording && (
                        <Mic className="h-3 w-3 shrink-0 text-text-tertiary" />
                      )}
                    </div>
                    <div className="flex items-center gap-2 text-[11.5px] text-text-tertiary">
                      <span className="tabular">{formatDuration(r.duration)}</span>
                      <span>·</span>
                      <span>{relativeTime(r.startedAt)}</span>
                    </div>
                  </div>
                  <StatusPill tone={statusTone(r.status)}>{r.status ?? 'unknown'}</StatusPill>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </WidgetCard>
  )
}

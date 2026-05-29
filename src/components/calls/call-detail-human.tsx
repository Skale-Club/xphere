import Link from 'next/link'
import { Clock, Hash, User2, User } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { CallWaveformPlayer } from '@/components/calls/call-waveform-player'
import { CallNotesEditor } from '@/components/calls/call-notes-editor'
import type { UnifiedCallWithContact } from '@/app/(dashboard)/calls/actions'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'

interface Props {
  call: UnifiedCallWithContact
}

export async function CallDetailHuman({ call }: Props) {
  const supabase = await createClient()

  // Fetch full call_logs row for ended_at + call_sid + recording_duration
  const { data: logRow } = await supabase
    .from('call_logs')
    .select('*')
    .eq('id', call.id)
    .maybeSingle()

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2 space-y-6">
        {call.recording_url ? (
          <CallWaveformPlayer
            url={call.recording_url}
            duration={call.recording_duration ?? call.duration_seconds ?? 0}
          />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-border bg-bg-secondary p-10 text-center">
            <span className="text-[13px] font-medium text-text-primary">No recording available</span>
            <p className="max-w-md text-[12px] text-text-secondary">
              Recordings appear here a few seconds after the call ends | provided the &quot;Record calls&quot; toggle is on.
            </p>
          </div>
        )}

        <CallNotesEditor callId={call.id} initialNotes={call.notes ?? ''} />
      </div>

      <aside className="space-y-4">
        <div className="rounded-[14px] border border-border bg-bg-secondary p-5 space-y-4">
          <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            Details
          </h3>
          <MetaRow icon={User} label="Type" value="Human" />
          <MetaRow icon={Clock} label="Duration" value={formatDuration(call.duration_seconds)} />
          <MetaRow icon={Hash} label="Call SID" value={call.external_id} mono />
          <MetaRow icon={User2} label="Routing" value={routingLabel(call.routing_mode)} />
          <MetaRow icon={Clock} label="Started" value={formatDateTime(call.started_at)} />
          <MetaRow icon={Clock} label="Ended" value={formatDateTime(logRow?.ended_at ?? null)} />
        </div>

        {call.contact && (
          <div className="rounded-[14px] border border-border bg-bg-secondary p-5 space-y-2">
            <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
              Contact
            </h3>
            <Link
              href={`/contacts?id=${call.contact.id}`}
              className="block rounded-[10px] border border-border-subtle bg-bg-tertiary/40 p-3 transition-colors hover:bg-bg-tertiary/70"
            >
              <div className="text-[13.5px] font-medium text-text-primary">
                {call.contact.name ?? '(unnamed contact)'}
              </div>
              {call.contact.phone && (
                <div className="text-[11.5px] tabular-nums text-text-tertiary">
                  {formatPhoneDisplay(call.contact.phone)}
                </div>
              )}
            </Link>
          </div>
        )}
      </aside>
    </div>
  )
}

function MetaRow({
  icon: Icon,
  label,
  value,
  mono = false,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-bg-tertiary text-text-tertiary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">{label}</div>
        <div className={`mt-0.5 truncate text-[12.5px] text-text-primary ${mono ? 'font-mono' : ''}`}>
          {value || '-'}
        </div>
      </div>
    </div>
  )
}

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 0) return '-'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '-'
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function routingLabel(mode: string | null): string {
  if (mode === 'phone_forward') return 'Phone forward'
  if (mode === 'sip') return 'SIP / Zoiper'
  if (mode === 'browser') return 'Browser'
  return '-'
}

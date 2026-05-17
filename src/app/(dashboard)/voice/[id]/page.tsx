import { notFound } from 'next/navigation'
import { PhoneCall, PhoneIncoming, PhoneOutgoing, Clock, User2, Hash } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { getCallLog } from '../actions'
import { CallWaveformPlayer } from '@/components/calls/call-waveform-player'
import { CallNotesEditor } from '@/components/calls/call-notes-editor'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'

interface VoiceDetailPageProps {
  params: Promise<{ id: string }>
}

export default async function VoiceDetailPage({ params }: VoiceDetailPageProps) {
  const { id } = await params
  const call = await getCallLog(id)
  if (!call) notFound()

  const displayName = call.contact_name ?? (call.direction === 'inbound' ? call.from_number : call.to_number) ?? 'Unknown'

  return (
    <PageContainer size="wide">
      <PageHeader
        eyebrow="Call"
        eyebrowIcon={PhoneCall}
        back={{ href: '/voice', label: 'All calls' }}
        title={
          <span className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-bg-tertiary text-[13px] font-medium text-text-secondary">
                {initialsOf(displayName)}
              </AvatarFallback>
            </Avatar>
            <span>{displayName}</span>
          </span>
        }
        description={
          <span className="flex items-center gap-3 text-[12.5px]">
            {call.direction === 'inbound'
              ? <PhoneIncoming className="h-3.5 w-3.5 text-emerald-400" />
              : <PhoneOutgoing className="h-3.5 w-3.5 text-accent" />}
            <span className="capitalize">{call.direction}</span>
            <span className="text-text-tertiary">·</span>
            <span>{call.from_number ?? '—'} → {call.to_number ?? '—'}</span>
          </span>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Player + notes */}
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
                Recordings appear here a few seconds after the call ends — provided the &quot;Record calls&quot; toggle is on.
              </p>
            </div>
          )}

          <CallNotesEditor callId={call.id} initialNotes={call.notes ?? ''} />
        </div>

        {/* Side meta */}
        <aside className="space-y-4">
          <div className="rounded-[14px] border border-border bg-bg-secondary p-5 space-y-4">
            <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
              Details
            </h3>
            <MetaRow icon={Clock} label="Duration" value={formatDuration(call.duration_seconds)} />
            <MetaRow icon={Hash} label="Call SID" value={call.call_sid} mono />
            <MetaRow
              icon={User2}
              label="Routing"
              value={routingLabel(call.routing_mode)}
            />
            <MetaRow icon={Clock} label="Started" value={formatDateTime(call.started_at)} />
            <MetaRow icon={Clock} label="Ended" value={formatDateTime(call.ended_at)} />
          </div>

          {call.contact_id && (
            <div className="rounded-[14px] border border-border bg-bg-secondary p-5 space-y-2">
              <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Contact
              </h3>
              <a
                href={`/contacts/${call.contact_id}`}
                className="block rounded-[10px] border border-border-subtle bg-bg-tertiary/40 p-3 transition-colors hover:bg-bg-tertiary/70"
              >
                <div className="text-[13.5px] font-medium text-text-primary">
                  {call.contact_name ?? '(unnamed contact)'}
                </div>
                {call.contact_phone && (
                  <div className="text-[11.5px] text-text-tertiary">{call.contact_phone}</div>
                )}
              </a>
            </div>
          )}
        </aside>
      </div>
    </PageContainer>
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
          {value || '—'}
        </div>
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

function formatDuration(seconds: number | null): string {
  if (!seconds || seconds < 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

function routingLabel(mode: string | null): string {
  if (mode === 'phone_forward') return 'Phone forward'
  if (mode === 'sip') return 'SIP / Zoiper'
  if (mode === 'browser') return 'Browser'
  return '—'
}

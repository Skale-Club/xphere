import Link from 'next/link'
import { Bot, Clock, Hash, DollarSign, Sparkles, MessageSquare } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { buildTimeline } from '@/lib/calls/timeline'
import { CallTranscript } from '@/components/calls/call-transcript'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import type { ArtifactMessage } from '@/types/vapi'
import type { UnifiedCallWithContact } from '@/app/(dashboard)/calls/actions'

interface Props {
  call: UnifiedCallWithContact
  /** Single-column layout for narrow containers (detail sheet). */
  stacked?: boolean
}

export async function CallDetailAi({ call, stacked = false }: Props) {
  const supabase = await createClient()

  // call.external_id already equals calls.vapi_call_id for AI rows (unified_calls
  // view), so the action_logs query doesn't need to wait on the calls row —
  // fetch both in parallel instead of sequentially.
  const [{ data: vapiCall }, { data: actionLogs }] = await Promise.all([
    supabase
      .from('calls')
      .select('transcript_turns, started_at')
      .eq('id', call.id)
      .maybeSingle(),
    supabase
      .from('action_logs')
      .select('*')
      .eq('vapi_call_id', call.external_id)
      .order('created_at', { ascending: true }),
  ])

  const turns = vapiCall?.started_at
    ? buildTimeline(
        (vapiCall.transcript_turns as ArtifactMessage[]) ?? [],
        actionLogs ?? [],
        vapiCall.started_at,
      )
    : []

  return (
    <div className={stacked ? 'flex flex-col gap-6' : 'grid gap-6 lg:grid-cols-3'}>
      <div className={stacked ? 'space-y-6' : 'lg:col-span-2 space-y-6'}>
        {call.notes && (
          <div className="rounded-[14px] border border-border bg-bg-secondary p-5">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles className="h-3.5 w-3.5 text-violet-300" />
              <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Summary
              </h3>
            </div>
            <p className="text-[13px] leading-relaxed text-text-primary whitespace-pre-wrap">
              {call.notes}
            </p>
          </div>
        )}

        {turns.length > 0 ? (
          <CallTranscript timeline={turns} />
        ) : (
          <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-border bg-bg-secondary p-10 text-center">
            <span className="text-[13px] font-medium text-text-primary">No transcript</span>
            <p className="max-w-md text-[12px] text-text-secondary">
              Vapi returns transcripts a few seconds after the call ends.
            </p>
          </div>
        )}
      </div>

      <aside className="space-y-4">
        <div className="rounded-[14px] border border-border bg-bg-secondary p-5 space-y-4">
          <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
            Details
          </h3>
          <MetaRow icon={Bot} label="Type" value="AI agent" />
          <MetaRow icon={Clock} label="Duration" value={formatDuration(call.duration_seconds)} />
          {call.cost != null && Number(call.cost) > 0 && (
            <MetaRow icon={DollarSign} label="Cost" value={`$${Number(call.cost).toFixed(4)}`} />
          )}
          {call.assistant_id && (
            <MetaRow icon={Hash} label="Assistant" value={call.assistant_id} mono />
          )}
          <MetaRow icon={Hash} label="Vapi ID" value={call.external_id} mono />
          {call.substatus && (
            <MetaRow icon={Hash} label="Ended reason" value={call.substatus} />
          )}
          <MetaRow icon={Clock} label="Started" value={formatDateTime(call.started_at)} />
          <MetaRow icon={Clock} label="Ended" value={formatDateTime(call.ended_at)} />
        </div>

        {call.contact && (
          <div className="rounded-[14px] border border-border bg-bg-secondary p-5 space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-[12px] font-medium uppercase tracking-[0.08em] text-text-tertiary">
                Contact
              </h3>
              <Link
                href={`/inbox?contact=${call.contact.id}`}
                className="inline-flex items-center gap-1 text-[11.5px] font-medium text-accent hover:underline"
              >
                <MessageSquare className="h-3 w-3" />
                Message
              </Link>
            </div>
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

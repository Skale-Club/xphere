import Link from 'next/link'
import { Bot, Clock, Hash, DollarSign, Sparkles, MessageSquare } from 'lucide-react'

import { createClient } from '@/lib/supabase/server'
import { buildTimeline } from '@/lib/calls/timeline'
import { CallTranscript } from '@/components/calls/call-transcript'
import { CallWaveformPlayerLazy } from '@/components/calls/call-waveform-player-lazy'
import { Badge } from '@/components/ui/badge'
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
  // view), so the tool-log query doesn't need to wait on the calls row —
  // fetch all in parallel instead of sequentially. workflow_tool_logs unions
  // new workflow_runs (kind='tool') rows with the legacy action_logs history.
  const [{ data: vapiCall }, { data: actionLogs }, { data: assistantMapping }] = await Promise.all([
    supabase
      .from('calls')
      .select('transcript_turns, started_at, success_evaluation')
      .eq('id', call.id)
      .maybeSingle(),
    supabase
      .from('workflow_tool_logs')
      .select('*')
      .eq('vapi_call_id', call.external_id)
      .order('created_at', { ascending: true }),
    // eq() against an empty string simply matches nothing when there's no
    // assistant_id, so this stays a single unconditional query shape (keeps
    // the Promise.all tuple typing simple) rather than branching per call.
    supabase
      .from('assistant_mappings')
      .select('name')
      .eq('vapi_assistant_id', call.assistant_id ?? '')
      .maybeSingle(),
  ])

  const turns = vapiCall?.started_at
    ? buildTimeline(
        (vapiCall.transcript_turns as ArtifactMessage[]) ?? [],
        actionLogs ?? [],
        vapiCall.started_at,
      )
    : []

  const assistantName = assistantMapping?.name ?? null
  const successEvaluation = vapiCall?.success_evaluation ?? null

  return (
    <div className={stacked ? 'flex flex-col gap-6' : 'grid gap-6 lg:grid-cols-3'}>
      <div className={stacked ? 'space-y-6' : 'lg:col-span-2 space-y-6'}>
        {call.recording_url && (
          <CallWaveformPlayerLazy
            url={`/api/calls/${call.id}/recording`}
            duration={call.recording_duration ?? call.duration_seconds ?? 0}
          />
        )}

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
            <MetaRow
              icon={Hash}
              label="Assistant"
              value={assistantName ?? call.assistant_id}
              mono={!assistantName}
            />
          )}
          <MetaRow icon={Hash} label="Vapi ID" value={call.external_id} mono />
          {call.substatus && (
            <MetaRow icon={Hash} label="Ended reason" value={call.substatus} />
          )}
          {successEvaluation && (
            <div className="flex items-start gap-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-bg-tertiary text-text-tertiary">
                <Sparkles className="h-3.5 w-3.5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">Outcome</div>
                <Badge variant={isPositiveEvaluation(successEvaluation) ? 'success' : 'default'} className="mt-1">
                  {successEvaluation}
                </Badge>
              </div>
            </div>
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

// analysis.successEvaluation is free-form: Vapi's default rubric sends the
// string 'true'/'false', but a custom rubric can send arbitrary text (already
// normalized to a string by persistCallRecord in src/lib/vapi/end-of-call.ts).
// Only the unambiguous positive values get the green badge; everything else
// (including custom rubric text) falls back to the neutral badge rather than
// guessing at a red/negative state.
function isPositiveEvaluation(value: string): boolean {
  return ['true', 'success', 'pass', 'passed', 'yes'].includes(value.trim().toLowerCase())
}

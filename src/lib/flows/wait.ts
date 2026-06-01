// Wait-for-event support for the flow engine.
//
// A workflow run can suspend at a `wait` node and resume later when a
// correlated event arrives (or the timeout elapses). Correlation is automatic:
// the wait is tied to the contact the run is about (resolved from run state),
// so "wait meeting.confirmed" resumes only when THAT contact's meeting confirms.
//
// Persistence uses the pre-existing `workflow_waits` table (migration 075),
// extended by migration 1129 with org_id/node_id/event_type/contact_id/timed_out_at.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

type Db = SupabaseClient<Database>

/** Parse a duration string like "7d" | "5m" | "2h" | "1w" → milliseconds. */
export function durationToMs(duration: string | undefined | null): number | null {
  if (!duration) return null
  const m = /^(\d+)\s*([smhdw])$/.exec(duration.trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  switch (m[2]) {
    case 's': return n * 1_000
    case 'm': return n * 60_000
    case 'h': return n * 3_600_000
    case 'd': return n * 86_400_000
    case 'w': return n * 604_800_000
    default: return null
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

/**
 * Resolve the contact id the run is "about", checking the common scope shapes
 * a workflow run carries (calendar/meeting, pipeline/opportunity, or generic).
 * Returns null when no contact can be determined (the wait then correlates by
 * event type only — see findUnsatisfiedWaits).
 */
export function resolveRunContactId(state: Record<string, unknown>): string | null {
  const meeting = asRecord(state.meeting)
  const attendee = meeting ? asRecord(meeting.attendee_contact) : null
  if (attendee && typeof attendee.id === 'string') return attendee.id

  const contact = asRecord(state.contact)
  if (contact && typeof contact.id === 'string') return contact.id

  const opportunity = asRecord(state.opportunity)
  if (opportunity && typeof opportunity.contact_id === 'string') return opportunity.contact_id

  const input = asRecord(state.input)
  if (input && typeof input.contact_id === 'string') return input.contact_id
  if (typeof state.contact_id === 'string') return state.contact_id

  // Trigger payload may carry the meeting/contact too.
  const trigger = asRecord(state.trigger)
  const payload = trigger ? asRecord(trigger.payload) : null
  if (payload) {
    const pMeeting = asRecord(payload.meeting)
    const pAttendee = pMeeting ? asRecord(pMeeting.attendee_contact) : null
    if (pAttendee && typeof pAttendee.id === 'string') return pAttendee.id
  }
  return null
}

export interface CreateWaitParams {
  runId: string
  orgId: string
  nodeId: string
  /** null for sleep mode (timeout-only). */
  eventType: string | null
  contactId: string | null
  eventFilter?: Record<string, unknown>
  timeoutAt: string | null
}

/** Insert a workflow_waits row for a suspended run. */
export async function createWait(supabase: Db, params: CreateWaitParams): Promise<void> {
  const { error } = await supabase.from('workflow_waits').insert({
    run_id: params.runId,
    org_id: params.orgId,
    node_id: params.nodeId,
    event_type: params.eventType,
    contact_id: params.contactId,
    event_filter: params.eventFilter ?? {},
    timeout_at: params.timeoutAt,
  } as never)
  if (error) throw new Error(`createWait failed: ${error.message}`)
}

export interface PendingWait {
  id: string
  run_id: string
  node_id: string
  event_type: string | null
  contact_id: string | null
}

/**
 * Find unsatisfied waits matching an incoming event for a given contact.
 * A wait matches when its event_type equals the incoming event AND either the
 * wait has no contact_id (uncorrelated) or it matches the event's contact_id.
 */
export async function findUnsatisfiedWaits(
  supabase: Db,
  params: { orgId: string; eventType: string; contactId: string | null },
): Promise<PendingWait[]> {
  let query = supabase
    .from('workflow_waits')
    .select('id, run_id, node_id, event_type, contact_id')
    .eq('org_id', params.orgId)
    .eq('event_type', params.eventType)
    .is('satisfied_at', null)

  const { data, error } = await query
  if (error || !data) return []

  const rows = data as unknown as PendingWait[]
  // Correlate by contact: keep waits with no contact (broad) or matching contact.
  return rows.filter(
    (w) => !w.contact_id || (params.contactId != null && w.contact_id === params.contactId),
  )
}

/** Find sleep/timeout waits whose deadline has passed and are still pending. */
export async function findExpiredWaits(supabase: Db, nowIso: string): Promise<PendingWait[]> {
  const { data, error } = await supabase
    .from('workflow_waits')
    .select('id, run_id, node_id, event_type, contact_id')
    .is('satisfied_at', null)
    .not('timeout_at', 'is', null)
    .lt('timeout_at', nowIso)
  if (error || !data) return []
  return data as unknown as PendingWait[]
}

/** Mark a wait satisfied (resumed by event) or timed out. */
export async function satisfyWait(
  supabase: Db,
  waitId: string,
  opts: { timedOut?: boolean } = {},
): Promise<void> {
  const now = new Date().toISOString()
  await supabase
    .from('workflow_waits')
    .update({
      satisfied_at: now,
      ...(opts.timedOut ? { timed_out_at: now } : {}),
    } as never)
    .eq('id', waitId)
    .is('satisfied_at', null)
}

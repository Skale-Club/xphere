// SEED-027 Phase B: one-path booking status transitions.
//
// Every booking mutation (create / confirm / cancel / reschedule / no_show /
// complete) flows through this module. Each transition:
//   1. Updates the bookings row in a transaction
//   2. Records an event_dispatches audit row capturing the transition
//   3. Enqueues matching workflows (lookup by trigger_type='event' and
//      trigger_config.event matches)
//
// The actual workflow enqueue is delegated to runWorkflow (SEED-025 Phase B
// runner). Phase C of SEED-027 adds the tick scheduler for time-based events.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { CalendarEvent, CalendarEventPayload } from '@/lib/calendar/events'
import { runFlowSync } from '@/lib/workflows/run-flow-sync'
import { buildMeetingScope } from '@/lib/calendar/scope'
import { runFlow, resumeRun, definitionHasWait } from '@/lib/flows/engine'
import type { FlowDefinition } from '@/lib/flows/schema'
import { findUnsatisfiedWaits, satisfyWait } from '@/lib/flows/wait'

// Resume any runs suspended at a wait node that this event satisfies (correlated
// to the event's contact). Fire-and-forget per wait so one failure can't block.
async function resumeMatchingWaits(
  supabase: SupabaseClient<Database>,
  params: { orgId: string; eventType: string; contactId: string | null; payload: Record<string, unknown> },
): Promise<void> {
  const waits = await findUnsatisfiedWaits(supabase, {
    orgId: params.orgId,
    eventType: params.eventType,
    contactId: params.contactId,
  })
  for (const w of waits) {
    await satisfyWait(supabase, w.id)
    await resumeRun(supabase, {
      runId: w.run_id,
      nodeId: w.node_id,
      event: params.eventType,
      payload: params.payload,
    })
  }
}

type BookingStatus = 'confirmed' | 'cancelled' | 'no_show' | 'showed'

interface TransitionContext {
  supabase: SupabaseClient<Database>
  // depth+parent_id let us detect runaway cascades (workflow → booking
  // creation → meeting.scheduled → another workflow → ...)
  parentDispatchId?: string | null
  depth?: number
}

const MAX_CASCADE_DEPTH = 3

async function recordDispatch(
  ctx: TransitionContext,
  orgId: string,
  event: CalendarEvent,
  bookingId: string,
  payload: Json,
  workflowIds: string[],
): Promise<string | null> {
  const { data, error } = await ctx.supabase
    .from('event_dispatches')
    .insert({
      org_id: orgId,
      event_type: event,
      source_table: 'bookings',
      source_id: bookingId,
      workflow_ids: workflowIds,
      payload,
      parent_id: ctx.parentDispatchId ?? null,
      depth: ctx.depth ?? 0,
    })
    .select('id')
    .single()

  if (error) {
    console.error('[calendar/transition] dispatch record error:', error.message)
    return null
  }
  return (data as { id: string }).id
}

interface MatchedWorkflow {
  id: string
  current_version_id: string | null
}

async function findMatchingWorkflows(
  supabase: SupabaseClient<Database>,
  orgId: string,
  event: CalendarEvent,
): Promise<MatchedWorkflow[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id, current_version_id')
    .eq('org_id', orgId)
    .eq('trigger_type', 'event')
    .eq('is_active', true)
    .eq('health_blocked', false)
    .contains('trigger_config', { event })

  if (error || !data) return []
  return (data as MatchedWorkflow[]).map((r) => ({
    id: r.id,
    current_version_id: r.current_version_id ?? null,
  }))
}

// Public API ------------------------------------------------------------------

export async function emitCalendarEvent(
  ctx: TransitionContext,
  payload: CalendarEventPayload,
): Promise<{ dispatched: number; dispatch_id: string | null }> {
  if ((ctx.depth ?? 0) > MAX_CASCADE_DEPTH) {
    console.warn(
      '[calendar/transition] cascade depth limit hit',
      payload.event,
      payload.booking_id,
    )
    return { dispatched: 0, dispatch_id: null }
  }

  const matched = await findMatchingWorkflows(ctx.supabase, payload.org_id, payload.event)
  const dispatch_id = await recordDispatch(
    ctx,
    payload.org_id,
    payload.event,
    payload.booking_id,
    payload as unknown as Json,
    matched.map((m) => m.id),
  )

  // Build the meeting scope for workflow variable interpolation + wait
  // correlation. Built unconditionally (even with no trigger matches) because a
  // run may be *waiting* for this event without any workflow being triggered by it.
  const scope = await buildMeetingScope(ctx.supabase, payload.booking_id, {
    rescheduled_from: payload.rescheduled_from,
    rescheduled_to: payload.rescheduled_to,
  })
  if (!scope) {
    return { dispatched: 0, dispatch_id }
  }

  const triggerInput: Record<string, unknown> = {
    meeting: scope,
    event: payload.event,
  }

  // Resume any runs suspended on a wait node that this event satisfies,
  // correlated to the meeting's contact. Independent of trigger matches.
  void resumeMatchingWaits(ctx.supabase, {
    orgId: payload.org_id,
    eventType: payload.event,
    contactId: scope.attendee_contact?.id ?? null,
    payload: triggerInput,
  }).catch((err) => {
    console.error('[calendar/transition] resumeMatchingWaits error:', err)
  })

  if (matched.length === 0) {
    return { dispatched: 0, dispatch_id }
  }

  // Load each matched workflow's current definition.
  const versionIds = matched
    .map((m) => m.current_version_id)
    .filter((id): id is string => Boolean(id))

  if (versionIds.length === 0) {
    return { dispatched: 0, dispatch_id }
  }

  const { data: versions } = await ctx.supabase
    .from('workflow_versions')
    .select('id, definition')
    .in('id', versionIds)

  const defById = new Map<string, unknown>()
  for (const v of versions ?? []) {
    defById.set(v.id as string, v.definition)
  }

  // Fire-and-forget each matched workflow. A failing workflow does not
  // block the event or the originating booking mutation.
  for (const wf of matched) {
    const definition = wf.current_version_id
      ? defById.get(wf.current_version_id)
      : null
    if (!definition) continue
    // Flows containing a wait node run through the persistent engine (supports
    // suspend/resume). Everything else stays on the lightweight sync runner.
    if (definitionHasWait(definition)) {
      void runFlow({
        workflowId: wf.id,
        versionId: wf.current_version_id ?? null,
        definition: definition as FlowDefinition,
        orgId: payload.org_id,
        triggerType: 'event',
        triggerPayload: triggerInput,
        supabase: ctx.supabase,
      }).catch((err) => {
        console.error('[calendar/transition] runFlow error:', err)
      })
    } else {
      void runFlowSync({
        workflowId: wf.id,
        definition,
        triggerInput,
        context: { orgId: payload.org_id },
      }).catch((err) => {
        console.error('[calendar/transition] runFlowSync error:', err)
      })
    }
  }

  return { dispatched: matched.length, dispatch_id }
}

export async function confirmBooking(
  ctx: TransitionContext,
  bookingId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: booking, error } = await ctx.supabase
    .from('bookings')
    .select('id, org_id, status, location_kind, event_type_id, start_at, end_at')
    .eq('id', bookingId)
    .single()

  if (error || !booking) return { ok: false, error: error?.message ?? 'Booking not found' }

  // Idempotent: re-confirm is a no-op (no event re-fire).
  if (booking.status === 'confirmed') return { ok: true }

  const updatePayload: Record<string, unknown> = { status: 'confirmed' as BookingStatus }

  // If the booking uses Google Meet and no meeting_url has been set yet,
  // create a Meet link and store it on the booking row.
  if (booking.location_kind === 'google_meet') {
    try {
      // Fetch event type title and booker email for the calendar event
      const { data: et } = await ctx.supabase
        .from('event_types')
        .select('title')
        .eq('id', booking.event_type_id as string)
        .maybeSingle()

      const { data: bk } = await ctx.supabase
        .from('bookings')
        .select('booker_email, meeting_url')
        .eq('id', bookingId)
        .maybeSingle()

      if (!bk?.meeting_url) {
        const { createMeetingLink } = await import('@/lib/calendar/google-calendar')
        const result = await createMeetingLink(booking.org_id as string, {
          title: et?.title ?? 'Meeting',
          startAt: booking.start_at as string,
          endAt: booking.end_at as string,
          attendeeEmail: bk?.booker_email ?? undefined,
        })
        if (result) {
          updatePayload.meeting_url = result.meeting_url
          updatePayload.location_data = { google_event_id: result.google_event_id }
        }
      }
    } catch (meetErr) {
      // Non-fatal | confirm proceeds without the Meet link
      console.warn(
        '[calendar/transition] Google Meet link creation failed:',
        meetErr instanceof Error ? meetErr.message : meetErr,
      )
    }
  }

  await ctx.supabase
    .from('bookings')
    .update(updatePayload)
    .eq('id', bookingId)

  await emitCalendarEvent(ctx, {
    event: 'meeting.confirmed',
    booking_id: bookingId,
    org_id: booking.org_id as string,
  })

  return { ok: true }
}

export async function cancelBooking(
  ctx: TransitionContext,
  bookingId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: booking, error } = await ctx.supabase
    .from('bookings')
    .select('id, org_id, status')
    .eq('id', bookingId)
    .single()

  if (error || !booking) return { ok: false, error: error?.message ?? 'Booking not found' }
  if (booking.status === 'cancelled') return { ok: true }

  await ctx.supabase
    .from('bookings')
    .update({ status: 'cancelled' as BookingStatus })
    .eq('id', bookingId)

  await emitCalendarEvent(ctx, {
    event: 'meeting.cancelled',
    booking_id: bookingId,
    org_id: booking.org_id as string,
  })

  return { ok: true }
}

export async function markNoShow(
  ctx: TransitionContext,
  bookingId: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: booking, error } = await ctx.supabase
    .from('bookings')
    .select('id, org_id, status')
    .eq('id', bookingId)
    .single()

  if (error || !booking) return { ok: false, error: error?.message ?? 'Booking not found' }
  if (booking.status === 'no_show') return { ok: true }

  await ctx.supabase
    .from('bookings')
    .update({ status: 'no_show' as BookingStatus })
    .eq('id', bookingId)

  await emitCalendarEvent(ctx, {
    event: 'meeting.no_show',
    booking_id: bookingId,
    org_id: booking.org_id as string,
  })

  return { ok: true }
}

export async function rescheduleBooking(
  ctx: TransitionContext,
  bookingId: string,
  newStartAt: string,
  newEndAt: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: booking, error } = await ctx.supabase
    .from('bookings')
    .select('id, org_id, start_at, end_at')
    .eq('id', bookingId)
    .single()

  if (error || !booking) return { ok: false, error: error?.message ?? 'Booking not found' }

  const oldStart = booking.start_at as string

  await ctx.supabase
    .from('bookings')
    .update({ start_at: newStartAt, end_at: newEndAt })
    .eq('id', bookingId)

  await emitCalendarEvent(ctx, {
    event: 'meeting.rescheduled',
    booking_id: bookingId,
    org_id: booking.org_id as string,
    rescheduled_from: oldStart,
    rescheduled_to: newStartAt,
  })

  return { ok: true }
}

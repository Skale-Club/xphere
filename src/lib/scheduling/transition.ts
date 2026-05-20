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
import type { CalendarEvent, CalendarEventPayload } from '@/lib/scheduling/events'

type BookingStatus = 'confirmed' | 'cancelled' | 'no_show'

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
    console.error('[scheduling/transition] dispatch record error:', error.message)
    return null
  }
  return (data as { id: string }).id
}

async function findMatchingWorkflows(
  supabase: SupabaseClient<Database>,
  orgId: string,
  event: CalendarEvent,
): Promise<string[]> {
  const { data, error } = await supabase
    .from('workflows')
    .select('id')
    .eq('org_id', orgId)
    .eq('trigger_type', 'event')
    .eq('is_active', true)
    .eq('health_blocked', false)
    .contains('trigger_config', { event })

  if (error || !data) return []
  return (data as { id: string }[]).map((r) => r.id)
}

// Public API ------------------------------------------------------------------

export async function emitCalendarEvent(
  ctx: TransitionContext,
  payload: CalendarEventPayload,
): Promise<{ dispatched: number; dispatch_id: string | null }> {
  if ((ctx.depth ?? 0) > MAX_CASCADE_DEPTH) {
    console.warn(
      '[scheduling/transition] cascade depth limit hit',
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
    matched,
  )

  // Actually invoking the workflow runtime is intentionally deferred to a
  // queue worker (or inline for tests) — SEED-027 Phase C ships the worker.
  // Phase B contract: the dispatch row exists and the workflow_ids are
  // captured. Run engine can re-walk recent rows even if it was offline.

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
        const { createMeetingLink } = await import('@/lib/scheduling/google-calendar')
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
      // Non-fatal — confirm proceeds without the Meet link
      console.warn(
        '[scheduling/transition] Google Meet link creation failed:',
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

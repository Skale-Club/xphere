// CAL-01 shared "resolve + validate slot" core. Both the public createBooking
// server action and the MCP bookings_create tool call this so a requested
// booking is validated identically everywhere:
//   1. The event type must exist and be active (+ belong to orgId, when given).
//   2. end_at is ALWAYS derived server-side from duration_minutes — callers
//      never supply it.
//   3. The requested [start_at, end_at) interval must fall entirely inside a
//      configured user_availability window for that weekday, in the host's
//      timezone, aligned to the same slot-duration grid generateSlots() would
//      offer, and must start at least MIN_ADVANCE_MINUTES (60, mirrors
//      slots.ts's own default) in the future — mirrors src/lib/calendar/
//      slots.ts::generateSlots's minAdvanceCutoff/stepMinutes logic
//      (slots.ts lines 99-116) so a requested time can never be accepted here
//      that generateSlots would never have offered as a displayed slot.
//      Checks ALL windows for that day (a host can configure more than one
//      window per day since migration 1140 — see Pitfall 5).
//   4. The interval must not overlap any other CONFIRMED, native
//      (external_source IS NULL) booking for the same organizer, across ANY
//      event type — mirrors the CAL-02 database exclusion constraint.
//   5. The interval must not overlap a busy interval on the host's connected
//      Google Calendar (best-effort — fails open on API error).
//
// createBookingInternal (operator/dashboard drag-to-create) intentionally does
// NOT call this helper — it allows duration overrides and bypasses
// booker-facing availability windows by design. It still respects the CAL-02
// database constraint like every other write path.
//
// Deferred (NOT fixed here): getAvailableSlots/getDebugSlots in
// src/app/(dashboard)/calendar/_actions/bookings.ts still use .maybeSingle()
// on user_availability and only pass a single window into generateSlots, so
// they throw on a day with 2+ configured windows (RESEARCH.md Pitfall 5).
// This helper's own window-matching logic below is unaffected — it always
// queries user_availability as an array — but the *display* path a booker
// sees slots from is a separate, pre-existing bug, explicitly out of scope.

import { addMinutes } from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { fetchBusyTimes } from '@/lib/calendar/google-calendar'

export type SlotValidationError =
  | 'event_type_not_found'
  | 'invalid_start_at'
  | 'outside_availability'
  | 'slot_taken'

export interface ResolvedEventType {
  id: string
  org_id: string
  user_id: string
  title: string
  duration_minutes: number
  location_type: string
  location_value: string | null
  allowed_location_kinds: string[]
}

export interface ResolvedSlot {
  eventType: ResolvedEventType
  startAt: Date
  endAt: Date
  hostTimezone: string
}

export type SlotValidationResult =
  | { ok: true; data: ResolvedSlot }
  | { ok: false; error: SlotValidationError }

// Mirrors slots.ts::generateSlots's default minAdvanceMinutes (60) — every
// caller of generateSlots in this codebase passes minAdvanceMinutes: 60, so
// this must match to reject the same "too soon" starts generateSlots would
// never have offered.
const MIN_ADVANCE_MINUTES = 60

function overlapsRange(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart < bEnd && aEnd > bStart
}

function parseTime(timeStr: string): [number, number] {
  const parts = timeStr.split(':')
  return [parseInt(parts[0], 10), parseInt(parts[1], 10)]
}

export async function resolveAndValidateSlot(
  supabase: SupabaseClient<Database>,
  params: { eventTypeId: string; startAtIso: string; orgId?: string },
): Promise<SlotValidationResult> {
  const startAt = new Date(params.startAtIso)
  if (Number.isNaN(startAt.getTime())) {
    return { ok: false, error: 'invalid_start_at' }
  }

  let etQuery = supabase
    .from('event_types')
    .select('id, org_id, user_id, title, duration_minutes, location_type, location_value, allowed_location_kinds')
    .eq('id', params.eventTypeId)
    .eq('active', true)
  if (params.orgId) etQuery = etQuery.eq('org_id', params.orgId)
  const { data: et } = await etQuery.maybeSingle()
  if (!et) return { ok: false, error: 'event_type_not_found' }

  const endAt = addMinutes(startAt, et.duration_minutes)

  // Reject anything not at least MIN_ADVANCE_MINUTES out, same as
  // generateSlots's minAdvanceCutoff (slots.ts:99-100, 113-116). Without
  // this, a past or too-soon start would pass every other check below and
  // still be inserted as a confirmed booking.
  const minAdvanceCutoff = addMinutes(new Date(), MIN_ADVANCE_MINUTES)
  if (startAt < minAdvanceCutoff) {
    return { ok: false, error: 'outside_availability' }
  }

  const { data: profile } = await supabase
    .from('calendar_profiles')
    .select('timezone, conflict_calendar_ids')
    .eq('user_id', et.user_id)
    .maybeSingle()
  const hostTimezone = profile?.timezone ?? 'UTC'
  const conflictCalendarIds = profile?.conflict_calendar_ids?.length
    ? profile.conflict_calendar_ids
    : ['primary']

  const localStart = toZonedTime(startAt, hostTimezone)
  const dow = localStart.getDay()

  const { data: windows } = await supabase
    .from('user_availability')
    .select('start_time, end_time')
    .eq('user_id', et.user_id)
    .eq('day_of_week', dow)

  // Same grid step generateSlots uses (stepMinutes = durationMinutes +
  // bufferMinutes; every caller of generateSlots in this codebase passes
  // bufferMinutes: 0) — a requested start must land exactly on a slot
  // boundary generateSlots would actually offer, not just anywhere inside
  // the window.
  const stepMs = et.duration_minutes * 60_000

  const withinAnyWindow = (windows ?? []).some((w) => {
    const [startH, startM] = parseTime(w.start_time)
    const [endH, endM] = parseTime(w.end_time)
    const dayBase = new Date(localStart.getFullYear(), localStart.getMonth(), localStart.getDate())
    const windowStartLocal = new Date(dayBase)
    windowStartLocal.setHours(startH, startM, 0, 0)
    const windowEndLocal = new Date(dayBase)
    windowEndLocal.setHours(endH, endM, 0, 0)
    const windowStartUtc = fromZonedTime(windowStartLocal, hostTimezone)
    const windowEndUtc = fromZonedTime(windowEndLocal, hostTimezone)
    if (!(startAt >= windowStartUtc && endAt <= windowEndUtc)) return false
    return (startAt.getTime() - windowStartUtc.getTime()) % stepMs === 0
  })
  if (!withinAnyWindow) return { ok: false, error: 'outside_availability' }

  const { data: organizerEventTypes } = await supabase
    .from('event_types')
    .select('id')
    .eq('user_id', et.user_id)
    .eq('org_id', et.org_id)
  const eventTypeIds = (organizerEventTypes ?? []).map((r) => r.id)

  // Selected as an array (never .maybeSingle()) — this query can legitimately
  // match more than one row when the requested interval spans two
  // back-to-back existing bookings; .maybeSingle() would throw a
  // PostgREST "more than one row" error and the overlap would never
  // surface as slot_taken at the app layer.
  const { data: conflicts } = await supabase
    .from('bookings')
    .select('id')
    .in('event_type_id', eventTypeIds)
    .eq('status', 'confirmed')
    .is('external_source', null)
    .lt('start_at', endAt.toISOString())
    .gt('end_at', startAt.toISOString())
  if (conflicts && conflicts.length > 0) return { ok: false, error: 'slot_taken' }

  const busyTimes = await fetchBusyTimes(
    et.user_id,
    et.org_id,
    startAt.toISOString(),
    endAt.toISOString(),
    conflictCalendarIds,
  ).catch(() => [])
  const busyConflict = busyTimes.some((b) =>
    overlapsRange(startAt, endAt, new Date(b.start), new Date(b.end)),
  )
  if (busyConflict) return { ok: false, error: 'slot_taken' }

  return { ok: true, data: { eventType: et, startAt, endAt, hostTimezone } }
}

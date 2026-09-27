// src/lib/action-engine/executors/calendar-book-meeting.ts
// Executor for `calendar_book_meeting`: books a slot on the platform's OWN
// calendar, the one behind /book/<profile>/<event-type>.
//
// Reuses createBooking(), the same path the public page uses — slot
// revalidation, contact linking, confirmation email, cancel token. This module
// adds only what a phone call needs on top: the spoken-consent gate.
//
// THE GATE. On a voice call the assistant must read the meeting back and hear
// a yes before anything is written, and it must not be able to talk itself
// into that yes. checkVoiceBookingConfirmation() is the same check the Xkedule
// booking writes carry; it works from the call transcript, so a "confirmed:
// true" the model asserts on its own is worth nothing. Without a voice
// context — a chat agent, a workflow, a test — the gate does not apply, and
// the write is as consented as any other button someone clicked.

import { createBooking } from '@/app/(dashboard)/calendar/_actions/bookings'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  checkVoiceBookingConfirmation,
  type VoiceBookingContext,
} from '@/lib/vapi/booking-confirmation'

export interface ExecuteCalendarBookMeetingParams {
  orgId: string
  /** event_types.id, or the event type's slug within this org. */
  eventType: string
  /** ISO 8601 start, or 'YYYY-MM-DD' + 'HH:MM' via date/time. */
  startAt?: string
  date?: string
  time?: string
  name: string
  email: string
  phone?: string
  notes?: string
  /** Voice only: true once the caller has heard the read-back and agreed. */
  confirmed?: boolean
  confirmationToken?: string
  /** Present when the call came through /api/vapi/tools. */
  voiceBooking?: VoiceBookingContext
}

/**
 * How far `timeZone`'s wall clock sits from UTC's at a given instant, in ms.
 *
 * formatToParts rather than toLocaleString + Date parsing: the latter round
 * trips through a localised string that only parses correctly because the
 * server's own zone happens to cancel out, and it is at the mercy of whatever
 * format the runtime's en-US locale produces.
 */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const at = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  const wallAsUtc = Date.UTC(at('year'), at('month') - 1, at('day'), at('hour'), at('minute'), at('second'))
  return wallAsUtc - instant.getTime()
}

/**
 * Only used when the caller passes date + time instead of an ISO instant.
 * Exported for tests: getting this wrong books somebody an hour out, and that
 * is not visible from the outside until they turn up to an empty call.
 */
export function isoFromParts(date: string, time: string, timezone: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const wall = Date.parse(`${date}T${time}:00Z`)
  if (Number.isNaN(wall)) return null

  // Two passes. The first measures the zone's offset at the wall-clock time
  // read as if it were UTC, which is off by the offset itself; the second
  // measures it at the instant that guess produced — the instant actually
  // being booked. Without the second pass a booking near a DST boundary is
  // filed an hour out, because the offset was sampled on the wrong side of it.
  //
  // This replaced a toLocaleString round trip that was correct only when the
  // server's own zone happened to cancel out. Under TZ=UTC — which is what the
  // container runs — 03:00 on 1 Nov 2026 in New York came back as 02:00.
  const firstGuess = wall - zoneOffsetMs(new Date(wall), timezone)
  const instant = wall - zoneOffsetMs(new Date(firstGuess), timezone)
  return new Date(instant).toISOString()
}

export async function executeCalendarBookMeeting(
  params: ExecuteCalendarBookMeetingParams,
): Promise<string> {
  const { orgId, eventType, name, email } = params

  if (!name?.trim()) return 'NOT BOOKED. Ask for a name first.'
  if (!email?.trim()) {
    return (
      'NOT BOOKED. This meeting needs an email address — it is where the invite and the video link go. ' +
      'Ask for it, read it back letter by letter, and try again.'
    )
  }

  const supabase = createServiceRoleClient()

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventType ?? '')
  const { data: row } = await supabase
    .from('event_types')
    .select('id, title, duration_minutes, user_id')
    .eq('org_id', orgId)
    .eq('active', true)
    .eq(isUuid ? 'id' : 'slug', eventType)
    .maybeSingle()
  if (!row) return `NOT BOOKED. There is no active "${eventType}" in this organization.`

  const { data: profile } = await supabase
    .from('calendar_profiles')
    .select('timezone')
    .eq('user_id', row.user_id)
    .maybeSingle()
  const timezone = profile?.timezone ?? 'UTC'

  const startAtIso =
    params.startAt?.trim() ||
    (params.date && params.time ? isoFromParts(params.date, params.time, timezone) : null)
  if (!startAtIso || Number.isNaN(Date.parse(startAtIso))) {
    return 'NOT BOOKED. The start time could not be read. Give a full date and a clock time.'
  }

  // The spoken-consent gate, voice only.
  if (params.voiceBooking) {
    const local = new Date(startAtIso)
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, dateStyle: 'short' }).format(local)
    const clock = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(local)

    const verdict = checkVoiceBookingConfirmation(
      params as unknown as Record<string, unknown>,
      orgId,
      params.voiceBooking,
      'create',
      { services: [row.title], date: day, time: clock, customerName: name.trim() },
    )
    if (!verdict.allowed) return verdict.instruction
  }

  const result = await createBooking({
    event_type_id: row.id,
    start_at: startAtIso,
    booker_name: name.trim(),
    booker_email: email.trim(),
    booker_phone: params.phone?.trim() || undefined,
    booker_timezone: timezone,
    notes: params.notes?.trim() || undefined,
  })

  if (!result.ok) {
    if (result.error === 'slot_taken') {
      return 'NOT BOOKED. Somebody took that time while you were talking. Offer the next one.'
    }
    if (result.error === 'rate_limited') {
      return 'NOT BOOKED. Too many bookings from here in the last hour. Take a message instead.'
    }
    return `NOT BOOKED (${result.error}). Say it did not go through and offer to take a message.`
  }

  const spoken = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(new Date(startAtIso))

  return `Booked: ${row.title}, ${spoken} (${timezone}). A confirmation with the video link is on its way to ${email.trim()}.`
}

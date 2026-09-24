// src/lib/action-engine/executors/calendar-slots.ts
// Executor for `calendar_list_slots`: free times on the platform's OWN
// calendar — the one behind /book/<profile>/<event-type>.
//
// Reuses getAvailableSlots(), the same function the public booking page calls,
// so a caller on the phone and a visitor on the page are told the same thing.
// Anything that hides a slot there — a booking, a Google conflict, the
// look-busy setting — hides it here too, without this module knowing any of it
// exists.
//
// The answer is a spoken sentence, not JSON. A voice assistant reads the tool
// result aloud almost verbatim, and a list of ISO timestamps is unspeakable.

import { getAvailableSlots } from '@/app/(dashboard)/calendar/_actions/bookings'
import { createServiceRoleClient } from '@/lib/supabase/admin'

export interface ExecuteCalendarListSlotsParams {
  orgId: string
  /** event_types.id, or the event type's slug within this org. */
  eventType: string
  /** YYYY-MM-DD, in the host's timezone. */
  date: string
  /** How many to speak. A caller cannot hold sixteen times in their head. */
  limit?: number
}

const DEFAULT_LIMIT = 4

/** "9 AM", "9:30 AM" from the slot's own local "HH:mm" — the way people say a time. */
function spokenTime(startLocal: string): string {
  const [hourText, minuteText] = startLocal.split(':')
  const hour24 = Number(hourText)
  const minute = Number(minuteText)
  if (!Number.isFinite(hour24) || !Number.isFinite(minute)) return startLocal
  const period = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return minute === 0 ? `${hour12} ${period}` : `${hour12}:${String(minute).padStart(2, '0')} ${period}`
}

export async function executeCalendarListSlots(
  params: ExecuteCalendarListSlotsParams,
): Promise<string> {
  const { orgId, eventType, date } = params
  const limit = Math.min(Math.max(params.limit ?? DEFAULT_LIMIT, 1), 8)

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    return 'That date could not be read. Ask for a day like "next Tuesday" and resolve it to a full date first.'
  }

  const supabase = createServiceRoleClient()

  // Accept a slug so a workflow can be written without pasting a uuid, and an
  // id so a mesh that already resolved one does not pay for a second lookup.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventType ?? '')
  const { data: row } = await supabase
    .from('event_types')
    .select('id, title, duration_minutes, user_id')
    .eq('org_id', orgId)
    .eq('active', true)
    .eq(isUuid ? 'id' : 'slug', eventType)
    .maybeSingle()

  if (!row) return `There is no active "${eventType}" to book in this organization.`

  const { data: profile } = await supabase
    .from('calendar_profiles')
    .select('timezone')
    .eq('user_id', row.user_id)
    .maybeSingle()
  const timezone = profile?.timezone ?? 'UTC'

  const result = await getAvailableSlots({ eventTypeId: row.id, date, bookerTimezone: timezone })
  if (!result.ok) return `Availability could not be read right now (${result.error}).`

  // getAvailableSlots returns only what is actually bookable — a taken slot, a
  // Google conflict or one hidden by look-busy never comes back at all.
  const open = result.data
  if (open.length === 0) {
    return `Nothing is open on ${date} for ${row.title}. Offer another day.`
  }

  const times = open.slice(0, limit).map((slot) => spokenTime(slot.startLocal))
  const more = open.length > times.length ? `, and ${open.length - times.length} more` : ''
  return (
    `${row.title} (${row.duration_minutes} minutes) is open on ${date} at ${times.join(', ')}${more}. ` +
    `Times are ${timezone}. Offer at most two of them at a time.`
  )
}

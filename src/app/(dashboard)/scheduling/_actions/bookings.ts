'use server'

import { z } from 'zod'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { addMinutes, startOfDay, endOfDay, addDays } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { generateSlots } from '@/lib/scheduling/slots'
import { fetchBusyTimes } from '@/lib/scheduling/google-calendar'
import type { TimeSlot } from '@/lib/scheduling/slots'

type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; error: string }

export type BookingRow = {
  id: string
  org_id: string
  event_type_id: string
  booker_name: string
  booker_email: string
  booker_phone: string | null
  booker_timezone: string
  start_at: string
  end_at: string
  notes: string | null
  status: string
  linked_contact_id: string | null
  cancel_token: string
  created_at: string
  updated_at: string
}

// ─── Dashboard: list bookings ──────────────────────────────────────────────────

export async function getBookings(params: {
  status?: string
  from?: string
  to?: string
} = {}): Promise<ActionResult<BookingRow[]>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  let query = supabase
    .from('bookings')
    .select('*')
    .order('start_at', { ascending: true })

  if (params.status) query = query.eq('status', params.status as 'confirmed' | 'cancelled' | 'no_show')
  if (params.from) query = query.gte('start_at', params.from)
  if (params.to) query = query.lte('start_at', params.to)

  const { data, error } = await query
  if (error) return { ok: false, error: error.message }
  return { ok: true, data: data ?? [] }
}

// ─── Dashboard: cancel booking ────────────────────────────────────────────────

export async function cancelBooking(id: string): Promise<ActionResult<void>> {
  const user = await getUser()
  if (!user) return { ok: false, error: 'not_authenticated' }

  const supabase = await createClient()
  const { error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)

  if (error) return { ok: false, error: error.message }
  revalidatePath('/scheduling/bookings')
  return { ok: true, data: undefined }
}

// ─── Public: get available slots for a date ───────────────────────────────────
// Called server-side from the public booking page (no auth needed).

export async function getAvailableSlots(params: {
  eventTypeId: string
  date: string // 'YYYY-MM-DD'
  bookerTimezone?: string
}): Promise<ActionResult<TimeSlot[]>> {
  const supabase = createServiceRoleClient()

  // Fetch event type
  const { data: et } = await supabase
    .from('event_types')
    .select('*')
    .eq('id', params.eventTypeId)
    .eq('active', true)
    .single()

  if (!et) return { ok: false, error: 'event_type_not_found' }

  const userId = et.user_id
  const orgId = et.org_id

  // Fetch scheduling profile for timezone
  const { data: profile } = await supabase
    .from('scheduling_profiles')
    .select('timezone')
    .eq('user_id', userId)
    .single()

  const timezone = profile?.timezone ?? 'UTC'

  // Map date string to day of week
  const [year, month, day] = params.date.split('-').map(Number)
  const dateObj = new Date(year, month - 1, day)
  const dow = dateObj.getDay()

  // Fetch availability for that day
  const { data: avail } = await supabase
    .from('user_availability')
    .select('start_time, end_time')
    .eq('user_id', userId)
    .eq('day_of_week', dow)
    .maybeSingle()

  if (!avail) return { ok: true, data: [] }

  // Fetch existing bookings for that day (in UTC range)
  const dayStartUtc = fromZonedTime(
    new Date(year, month - 1, day, 0, 0, 0),
    timezone,
  )
  const dayEndUtc = fromZonedTime(
    new Date(year, month - 1, day, 23, 59, 59),
    timezone,
  )

  const { data: existing } = await supabase
    .from('bookings')
    .select('start_at, end_at')
    .eq('event_type_id', params.eventTypeId)
    .eq('status', 'confirmed')
    .gte('start_at', dayStartUtc.toISOString())
    .lte('start_at', dayEndUtc.toISOString())

  const existingBookings = (existing ?? []).map((b) => ({
    start: b.start_at,
    end: b.end_at,
  }))

  // Fetch Google Calendar busy times (optional, fails silently)
  const busyTimes = await fetchBusyTimes(
    userId,
    orgId,
    dayStartUtc.toISOString(),
    dayEndUtc.toISOString(),
  ).catch(() => [])

  const slots = generateSlots({
    date: params.date,
    timezone,
    durationMinutes: et.duration_minutes,
    availability: avail,
    existingBookings,
    busyTimes,
    bufferMinutes: 0,
    minAdvanceMinutes: 60,
  })

  return { ok: true, data: slots }
}

// ─── Public: create booking ───────────────────────────────────────────────────

const createBookingSchema = z.object({
  event_type_id: z.string().uuid(),
  start_at: z.string(), // ISO 8601
  booker_name: z.string().min(1).max(100),
  booker_email: z.string().email(),
  booker_phone: z.string().max(30).optional(),
  booker_timezone: z.string().default('UTC'),
  notes: z.string().max(2000).optional(),
})

export type CreateBookingInput = z.input<typeof createBookingSchema>

export async function createBooking(
  input: CreateBookingInput,
): Promise<ActionResult<{ id: string; cancel_token: string }>> {
  const parsed = createBookingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  const supabase = createServiceRoleClient()

  // Fetch event type to get duration and org_id
  const { data: et } = await supabase
    .from('event_types')
    .select('duration_minutes, org_id, user_id, title, location_type, location_value')
    .eq('id', parsed.data.event_type_id)
    .eq('active', true)
    .single()

  if (!et) return { ok: false, error: 'event_type_not_found' }

  // Fetch timezone separately (no FK between event_types and scheduling_profiles)
  const { data: hostProfile } = await supabase
    .from('scheduling_profiles')
    .select('timezone')
    .eq('user_id', et.user_id)
    .maybeSingle()
  const hostTimezone = hostProfile?.timezone ?? 'UTC'

  const startAt = new Date(parsed.data.start_at)
  const endAt = addMinutes(startAt, et.duration_minutes)

  // Double-check slot is still available (race condition guard)
  const { data: conflict } = await supabase
    .from('bookings')
    .select('id')
    .eq('event_type_id', parsed.data.event_type_id)
    .eq('status', 'confirmed')
    .lt('start_at', endAt.toISOString())
    .gt('end_at', startAt.toISOString())
    .maybeSingle()

  if (conflict) return { ok: false, error: 'slot_taken' }

  // Create or link CRM contact
  let linkedContactId: string | null = null
  try {
    const { data: existing } = await supabase
      .from('contacts')
      .select('id')
      .eq('org_id', et.org_id)
      .eq('email', parsed.data.booker_email)
      .maybeSingle()

    if (existing) {
      linkedContactId = existing.id
    } else {
      const nameParts = parsed.data.booker_name.trim().split(/\s+/)
      const { data: newContact } = await supabase
        .from('contacts')
        .insert({
          org_id: et.org_id,
          name: parsed.data.booker_name,
          email: parsed.data.booker_email,
          phone: parsed.data.booker_phone ?? null,
          source: 'manual',
        })
        .select('id')
        .single()
      linkedContactId = newContact?.id ?? null
    }
  } catch {
    // CRM link failure is non-fatal
  }

  // Insert booking
  const { data: booking, error } = await supabase
    .from('bookings')
    .insert({
      org_id: et.org_id,
      event_type_id: parsed.data.event_type_id,
      booker_name: parsed.data.booker_name,
      booker_email: parsed.data.booker_email,
      booker_phone: parsed.data.booker_phone ?? null,
      booker_timezone: parsed.data.booker_timezone,
      start_at: startAt.toISOString(),
      end_at: endAt.toISOString(),
      notes: parsed.data.notes ?? null,
      linked_contact_id: linkedContactId,
      status: 'confirmed',
    })
    .select('id, cancel_token')
    .single()

  if (error || !booking) {
    // 23505 = Postgres unique_violation. The partial unique index
    // idx_bookings_event_slot_unique (migration 072) fires when a concurrent
    // request booked this slot between our pre-SELECT and INSERT.
    const code = (error as { code?: string } | null)?.code
    if (code === '23505') return { ok: false, error: 'slot_taken' }
    return { ok: false, error: error?.message ?? 'create_failed' }
  }

  // Create Google Calendar event (fire-and-forget, non-fatal)
  try {
    const { createCalendarEvent } = await import('@/lib/scheduling/google-calendar')
    await createCalendarEvent(et.user_id, et.org_id, {
      summary: `${et.title} with ${parsed.data.booker_name}`,
      description: parsed.data.notes,
      start: startAt.toISOString(),
      end: endAt.toISOString(),
      attendeeEmail: parsed.data.booker_email,
      attendeeName: parsed.data.booker_name,
      location: et.location_value ?? undefined,
      timezone: hostTimezone,
    })
  } catch {
    // Non-fatal
  }

  return { ok: true, data: { id: booking.id, cancel_token: booking.cancel_token } }
}

// ─── Public: cancel via token ─────────────────────────────────────────────────

export async function cancelBookingByToken(
  bookingId: string,
  cancelToken: string,
): Promise<ActionResult<void>> {
  const supabase = createServiceRoleClient()

  const { data, error } = await supabase
    .from('bookings')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', bookingId)
    .eq('cancel_token', cancelToken)
    .eq('status', 'confirmed')
    .select('id')
    .single()

  if (error || !data) return { ok: false, error: 'not_found_or_already_cancelled' }
  return { ok: true, data: undefined }
}

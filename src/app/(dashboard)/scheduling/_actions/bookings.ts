'use server'

import { z } from 'zod'
import { headers } from 'next/headers'
import { createClient, getUser } from '@/lib/supabase/server'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { revalidatePath } from 'next/cache'
import { addMinutes, startOfDay, endOfDay, addDays } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { generateSlots } from '@/lib/scheduling/slots'
import { fetchBusyTimes } from '@/lib/scheduling/google-calendar'
import { rateLimit } from '@/lib/rate-limit'
import {
  sendBookingConfirmation,
  sendBookingCancellation,
} from '@/lib/scheduling/emails'
import type { TimeSlot } from '@/lib/scheduling/slots'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xphere.app'

// Resolve a friendly host display string from auth.users. We don't have a
// dedicated profile-name table for scheduling, so fall back to the email.
// Returns 'your host' as a final fallback so the email body always reads ok.
// Build a defaults map for required custom_field_definitions on contacts.
// The public booker has no UI to fill these in; we provide sensible
// type-appropriate defaults so the contact insert satisfies any required-
// field invariant the org has configured. If the org has none, returns {}.
//
// Service role read | public booking has no auth.uid() context.
async function buildRequiredCustomFieldDefaults(
  orgId: string,
): Promise<Record<string, unknown>> {
  try {
    const svc = createServiceRoleClient()
    const { data } = await svc
      .from('custom_field_definitions')
      .select('key, type, default_value')
      .eq('org_id', orgId)
      .eq('entity', 'contact')
      .eq('required', true)
      .eq('archived', false)

    const defaults: Record<string, unknown> = {}
    for (const def of data ?? []) {
      // Honor an explicit default_value if the admin set one.
      if (def.default_value !== null && def.default_value !== undefined) {
        defaults[def.key] = def.default_value
        continue
      }
      defaults[def.key] = defaultForType(def.type as string)
    }
    return defaults
  } catch (err) {
    console.warn(
      '[scheduling/bookings] failed to load custom field defaults:',
      err instanceof Error ? err.message : err,
    )
    return {}
  }
}

function defaultForType(type: string): unknown {
  switch (type) {
    case 'text':
    case 'long_text':
    case 'select':
    case 'email':
    case 'url':
    case 'phone':
      return ''
    case 'number':
    case 'integer':
      return 0
    case 'boolean':
      return false
    case 'date':
      return '1970-01-01'
    case 'datetime':
      return '1970-01-01T00:00:00.000Z'
    case 'multi_select':
      return []
    case 'currency':
      return { amount: 0, currency: 'USD' }
    default:
      return null
  }
}

async function resolveHostName(userId: string): Promise<string> {
  try {
    const svc = createServiceRoleClient()
    const { data } = await svc.auth.admin.getUserById(userId)
    const user = data?.user
    if (!user) return 'your host'
    const meta = (user.user_metadata ?? {}) as Record<string, unknown>
    const fullName =
      (typeof meta.full_name === 'string' && meta.full_name) ||
      (typeof meta.name === 'string' && meta.name) ||
      null
    if (fullName) return fullName
    return user.email ?? 'your host'
  } catch {
    return 'your host'
  }
}

// Extract the client IP from the incoming request headers. Vercel + most
// reverse proxies populate x-forwarded-for (comma-separated). We take the
// first entry. Falls back to x-real-ip, then 'unknown' so rate limiting
// degrades to a single shared bucket rather than crashing.
async function getClientIp(): Promise<string> {
  try {
    const h = await headers()
    const xff = h.get('x-forwarded-for')
    if (xff) return xff.split(',')[0].trim()
    const xri = h.get('x-real-ip')
    if (xri) return xri.trim()
  } catch {
    // headers() throws outside a request context | treat as unknown.
  }
  return 'unknown'
}

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

  // Fire-and-forget booker notification.
  void sendCancellationEmailForBooking(id).catch(() => {})

  return { ok: true, data: undefined }
}

// Shared helper for cancellation paths. Looks up the booking + event type
// + scheduling profile + host name, then queues the cancellation email.
// Never throws | caller wraps with .catch already.
async function sendCancellationEmailForBooking(bookingId: string): Promise<void> {
  try {
    const svc = createServiceRoleClient()

    const { data: b } = await svc
      .from('bookings')
      .select('id, booker_name, booker_email, booker_timezone, start_at, event_type_id')
      .eq('id', bookingId)
      .maybeSingle()
    if (!b) return

    const { data: et } = await svc
      .from('event_types')
      .select('title, user_id, slug')
      .eq('id', b.event_type_id)
      .maybeSingle()
    if (!et) return

    const { data: profile } = await svc
      .from('scheduling_profiles')
      .select('slug')
      .eq('user_id', et.user_id)
      .maybeSingle()

    const hostName = await resolveHostName(et.user_id)
    const rebookUrl = profile?.slug
      ? `${SITE_URL}/book/${profile.slug}/${et.slug}`
      : `${SITE_URL}`

    await sendBookingCancellation({
      bookerEmail: b.booker_email,
      bookerName: b.booker_name,
      hostName,
      eventTitle: et.title,
      startAt: b.start_at,
      timezone: b.booker_timezone,
      rebookUrl,
    })
  } catch (err) {
    console.warn(
      '[scheduling/bookings] cancellation email pipeline failed:',
      err instanceof Error ? err.message : err,
    )
  }
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
  location_kind: z.string().optional(),
})

export type CreateBookingInput = z.input<typeof createBookingSchema>

export async function createBooking(
  input: CreateBookingInput,
): Promise<ActionResult<{ id: string; cancel_token: string }>> {
  const parsed = createBookingSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'validation_error' }

  // Rate limit per (IP, event_type) | 5 bookings per hour. Fails open if
  // Redis is unreachable so we never block legitimate traffic on infra hiccups.
  const ip = await getClientIp()
  const rl = await rateLimit(
    `booking:${ip}:${parsed.data.event_type_id}`,
    5,
    3600,
  )
  if (!rl.allowed) return { ok: false, error: 'rate_limited' }

  const supabase = createServiceRoleClient()

  // Fetch event type to get duration and org_id
  const { data: et } = await supabase
    .from('event_types')
    .select('duration_minutes, org_id, user_id, title, location_type, location_value, allowed_location_kinds')
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
      // Build defaults for required custom_field_definitions so the insert
      // does not violate any org-level required-field invariant. If the org
      // has no required custom fields this returns {} and the insert is a no-op.
      const customFieldsDefaults = await buildRequiredCustomFieldDefaults(et.org_id)

      const { data: newContact, error: insertErr } = await supabase
        .from('contacts')
        .insert({
          org_id: et.org_id,
          name: parsed.data.booker_name,
          email: parsed.data.booker_email,
          phone: parsed.data.booker_phone ?? null,
          source: 'manual',
          custom_fields: customFieldsDefaults,
        })
        .select('id')
        .single()
      if (insertErr) {
        // Validation / constraint failure | log + fall back to no link.
        console.warn(
          '[scheduling/bookings] contact auto-create failed; booking will proceed without contact link:',
          insertErr.message,
        )
      } else {
        linkedContactId = newContact?.id ?? null
      }
    }
  } catch (err) {
    // CRM link failure is non-fatal | log + proceed.
    console.warn(
      '[scheduling/bookings] contact link pipeline failed:',
      err instanceof Error ? err.message : err,
    )
  }

  // Determine the effective location kind:
  // Use the booker's selection if it's one of the allowed kinds; otherwise
  // fall back to the first allowed kind (or the legacy location_type).
  const allowedKinds = (et.allowed_location_kinds ?? []) as string[]
  const effectiveLocationKind: string | null =
    parsed.data.location_kind && allowedKinds.includes(parsed.data.location_kind)
      ? parsed.data.location_kind
      : (allowedKinds[0] ?? et.location_type ?? null)

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
      location_kind: effectiveLocationKind,
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

  // Booker confirmation email (fire-and-forget, helper never throws).
  // We pass an inline `void` so the action returns immediately; the email
  // helper has its own try/catch that logs and swallows any failure.
  void (async () => {
    const hostName = await resolveHostName(et.user_id)
    const cancelUrl = `${SITE_URL}/book/cancel/${booking.id}?token=${booking.cancel_token}`

    // Re-fetch the booking to pick up any meeting_url written by the
    // google_meet flow that runs in the same request.
    const { data: freshBooking } = await supabase
      .from('bookings')
      .select('meeting_url, meeting_phone, location_data')
      .eq('id', booking.id)
      .maybeSingle()

    await sendBookingConfirmation({
      bookerEmail: parsed.data.booker_email,
      bookerName: parsed.data.booker_name,
      hostName,
      eventTitle: et.title,
      startAt: startAt.toISOString(),
      endAt: endAt.toISOString(),
      timezone: parsed.data.booker_timezone,
      cancelUrl,
      locationKind: effectiveLocationKind ?? undefined,
      meetingUrl: freshBooking?.meeting_url ?? undefined,
      meetingPhone: freshBooking?.meeting_phone ?? undefined,
      locationAddress: et.location_value ?? undefined,
    })
  })().catch(() => {})

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

  // Fire-and-forget booker notification.
  void sendCancellationEmailForBooking(bookingId).catch(() => {})

  return { ok: true, data: undefined }
}

import { z } from 'zod'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { verifyApiKey } from '@/lib/api-keys/verify'
import {
  createBooking,
  getAvailableSlots,
} from '@/app/(dashboard)/calendar/_actions/bookings'

export const runtime = 'nodejs'

const querySchema = z.object({
  profile_slug: z.string().trim().min(1).max(120),
  event_type_slug: z.string().trim().min(1).max(120),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

const bookingSchema = z.object({
  profile_slug: z.string().trim().min(1).max(120),
  event_type_slug: z.string().trim().min(1).max(120),
  start_at: z.string().datetime({ offset: true }),
  booker_name: z.string().trim().min(1).max(100),
  booker_email: z.string().trim().email(),
  booker_phone: z.string().trim().max(30).optional(),
  booker_timezone: z.string().trim().min(1).max(100).default('UTC'),
  notes: z.string().trim().max(2000).optional(),
  location_kind: z.string().trim().max(50).optional(),
})

type ServiceClient = ReturnType<typeof createServiceRoleClient>

async function resolveEventType(
  supabase: ServiceClient,
  orgId: string,
  profileSlug: string,
  eventTypeSlug: string,
) {
  const { data: profile } = await supabase
    .from('calendar_profiles')
    .select('user_id, timezone, org_id')
    .eq('org_id', orgId)
    .eq('slug', profileSlug)
    .maybeSingle()

  if (!profile) return null

  const { data: eventType } = await supabase
    .from('event_types')
    .select('id, title, description, duration_minutes, color, location_type, location_value, allowed_location_kinds')
    .eq('org_id', orgId)
    .eq('user_id', profile.user_id)
    .eq('slug', eventTypeSlug)
    .eq('active', true)
    .maybeSingle()

  if (!eventType) return null

  const { data: availability } = await supabase
    .from('user_availability')
    .select('day_of_week')
    .eq('user_id', profile.user_id)

  return {
    profile,
    eventType,
    availableDows: [...new Set((availability ?? []).map((row) => row.day_of_week))].sort(),
  }
}

/**
 * Server-to-server booking bridge for trusted products in the same lead
 * funnel. The API key never reaches the browser. The existing leads:write
 * scope is intentional: a booking is the continuation of the lead handoff,
 * and deployed Skale Club keys already carry that scope.
 */
export async function GET(request: Request): Promise<Response> {
  const supabase = createServiceRoleClient()
  const auth = await verifyApiKey(request, supabase, 'leads:write')
  if (!auth.ok) {
    return Response.json({ error: auth.error, code: auth.code }, { status: auth.status })
  }

  const url = new URL(request.url)
  const parsed = querySchema.safeParse(Object.fromEntries(url.searchParams))
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid query', code: 'invalid_query', details: parsed.error.errors },
      { status: 422 },
    )
  }

  const resolved = await resolveEventType(
    supabase,
    auth.key.orgId,
    parsed.data.profile_slug,
    parsed.data.event_type_slug,
  )
  if (!resolved) {
    return Response.json({ error: 'Booking calendar not found', code: 'calendar_not_found' }, { status: 404 })
  }

  let slots = undefined
  if (parsed.data.date) {
    const result = await getAvailableSlots({
      eventTypeId: resolved.eventType.id,
      date: parsed.data.date,
      bookerTimezone: resolved.profile.timezone,
    })
    if (!result.ok) {
      return Response.json({ error: 'Availability could not be loaded', code: result.error }, { status: 502 })
    }
    slots = result.data
  }

  void supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', auth.key.keyId)

  return Response.json({
    event: {
      title: resolved.eventType.title,
      description: resolved.eventType.description,
      durationMinutes: resolved.eventType.duration_minutes,
      color: resolved.eventType.color,
      locationType: resolved.eventType.location_type,
      locationValue: resolved.eventType.location_value,
      allowedLocationKinds: resolved.eventType.allowed_location_kinds ?? [],
      timezone: resolved.profile.timezone,
      availableDows: resolved.availableDows,
    },
    ...(slots ? { slots } : {}),
  })
}

export async function POST(request: Request): Promise<Response> {
  const supabase = createServiceRoleClient()
  const auth = await verifyApiKey(request, supabase, 'leads:write')
  if (!auth.ok) {
    return Response.json({ error: auth.error, code: auth.code }, { status: auth.status })
  }

  let parsed: z.SafeParseReturnType<unknown, z.infer<typeof bookingSchema>>
  try {
    parsed = bookingSchema.safeParse(await request.json())
  } catch {
    return Response.json({ error: 'Invalid request body', code: 'invalid_payload' }, { status: 422 })
  }
  if (!parsed.success) {
    return Response.json(
      { error: 'Invalid request body', code: 'invalid_payload', details: parsed.error.errors },
      { status: 422 },
    )
  }

  const resolved = await resolveEventType(
    supabase,
    auth.key.orgId,
    parsed.data.profile_slug,
    parsed.data.event_type_slug,
  )
  if (!resolved) {
    return Response.json({ error: 'Booking calendar not found', code: 'calendar_not_found' }, { status: 404 })
  }

  const result = await createBooking({
    event_type_id: resolved.eventType.id,
    start_at: parsed.data.start_at,
    booker_name: parsed.data.booker_name,
    booker_email: parsed.data.booker_email,
    booker_phone: parsed.data.booker_phone,
    booker_timezone: parsed.data.booker_timezone,
    notes: parsed.data.notes,
    location_kind: parsed.data.location_kind,
  })

  if (!result.ok) {
    const status = result.error === 'slot_taken'
      ? 409
      : result.error === 'rate_limited'
        ? 429
        : 422
    return Response.json({ error: 'Booking could not be created', code: result.error }, { status })
  }

  void supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', auth.key.keyId)
  return Response.json({ id: result.data.id, status: 'confirmed' }, { status: 201 })
}

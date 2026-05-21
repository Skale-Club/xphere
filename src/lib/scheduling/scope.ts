// SEED-027 Phase E: builds the {{meeting.*}} variable scope that calendar-
// triggered workflows consume. Joins booking + contact + organizer + event
// type + resolved location (SEED-028 D) into a single namespace.

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import {
  resolveMeetingLocation,
  type LocationKind,
} from '@/lib/scheduling/location-resolver'

export interface MeetingScope {
  id: string
  org_id: string
  title: string
  starts_at: string
  ends_at: string
  duration_minutes: number
  status: string
  notes: string | null
  organizer: {
    user_id: string | null
    name: string | null
    email: string | null
  }
  attendee_contact: {
    id: string | null
    name: string
    email: string
    phone: string | null
  }
  event_type: {
    id: string | null
    name: string | null
    slug: string | null
  }
  location: {
    kind: string
    label: string
    address: string | null
    coordinates: { lat: number; lng: number } | null
    phone: string | null
  }
  link: string
  rescheduled_from?: string
  rescheduled_to?: string
}

export async function buildMeetingScope(
  supabase: SupabaseClient<Database>,
  bookingId: string,
  extras?: { rescheduled_from?: string; rescheduled_to?: string },
): Promise<MeetingScope | null> {
  const { data: booking, error } = await supabase
    .from('bookings')
    .select(
      `
      id, org_id, booker_name, booker_email, booker_phone, start_at, end_at,
      status, notes, linked_contact_id,
      location_kind, location_data, meeting_url, meeting_phone, event_type_id
      `,
    )
    .eq('id', bookingId)
    .single()

  if (error || !booking) return null

  // Optional joins (event_type, store, contact). Each is best-effort |
  // missing rows just leave the corresponding fields null.
  const [eventTypeRes, contactRes] = await Promise.all([
    booking.event_type_id
      ? supabase
          .from('event_types')
          .select('id, name, slug, location_type, location_value')
          .eq('id', booking.event_type_id)
          .single()
      : Promise.resolve({ data: null }),
    booking.linked_contact_id
      ? supabase
          .from('contacts')
          .select('id, name, email, phone')
          .eq('id', booking.linked_contact_id)
          .single()
      : Promise.resolve({ data: null }),
  ])

  const eventType = (eventTypeRes as { data: { id?: string; name?: string; slug?: string; location_type?: string; location_value?: string } | null }).data
  const contact = (contactRes as { data: { id?: string; name?: string | null; email?: string | null; phone?: string | null } | null }).data

  // Hydrate the store location only when the booking explicitly uses it.
  let store: Awaited<ReturnType<typeof loadStore>> = null
  if (booking.location_kind === 'store_location') {
    const storeId = (booking.location_data as Record<string, unknown>)?.store_id
    if (typeof storeId === 'string') {
      store = await loadStore(supabase, storeId)
    }
  }

  const startMs = new Date(booking.start_at as string).getTime()
  const endMs = new Date(booking.end_at as string).getTime()
  const durationMinutes = Math.max(0, Math.round((endMs - startMs) / 60000))

  const resolved = resolveMeetingLocation({
    kind: (booking.location_kind ?? eventType?.location_type ?? null) as LocationKind | null,
    meeting_url: booking.meeting_url,
    meeting_phone: booking.meeting_phone,
    location_data: booking.location_data as Record<string, unknown>,
    store,
    contact: contact
      ? { name: contact.name ?? '', phone: contact.phone ?? null, address: null }
      : null,
    legacy_location_type: eventType?.location_type ?? null,
    legacy_location_value: eventType?.location_value ?? null,
  })

  return {
    id: booking.id as string,
    org_id: booking.org_id as string,
    title: eventType?.name ?? 'Meeting',
    starts_at: booking.start_at as string,
    ends_at: booking.end_at as string,
    duration_minutes: durationMinutes,
    status: booking.status as string,
    notes: (booking.notes as string | null) ?? null,
    organizer: {
      user_id: null,
      name: null,
      email: null,
    },
    attendee_contact: contact
      ? {
          id: contact.id ?? null,
          name: contact.name ?? booking.booker_name as string,
          email: contact.email ?? (booking.booker_email as string),
          phone: contact.phone ?? (booking.booker_phone as string | null),
        }
      : {
          id: null,
          name: booking.booker_name as string,
          email: booking.booker_email as string,
          phone: booking.booker_phone as string | null,
        },
    event_type: {
      id: eventType?.id ?? null,
      name: eventType?.name ?? null,
      slug: eventType?.slug ?? null,
    },
    location: {
      kind: resolved.kind,
      label: resolved.label,
      address: resolved.address,
      coordinates: resolved.coordinates,
      phone: resolved.phone,
    },
    link: resolved.link,
    ...extras,
  }
}

async function loadStore(supabase: SupabaseClient<Database>, storeId: string) {
  const { data } = await supabase
    .from('tenant_locations')
    .select(
      'name, address_line_1, address_line_2, city, state, postal_code, country, latitude, longitude, phone',
    )
    .eq('id', storeId)
    .single()
  return data as Awaited<ReturnType<typeof supabase.from>>['data'] extends infer T
    ? T
    : null
}

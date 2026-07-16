// SEED-028 Phase D: pure resolver that turns a booking row + its location
// kind into the structured `ResolvedMeetingLocation` used by:
//   - the booking confirmation page
//   - ICS exports
//   - the workflow scope ({{meeting.location}} and {{meeting.link}})
//   - email templates
//
// No I/O: every input is already on the booking row or in a small lookup
// table. Caller is responsible for hydrating the tenant_locations row if
// the booking uses store_location.

export type LocationKind =
  | 'google_meet'
  | 'zoom'
  | 'whereby'
  | 'store_location'
  | 'client_address'
  | 'custom_address'
  | 'phone_call'
  | 'custom_phone'
  | 'custom_link'
  | 'video'        // legacy alias
  | 'phone'        // legacy alias
  | 'in_person'    // legacy alias

// SYNC-04: the subset of LocationKind values that are fully wired
// end-to-end and safe to expose in the event-type admin form. Excludes
// zoom/whereby (no backend integration) and store_location (larger lift
// than this phase's effort budget — see 130-RESEARCH.md Open Question 2).
export const REACHABLE_LOCATION_KINDS = [
  'google_meet',
  'client_address',
  'custom_address',
  'phone_call',
  'custom_phone',
  'custom_link',
] as const

export const REACHABLE_LOCATION_KIND_LABELS: Record<(typeof REACHABLE_LOCATION_KINDS)[number], string> = {
  google_meet: 'Google Meet',
  client_address: "Client's address (on file)",
  custom_address: 'Custom address (booker provides)',
  phone_call: 'Phone call',
  custom_phone: 'Phone call (custom number)',
  custom_link: 'Custom video link',
}

export interface ResolvedMeetingLocation {
  kind: LocationKind
  label: string                                       // "Google Meet", "Downtown Branch", "John's address"
  address: string | null                              // formatted street address when applicable
  coordinates: { lat: number; lng: number } | null
  phone: string | null
  link: string                                        // tel:, https://maps.., https://meet.., etc.
  raw: Record<string, unknown>                        // kind-specific extras
}

// Inputs the resolver needs. Anything missing falls back gracefully.
export interface BookingLocationInput {
  kind: LocationKind | null
  // Persisted booking fields:
  meeting_url?: string | null
  meeting_phone?: string | null
  location_data?: Record<string, unknown>
  // Hydrated dependencies:
  store?: {
    name: string
    address_line_1: string
    address_line_2: string | null
    city: string
    state: string | null
    postal_code: string | null
    country: string
    latitude: number | null
    longitude: number | null
    phone: string | null
  } | null
  contact?: {
    name?: string | null
    phone?: string | null
    address?: string | null
  } | null
  // Legacy fallback (event_types.location_type + location_value).
  legacy_location_type?: string | null
  legacy_location_value?: string | null
}

function formatAddress(p: {
  address_line_1?: string
  address_line_2?: string | null
  city?: string
  state?: string | null
  postal_code?: string | null
  country?: string
}): string {
  return [p.address_line_1, p.address_line_2, p.city, p.state, p.postal_code, p.country]
    .filter(Boolean)
    .join(', ')
}

function mapsLink(p: { lat?: number | null; lng?: number | null; addressString?: string }): string {
  if (p.lat != null && p.lng != null) {
    return `https://www.google.com/maps?q=${p.lat},${p.lng}`
  }
  if (p.addressString) {
    return `https://www.google.com/maps?q=${encodeURIComponent(p.addressString)}`
  }
  return ''
}

function telLink(phone: string): string {
  // Strip everything except + and digits so tel: works on all platforms.
  const cleaned = phone.replace(/[^+\d]/g, '')
  return `tel:${cleaned}`
}

export function resolveMeetingLocation(input: BookingLocationInput): ResolvedMeetingLocation {
  const kind = (input.kind ?? 'custom_link') as LocationKind

  switch (kind) {
    case 'google_meet':
    case 'zoom':
    case 'whereby': {
      const url = input.meeting_url ?? ''
      return {
        kind,
        label:
          kind === 'google_meet' ? 'Google Meet' : kind === 'zoom' ? 'Zoom' : 'Whereby',
        address: null,
        coordinates: null,
        phone: null,
        link: url,
        raw: { ...input.location_data },
      }
    }

    case 'store_location': {
      if (!input.store) {
        return {
          kind,
          label: 'Store location',
          address: null,
          coordinates: null,
          phone: null,
          link: '',
          raw: { ...input.location_data },
        }
      }
      const address = formatAddress(input.store)
      return {
        kind,
        label: input.store.name,
        address,
        coordinates:
          input.store.latitude != null && input.store.longitude != null
            ? { lat: input.store.latitude, lng: input.store.longitude }
            : null,
        phone: input.store.phone,
        link: mapsLink({
          lat: input.store.latitude,
          lng: input.store.longitude,
          addressString: address,
        }),
        raw: { store_id: input.location_data?.store_id ?? null },
      }
    }

    case 'client_address': {
      const address =
        (input.location_data?.address as string | undefined) ??
        input.contact?.address ??
        ''
      return {
        kind,
        label: input.contact?.name ? `${input.contact.name}'s address` : 'Customer address',
        address: address || null,
        coordinates: null,
        phone: input.contact?.phone ?? null,
        link: mapsLink({ addressString: address }),
        raw: { ...input.location_data },
      }
    }

    case 'custom_address': {
      const address = (input.location_data?.address as string | undefined) ?? ''
      return {
        kind,
        label: 'Address',
        address: address || null,
        coordinates: null,
        phone: null,
        link: mapsLink({ addressString: address }),
        raw: { ...input.location_data },
      }
    }

    case 'phone_call': {
      const phone = input.meeting_phone ?? input.contact?.phone ?? ''
      return {
        kind,
        label: 'Phone call',
        address: null,
        coordinates: null,
        phone: phone || null,
        link: phone ? telLink(phone) : '',
        raw: { ...input.location_data },
      }
    }

    case 'custom_phone': {
      const phone = input.meeting_phone ?? ''
      return {
        kind,
        label: 'Phone call',
        address: null,
        coordinates: null,
        phone: phone || null,
        link: phone ? telLink(phone) : '',
        raw: { ...input.location_data },
      }
    }

    case 'custom_link': {
      const url = input.meeting_url ?? (input.location_data?.url as string | undefined) ?? ''
      return {
        kind,
        label: 'Online meeting',
        address: null,
        coordinates: null,
        phone: null,
        link: url,
        raw: { ...input.location_data },
      }
    }

    // ─── Legacy kinds (best-effort projection from old event_types fields) ──
    case 'video': {
      const url = input.meeting_url ?? input.legacy_location_value ?? ''
      return {
        kind: 'custom_link',
        label: 'Online meeting',
        address: null,
        coordinates: null,
        phone: null,
        link: url,
        raw: { legacy: true },
      }
    }
    case 'phone': {
      const phone = input.meeting_phone ?? input.legacy_location_value ?? ''
      return {
        kind: 'custom_phone',
        label: 'Phone call',
        address: null,
        coordinates: null,
        phone: phone || null,
        link: phone ? telLink(phone) : '',
        raw: { legacy: true },
      }
    }
    case 'in_person': {
      const address = input.legacy_location_value ?? ''
      return {
        kind: 'custom_address',
        label: 'Address',
        address: address || null,
        coordinates: null,
        phone: null,
        link: mapsLink({ addressString: address }),
        raw: { legacy: true },
      }
    }
  }
}

// Convenience: render only the link (consumed by {{meeting.link}}).
export function meetingLink(input: BookingLocationInput): string {
  return resolveMeetingLocation(input).link
}

// Convenience: render a short human-readable string for ICS LOCATION field
// and email templates.
export function meetingLocationLabel(input: BookingLocationInput): string {
  const resolved = resolveMeetingLocation(input)
  if (resolved.address) return resolved.address
  if (resolved.phone) return resolved.phone
  if (resolved.link) return resolved.link
  return resolved.label
}

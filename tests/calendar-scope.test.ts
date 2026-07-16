// tests/calendar-scope.test.ts
// Phase 127 Plan 02 — first-ever unit coverage for
// src/lib/calendar/scope.ts::buildMeetingScope.
//
// Strategy: mock resolveMeetingLocation (the only external, non-Supabase
// dependency) so these tests isolate buildMeetingScope's own logic — the
// event_types.title column fix and the new organizer resolution — and feed
// buildMeetingScope a fake Supabase client via a chainable thenable proxy,
// modeled after buildFakeAdmin in tests/calendar-bookings.test.ts and
// buildFakeSupabase in tests/booking-validation.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/calendar/location-resolver', () => ({
  resolveMeetingLocation: vi.fn().mockReturnValue({
    kind: 'video',
    label: 'Video call',
    address: null,
    coordinates: null,
    phone: null,
    link: 'https://meet.example.com',
  }),
}))

import { resolveMeetingLocation } from '@/lib/calendar/location-resolver'
import { buildMeetingScope } from '@/lib/calendar/scope'

// ─── Test-data fixtures ─────────────────────────────────────────────────────

const BOOKING_ID = '00000000-0000-0000-0000-000000000444'
const ORG_ID = '00000000-0000-0000-0000-000000000111'
const EVENT_TYPE_ID = '00000000-0000-0000-0000-000000000222'
const CONTACT_ID = '00000000-0000-0000-0000-000000000555'
const HOST_USER_ID = '00000000-0000-0000-0000-000000000333'

const bookingRow = {
  id: BOOKING_ID,
  org_id: ORG_ID,
  booker_name: 'Test Booker',
  booker_email: 'booker@example.com',
  booker_phone: '+15555550100',
  booker_timezone: 'America/New_York',
  start_at: '2099-06-15T14:00:00.000Z',
  end_at: '2099-06-15T14:30:00.000Z',
  status: 'confirmed',
  notes: 'Looking forward to it',
  linked_contact_id: CONTACT_ID,
  location_kind: 'video',
  location_data: {},
  meeting_url: 'https://meet.example.com/abc',
  meeting_phone: null,
  event_type_id: EVENT_TYPE_ID,
}

const eventTypeRow = {
  id: EVENT_TYPE_ID,
  title: 'Discovery Call',
  slug: 'discovery-call',
  location_type: 'video',
  location_value: 'https://meet.example.com/abc',
  user_id: HOST_USER_ID,
}

const contactRow = {
  id: CONTACT_ID,
  name: 'Jane Contact',
  email: 'jane.contact@example.com',
  phone: '+15555550199',
}

interface FakeResp {
  data?: unknown
  error?: { message: string; code?: string } | null
}

function makeProxy(result: FakeResp) {
  const proxy: any = {}
  const chain = ['select', 'eq']
  for (const m of chain) proxy[m] = vi.fn(() => proxy)
  proxy.single = vi.fn(() => Promise.resolve(result))
  return proxy
}

function buildFakeSupabase(opts: {
  booking?: FakeResp
  eventType?: FakeResp
  contact?: FakeResp
  getUserById?: ReturnType<typeof vi.fn>
}) {
  const bookingResp = opts.booking ?? { data: bookingRow, error: null }
  const eventTypeResp = opts.eventType ?? { data: eventTypeRow, error: null }
  const contactResp = opts.contact ?? { data: contactRow, error: null }

  const getUserById =
    opts.getUserById ??
    vi.fn(async () => ({ data: { user: null }, error: null }))

  const client: any = {
    from: vi.fn((table: string) => {
      if (table === 'bookings') return makeProxy(bookingResp)
      if (table === 'event_types') return makeProxy(eventTypeResp)
      if (table === 'contacts') return makeProxy(contactResp)
      return makeProxy({ data: null, error: null })
    }),
    auth: {
      admin: {
        getUserById,
      },
    },
  }
  return client
}

// ─── buildMeetingScope ──────────────────────────────────────────────────────

describe('buildMeetingScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveMeetingLocation).mockReturnValue({
      kind: 'video',
      label: 'Video call',
      address: null,
      coordinates: null,
      phone: null,
      link: 'https://meet.example.com',
    } as any)
  })

  it('Test 1: a resolvable event type populates title and event_type.name from the real title column (not the fallback)', async () => {
    const client = buildFakeSupabase({})
    const scope = await buildMeetingScope(client, BOOKING_ID)
    expect(scope).not.toBeNull()
    expect(scope?.title).toBe('Discovery Call')
    expect(scope?.event_type).toEqual({
      id: EVENT_TYPE_ID,
      name: 'Discovery Call',
      slug: 'discovery-call',
    })
  })

  it('Test 2: an unresolvable event type falls back to title "Meeting" and a null event_type object', async () => {
    const client = buildFakeSupabase({
      eventType: { data: null, error: { message: 'not found' } },
    })
    const scope = await buildMeetingScope(client, BOOKING_ID)
    expect(scope).not.toBeNull()
    expect(scope?.title).toBe('Meeting')
    expect(scope?.event_type).toEqual({ id: null, name: null, slug: null })
  })

  it('Test 3: a resolvable host user with a full_name populates organizer fully', async () => {
    const getUserById = vi.fn(async () => ({
      data: {
        user: {
          id: HOST_USER_ID,
          email: 'jane@example.com',
          user_metadata: { full_name: 'Jane Host' },
        },
      },
      error: null,
    }))
    const client = buildFakeSupabase({ getUserById })
    const scope = await buildMeetingScope(client, BOOKING_ID)
    expect(getUserById).toHaveBeenCalledWith(HOST_USER_ID)
    expect(scope?.organizer).toEqual({
      user_id: HOST_USER_ID,
      name: 'Jane Host',
      email: 'jane@example.com',
    })
  })

  it('Test 4: a host user with no full_name/name metadata still populates organizer.email, but organizer.name stays null (no placeholder string)', async () => {
    const getUserById = vi.fn(async () => ({
      data: {
        user: {
          id: HOST_USER_ID,
          email: 'jane@example.com',
          user_metadata: {},
        },
      },
      error: null,
    }))
    const client = buildFakeSupabase({ getUserById })
    const scope = await buildMeetingScope(client, BOOKING_ID)
    expect(scope?.organizer).toEqual({
      user_id: HOST_USER_ID,
      name: null,
      email: 'jane@example.com',
    })
  })

  it('Test 5: an event type with no user_id leaves organizer fully null (never throws)', async () => {
    const getUserById = vi.fn(async () => ({ data: { user: null }, error: null }))
    const client = buildFakeSupabase({
      eventType: { data: { ...eventTypeRow, user_id: undefined }, error: null },
      getUserById,
    })
    const scope = await buildMeetingScope(client, BOOKING_ID)
    expect(getUserById).not.toHaveBeenCalled()
    expect(scope?.organizer).toEqual({ user_id: null, name: null, email: null })
  })

  it('Test 6: getUserById throwing leaves organizer fully null (graceful degrade, never throws)', async () => {
    const getUserById = vi.fn(async () => {
      throw new Error('network error')
    })
    const client = buildFakeSupabase({ getUserById })
    const scope = await buildMeetingScope(client, BOOKING_ID)
    expect(scope).not.toBeNull()
    expect(scope?.organizer).toEqual({ user_id: null, name: null, email: null })
  })

  it('Test 7: getUserById resolving { data: { user: null } } leaves organizer fully null', async () => {
    const getUserById = vi.fn(async () => ({ data: { user: null }, error: null }))
    const client = buildFakeSupabase({ getUserById })
    const scope = await buildMeetingScope(client, BOOKING_ID)
    expect(scope?.organizer).toEqual({ user_id: null, name: null, email: null })
  })

  it('Test 8: regression — attendee_contact, location, timestamps, timezone, google_calendar_url, duration_minutes, status, notes, link, and rescheduled extras all populate as before', async () => {
    const client = buildFakeSupabase({})
    const scope = await buildMeetingScope(client, BOOKING_ID, {
      rescheduled_from: '2099-06-14T14:00:00.000Z',
      rescheduled_to: '2099-06-15T14:00:00.000Z',
    })
    expect(scope).not.toBeNull()
    if (!scope) return

    // attendee_contact
    expect(scope.attendee_contact).toEqual({
      id: CONTACT_ID,
      name: 'Jane Contact',
      first_name: 'Jane',
      email: 'jane.contact@example.com',
      phone: '+15555550199',
    })

    // location (sourced from the mocked resolveMeetingLocation)
    expect(scope.location).toEqual({
      kind: 'video',
      label: 'Video call',
      address: null,
      coordinates: null,
      phone: null,
    })
    expect(scope.link).toBe('https://meet.example.com')

    // timestamps
    expect(scope.starts_at).toBe(bookingRow.start_at)
    expect(scope.ends_at).toBe(bookingRow.end_at)
    expect(scope.starts_at_minus_24h).toBe(
      new Date(new Date(bookingRow.start_at).getTime() - 24 * 60 * 60 * 1000).toISOString(),
    )
    expect(scope.starts_at_minus_1h).toBe(
      new Date(new Date(bookingRow.start_at).getTime() - 60 * 60 * 1000).toISOString(),
    )
    expect(scope.ends_at_plus_2h).toBe(
      new Date(new Date(bookingRow.end_at).getTime() + 2 * 60 * 60 * 1000).toISOString(),
    )
    expect(scope.starts_date).toBe('June 15, 2099')
    expect(scope.starts_time).toBe('10:00 AM')
    expect(scope.timezone).toBe('America/New_York')

    // google_calendar_url — encodes the fixed title
    expect(scope.google_calendar_url).toContain('text=Discovery%20Call')
    expect(scope.google_calendar_url).toContain('20990615T140000Z')

    // duration + status + notes
    expect(scope.duration_minutes).toBe(30)
    expect(scope.status).toBe('confirmed')
    expect(scope.notes).toBe('Looking forward to it')

    // rescheduled extras
    expect(scope.rescheduled_from).toBe('2099-06-14T14:00:00.000Z')
    expect(scope.rescheduled_to).toBe('2099-06-15T14:00:00.000Z')
  })

  it('Test 9: a missing booking returns null', async () => {
    const client = buildFakeSupabase({
      booking: { data: null, error: { message: 'not found' } },
    })
    const scope = await buildMeetingScope(client, BOOKING_ID)
    expect(scope).toBeNull()
  })
})

// ─── Phase 130 Plan 02 (SYNC-03): verify-and-extend ────────────────────────
// Phase 127-02 already shipped the event_types.title column fix and the
// organizer-hydration logic exercised by every test above. This block adds
// the one regression gap 127-02's own suite didn't assert directly: that the
// event_types select statement itself never re-introduces the nonexistent
// `name` column (the exact bug this fix corrects), and confirms the same
// resolvable event type simultaneously carries a real user_id for the
// organizer lookup.
describe('buildMeetingScope — event_types select regression guard (SYNC-03)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(resolveMeetingLocation).mockReturnValue({
      kind: 'video',
      label: 'Video call',
      address: null,
      coordinates: null,
      phone: null,
      link: 'https://meet.example.com',
    } as any)
  })

  it('selects event_types.title (never the nonexistent name column) and includes user_id for organizer resolution', async () => {
    let capturedSelectArg: string | undefined
    const client: any = {
      from: vi.fn((table: string) => {
        if (table === 'bookings') return makeProxy({ data: bookingRow, error: null })
        if (table === 'event_types') {
          const proxy: any = {}
          proxy.select = vi.fn((arg: string) => {
            capturedSelectArg = arg
            return proxy
          })
          proxy.eq = vi.fn(() => proxy)
          proxy.single = vi.fn(() => Promise.resolve({ data: eventTypeRow, error: null }))
          return proxy
        }
        if (table === 'contacts') return makeProxy({ data: contactRow, error: null })
        return makeProxy({ data: null, error: null })
      }),
      auth: {
        admin: {
          getUserById: vi.fn(async () => ({ data: { user: null }, error: null })),
        },
      },
    }

    const scope = await buildMeetingScope(client, BOOKING_ID)

    expect(scope).not.toBeNull()
    expect(capturedSelectArg).toBeDefined()
    // Regression guard: the pre-127-02 bug selected a bare `name` column
    // that doesn't exist on event_types (only `title` does), which silently
    // resolved eventType to `{ data: null }` on every call in production.
    expect(capturedSelectArg).not.toMatch(/(^|[\s,])name([\s,]|$)/)
    expect(capturedSelectArg).toContain('title')
    expect(capturedSelectArg).toContain('user_id')
  })

  it('a fully-populated user_metadata (full_name AND email) still sources organizer.email from the top-level user.email, not user_metadata.email', async () => {
    const getUserById = vi.fn(async () => ({
      data: {
        user: {
          id: HOST_USER_ID,
          email: 'top-level@example.com',
          user_metadata: { full_name: 'Jane Host', email: 'metadata@example.com' },
        },
      },
      error: null,
    }))
    const client = buildFakeSupabase({ getUserById })
    const scope = await buildMeetingScope(client, BOOKING_ID)
    expect(scope?.organizer).toEqual({
      user_id: HOST_USER_ID,
      name: 'Jane Host',
      email: 'top-level@example.com',
    })
  })
})

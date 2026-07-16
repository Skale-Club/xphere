// tests/scheduling-bookings.test.ts
// Phase 96 Plan 02 — integration tests for createBooking + cancelBookingByToken.
//
// Strategy: mock all server-side dependencies (Supabase admin/server, Next
// headers, rate limit, Google Calendar, emails) and feed canned responses
// to the action via a thenable proxy modeled after tests/calls-actions.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock declarations are hoisted by Vitest — they run before imports.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({
    get: (key: string) => (key === 'x-forwarded-for' ? '1.2.3.4' : null),
  })),
}))

// Rate limit defaults to "allowed" so the action proceeds. Specific tests
// can override.
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(async () => ({ allowed: true, remaining: 5, resetAt: 0 })),
}))

// Google Calendar + emails — no-op so we don't hit the network or auth.
vi.mock('@/lib/calendar/google-calendar', () => ({
  fetchBusyTimes: vi.fn(async () => []),
  createCalendarEvent: vi.fn(async () => null),
}))

vi.mock('@/lib/calendar/emails', () => ({
  sendBookingConfirmation: vi.fn(async () => {}),
  sendBookingCancellation: vi.fn(async () => {}),
}))

// resolveLiveContactId (called unconditionally on any linked contact) hits
// createClient() from @/lib/supabase/server, which this file mocks as a bare
// vi.fn() with no implementation — without this mock it throws "Cannot read
// properties of undefined (reading 'from')" before createBooking can return.
// Pass-through matches its documented default behavior (no merge → return
// input unchanged).
vi.mock('@/lib/contacts/server', () => ({
  resolveLiveContactId: vi.fn(async (id: string) => id),
}))

// createBooking's active-check/end_at-derivation/availability/conflict logic
// now lives in the shared resolveAndValidateSlot helper (Phase 126 Plan 01) —
// mocked here so these tests exercise createBooking's own orchestration
// (contact linking, insert, 23505 mapping, side effects) independently of
// that helper's own unit coverage in tests/booking-validation.test.ts.
vi.mock('@/lib/calendar/booking-validation', () => ({
  resolveAndValidateSlot: vi.fn(),
}))

// Imports come AFTER mock declarations.
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { resolveAndValidateSlot } from '@/lib/calendar/booking-validation'
import {
  createBooking,
  cancelBookingByToken,
} from '@/app/(dashboard)/calendar/_actions/bookings'

// ─── Test-data fixtures ─────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000111'
const EVENT_TYPE_ID = '00000000-0000-0000-0000-000000000222'
const USER_ID = '00000000-0000-0000-0000-000000000333'
const BOOKING_ID = '00000000-0000-0000-0000-000000000444'
const CANCEL_TOKEN = '00000000-0000-0000-0000-000000000555'

const eventTypeRow = {
  duration_minutes: 30,
  org_id: ORG_ID,
  user_id: USER_ID,
  title: 'Discovery Call',
  location_type: 'video',
  location_value: 'https://meet.example.com/abc',
  slug: 'discovery',
}

const schedulingProfileRow = { timezone: 'UTC', slug: 'jane' }

const validBookingInput = {
  event_type_id: EVENT_TYPE_ID,
  start_at: '2099-06-15T14:00:00.000Z',
  booker_name: 'Test Booker',
  booker_email: 'booker@example.com',
  booker_phone: '+15555550100',
  booker_timezone: 'UTC',
  notes: 'looking forward',
}

// ─── Fake Supabase service-role client ──────────────────────────────────────
//
// Each .from(table) call returns a chainable thenable. We thread per-table,
// per-verb canned results so the action's chained queries land on the right
// canned response.

interface FakeResp {
  data?: unknown
  error?: { message: string; code?: string } | null
}

type TableMap = Record<string, FakeResp | undefined>

function buildFakeAdmin(responses: {
  eventTypes?: FakeResp                     // .select.eq.eq.single
  schedulingProfiles?: FakeResp             // .select.eq.maybeSingle
  bookingsConflict?: FakeResp               // .select(...).maybeSingle for conflict pre-check
  contactsExisting?: FakeResp               // .select.eq.eq.maybeSingle
  customFieldDefs?: FakeResp                // .select(...).eq...
  contactsInsert?: FakeResp                 // .insert.select.single
  bookingsInsert?: FakeResp                 // .insert.select.single — the booking row
  bookingsUpdate?: FakeResp                 // .update(...).eq...select.single — for cancel
  bookingsCancelLookup?: FakeResp           // .select(...).maybeSingle inside cancellation email pipeline
  eventTypeCancelLookup?: FakeResp          // event_types lookup inside cancel email helper
  schedulingProfileCancelLookup?: FakeResp  // scheduling_profiles lookup inside cancel email helper
}) {
  // Routing rule: the action calls multiple queries against the same table
  // ('bookings' for pre-check + insert + update). We disambiguate by which
  // verb (select / insert / update) starts the chain.

  const makeProxy = (result: FakeResp | undefined): any => {
    const resolved: FakeResp = result ?? { data: null, error: null }
    const proxy: any = {}
    const chain = [
      'select', 'order', 'eq', 'lt', 'gt', 'gte', 'lte', 'in', 'or',
      'ilike', 'filter', 'contains', 'range',
    ]
    for (const m of chain) proxy[m] = vi.fn(() => proxy)
    proxy.single = vi.fn(() => Promise.resolve(resolved))
    proxy.maybeSingle = vi.fn(() => Promise.resolve(resolved))
    proxy.then = (resolve: (v: FakeResp) => void) =>
      Promise.resolve(resolved).then(resolve)
    return proxy
  }

  // Track call sequence for tables that have multiple distinct queries
  let bookingsSelectIdx = 0
  let eventTypesIdx = 0
  let schedulingProfilesIdx = 0

  return {
    auth: {
      admin: {
        getUserById: vi.fn(async () => ({
          data: { user: { id: USER_ID, email: 'host@example.com', user_metadata: { full_name: 'Jane Host' } } },
          error: null,
        })),
      },
    },
    from: vi.fn((table: string) => {
      if (table === 'event_types') {
        const which = eventTypesIdx++
        // First call: createBooking event_type lookup. Second call: cancellation email pipeline.
        return makeProxy(which === 0 ? responses.eventTypes : responses.eventTypeCancelLookup)
      }
      if (table === 'scheduling_profiles') {
        const which = schedulingProfilesIdx++
        return makeProxy(which === 0 ? responses.schedulingProfiles : responses.schedulingProfileCancelLookup)
      }
      if (table === 'bookings') {
        // Distinguish by verb. We override select/insert/update at the proxy level.
        const proxy: any = {}
        const chain = [
          'order', 'eq', 'lt', 'gt', 'gte', 'lte', 'in', 'or', 'ilike',
          'filter', 'contains', 'range',
        ]
        for (const m of chain) proxy[m] = vi.fn(() => proxy)
        proxy.single = vi.fn(() => Promise.resolve({ data: null, error: null }))
        proxy.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: null }))
        proxy.then = (r: (v: FakeResp) => void) => Promise.resolve({ data: null, error: null }).then(r)

        proxy.select = vi.fn(() => {
          // Order matters: pre-check first, then post-insert select-on-insert,
          // then cancel-email-pipeline lookup.
          const which = bookingsSelectIdx++
          if (which === 0) {
            // conflict pre-check (.select('id').eq.eq.lt.gt.maybeSingle)
            return makeProxy(responses.bookingsConflict)
          }
          if (which === 1) {
            // cancellation email pipeline lookup (.select(...).eq.maybeSingle)
            return makeProxy(responses.bookingsCancelLookup)
          }
          return makeProxy({ data: null, error: null })
        })

        proxy.insert = vi.fn(() => makeProxy(responses.bookingsInsert))
        proxy.update = vi.fn(() => makeProxy(responses.bookingsUpdate))

        return proxy
      }
      if (table === 'contacts') {
        // Two distinct queries: existing-lookup (select) and insert.
        const proxy: any = {}
        proxy.select = vi.fn(() => makeProxy(responses.contactsExisting))
        proxy.insert = vi.fn(() => makeProxy(responses.contactsInsert))
        return proxy
      }
      if (table === 'custom_field_definitions') {
        return makeProxy(responses.customFieldDefs)
      }
      return makeProxy({ data: null, error: null })
    }),
  }
}

// ─── createBooking ──────────────────────────────────────────────────────────

describe('createBooking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Test 1: success path — valid input + no conflict yields ok:true with id + cancel_token', async () => {
    const fake = buildFakeAdmin({
      contactsExisting: { data: null, error: null }, // no existing contact
      customFieldDefs: { data: [], error: null }, // no required custom fields
      contactsInsert: { data: { id: 'contact-uuid' }, error: null },
      bookingsInsert: {
        data: { id: BOOKING_ID, cancel_token: CANCEL_TOKEN },
        error: null,
      },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(fake as any)
    vi.mocked(resolveAndValidateSlot).mockResolvedValue({
      ok: true,
      data: {
        eventType: eventTypeRow as any,
        startAt: new Date(validBookingInput.start_at),
        endAt: new Date('2099-06-15T14:30:00.000Z'),
        hostTimezone: 'UTC',
      },
    })

    const result = await createBooking(validBookingInput)

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.id).toBe(BOOKING_ID)
      expect(result.data.cancel_token).toBe(CANCEL_TOKEN)
    }
  })

  it('Test 2: resolveAndValidateSlot reports a conflict — returns slot_taken without inserting', async () => {
    const fake = buildFakeAdmin({})
    vi.mocked(createServiceRoleClient).mockReturnValue(fake as any)
    vi.mocked(resolveAndValidateSlot).mockResolvedValue({ ok: false, error: 'slot_taken' })

    const result = await createBooking(validBookingInput)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('slot_taken')
  })

  it('Test 3: race condition via 23505 — insert errors with unique_violation, returns slot_taken', async () => {
    const fake = buildFakeAdmin({
      contactsExisting: { data: null, error: null },
      customFieldDefs: { data: [], error: null },
      contactsInsert: { data: { id: 'contact-uuid' }, error: null },
      bookingsInsert: {
        data: null,
        error: { message: 'duplicate key value violates unique constraint', code: '23505' },
      },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(fake as any)
    vi.mocked(resolveAndValidateSlot).mockResolvedValue({
      ok: true,
      data: {
        eventType: eventTypeRow as any,
        startAt: new Date(validBookingInput.start_at),
        endAt: new Date('2099-06-15T14:30:00.000Z'),
        hostTimezone: 'UTC',
      },
    })

    const result = await createBooking(validBookingInput)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('slot_taken')
  })

  it('Test 3b: resolveAndValidateSlot reports outside_availability — returns outside_availability without inserting', async () => {
    const fake = buildFakeAdmin({})
    vi.mocked(createServiceRoleClient).mockReturnValue(fake as any)
    vi.mocked(resolveAndValidateSlot).mockResolvedValue({ ok: false, error: 'outside_availability' })

    const result = await createBooking(validBookingInput)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('outside_availability')
    // resolveAndValidateSlot is mocked, so createBooking never even reaches
    // a 'bookings' table query (contact linking + insert) on this path.
    expect(fake.from).not.toHaveBeenCalledWith('bookings')
  })
})

// ─── cancelBookingByToken ───────────────────────────────────────────────────

describe('cancelBookingByToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Test 4: success — update returns a row, returns ok:true', async () => {
    const fake = buildFakeAdmin({
      bookingsUpdate: { data: { id: BOOKING_ID }, error: null },
      // For the cancellation email pipeline lookups (fire-and-forget — safe to stub)
      bookingsCancelLookup: {
        data: {
          id: BOOKING_ID,
          booker_name: 'Booker',
          booker_email: 'b@e.com',
          booker_timezone: 'UTC',
          start_at: '2099-06-15T14:00:00.000Z',
          event_type_id: EVENT_TYPE_ID,
        },
        error: null,
      },
      eventTypeCancelLookup: { data: { title: 'Discovery', user_id: USER_ID, slug: 'discovery' }, error: null },
      schedulingProfileCancelLookup: { data: { slug: 'jane' }, error: null },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(fake as any)

    const result = await cancelBookingByToken(BOOKING_ID, CANCEL_TOKEN)

    expect(result.ok).toBe(true)
  })

  it('Test 5: invalid token — update returns error, returns not_found_or_already_cancelled', async () => {
    const fake = buildFakeAdmin({
      bookingsUpdate: { data: null, error: { message: 'no rows' } },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(fake as any)

    const result = await cancelBookingByToken(BOOKING_ID, CANCEL_TOKEN)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_found_or_already_cancelled')
  })

  it('Test 6: already cancelled — update returns null data + no error, returns not_found_or_already_cancelled', async () => {
    const fake = buildFakeAdmin({
      bookingsUpdate: { data: null, error: null },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(fake as any)

    const result = await cancelBookingByToken(BOOKING_ID, CANCEL_TOKEN)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_found_or_already_cancelled')
  })
})

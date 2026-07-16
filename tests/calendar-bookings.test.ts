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

// The canonical lifecycle transition service (Plan 127-01). Both native
// cancellation paths in bookings.ts now delegate to this instead of writing
// bookings.status directly (Plan 127-03) — mocked here so these tests
// exercise bookings.ts's own delegation/mapping logic independently of
// transition.ts's own coverage in tests/calendar/lifecycle.test.ts.
vi.mock('@/lib/calendar/transition', () => ({
  cancelBooking: vi.fn(),
  emitCalendarEvent: vi.fn(async () => ({ dispatched: 0, dispatch_id: null })),
}))

// Imports come AFTER mock declarations.
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { createClient, getUser } from '@/lib/supabase/server'
import { resolveAndValidateSlot } from '@/lib/calendar/booking-validation'
import { cancelBooking as transitionCancelBooking } from '@/lib/calendar/transition'
import {
  createBooking,
  cancelBooking,
  cancelBookingByToken,
} from '@/app/(dashboard)/calendar/_actions/bookings'
import { revalidatePath } from 'next/cache'

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
  bookingsTokenLookup?: FakeResp            // .select(...).eq.eq.eq('status','confirmed').single() — cancelBookingByToken's token-verification SELECT
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
          // Order matters: pre-check/token-verification first, then
          // post-insert select-on-insert, then cancel-email-pipeline lookup.
          const which = bookingsSelectIdx++
          if (which === 0) {
            // Either the createBookingInternal conflict pre-check
            // (.select('id').eq.eq.lt.gt.maybeSingle) or cancelBookingByToken's
            // token-verification SELECT (.select(...).eq.eq.eq.single) —
            // whichever fixture the test supplies wins.
            return makeProxy(responses.bookingsTokenLookup ?? responses.bookingsConflict)
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

  it('Test 12: a Google Calendar event id returned by createCalendarEvent is persisted onto bookings.google_event_id', async () => {
    const { createCalendarEvent } = await import('@/lib/calendar/google-calendar')
    vi.mocked(createCalendarEvent).mockResolvedValueOnce('gcal-evt-123')

    const fake = buildFakeAdmin({
      contactsExisting: { data: null, error: null },
      customFieldDefs: { data: [], error: null },
      contactsInsert: { data: { id: 'contact-uuid' }, error: null },
      bookingsInsert: { data: { id: BOOKING_ID, cancel_token: CANCEL_TOKEN }, error: null },
      bookingsUpdate: { data: { id: BOOKING_ID }, error: null },
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

    // Every .from('bookings') call gets its own fresh proxy in this fake — find
    // the one whose .update() was actually invoked and assert its payload.
    const bookingsCalls = (fake.from as any).mock.results
      .map((r: any, i: number) => ({ table: (fake.from as any).mock.calls[i][0], proxy: r.value }))
      .filter((x: any) => x.table === 'bookings')
    const updatedProxy = bookingsCalls.find((x: any) => x.proxy.update.mock.calls.length > 0)
    expect(updatedProxy).toBeDefined()
    expect(updatedProxy!.proxy.update).toHaveBeenCalledWith({ google_event_id: 'gcal-evt-123' })
  })

  it('Test 13: createCalendarEvent returning null does not attempt a google_event_id update', async () => {
    const fake = buildFakeAdmin({
      contactsExisting: { data: null, error: null },
      customFieldDefs: { data: [], error: null },
      contactsInsert: { data: { id: 'contact-uuid' }, error: null },
      bookingsInsert: { data: { id: BOOKING_ID, cancel_token: CANCEL_TOKEN }, error: null },
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
    // createCalendarEvent resolves null by the file's top-level vi.mock default — no override needed.
    const result = await createBooking(validBookingInput)
    expect(result.ok).toBe(true)
    const bookingsCalls = (fake.from as any).mock.results
      .map((r: any, i: number) => ({ table: (fake.from as any).mock.calls[i][0], proxy: r.value }))
      .filter((x: any) => x.table === 'bookings')
    expect(bookingsCalls.some((x: any) => x.proxy.update.mock.calls.length > 0)).toBe(false)
  })
})

// ─── cancelBookingByToken ───────────────────────────────────────────────────

describe('cancelBookingByToken', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Test 4: success — token-verification SELECT returns a row, delegates to transition.ts::cancelBooking, returns ok:true', async () => {
    const fake = buildFakeAdmin({
      bookingsTokenLookup: { data: { id: BOOKING_ID, org_id: ORG_ID }, error: null },
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
    vi.mocked(transitionCancelBooking).mockResolvedValue({ ok: true })

    const result = await cancelBookingByToken(BOOKING_ID, CANCEL_TOKEN)

    expect(result.ok).toBe(true)
    expect(transitionCancelBooking).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: fake, depth: 0 }),
      BOOKING_ID,
      ORG_ID,
    )
  })

  it('Test 5: invalid token — SELECT returns error, returns not_found_or_already_cancelled without calling transition.ts::cancelBooking', async () => {
    const fake = buildFakeAdmin({
      bookingsTokenLookup: { data: null, error: { message: 'no rows' } },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(fake as any)

    const result = await cancelBookingByToken(BOOKING_ID, CANCEL_TOKEN)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_found_or_already_cancelled')
    expect(transitionCancelBooking).not.toHaveBeenCalled()
  })

  it('Test 6: already cancelled — SELECT returns null data + no error, returns not_found_or_already_cancelled without calling transition.ts::cancelBooking', async () => {
    const fake = buildFakeAdmin({
      bookingsTokenLookup: { data: null, error: null },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(fake as any)

    const result = await cancelBookingByToken(BOOKING_ID, CANCEL_TOKEN)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_found_or_already_cancelled')
    expect(transitionCancelBooking).not.toHaveBeenCalled()
  })

  it('Test 7: token verifies but transition.ts::cancelBooking reports illegal_transition (race) — maps to not_found_or_already_cancelled, no internal error leaked', async () => {
    const fake = buildFakeAdmin({
      bookingsTokenLookup: { data: { id: BOOKING_ID, org_id: ORG_ID }, error: null },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(fake as any)
    vi.mocked(transitionCancelBooking).mockResolvedValue({ ok: false, error: 'illegal_transition' })

    const result = await cancelBookingByToken(BOOKING_ID, CANCEL_TOKEN)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_found_or_already_cancelled')
  })
})

// ─── cancelBooking (dashboard) ──────────────────────────────────────────────

describe('cancelBooking (dashboard)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function mockAuthenticatedOrgContext(orgId: string | null = ORG_ID) {
    vi.mocked(getUser).mockResolvedValue({ id: USER_ID } as any)
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn(async () => ({ data: orgId, error: null })),
    } as any)
  }

  it('Test 8: success — resolves org via get_current_org_id, delegates to transition.ts::cancelBooking, revalidates', async () => {
    mockAuthenticatedOrgContext(ORG_ID)
    const svcFake = buildFakeAdmin({})
    vi.mocked(createServiceRoleClient).mockReturnValue(svcFake as any)
    vi.mocked(transitionCancelBooking).mockResolvedValue({ ok: true })

    const result = await cancelBooking(BOOKING_ID)

    expect(result.ok).toBe(true)
    expect(transitionCancelBooking).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: svcFake, depth: 0 }),
      BOOKING_ID,
      ORG_ID,
    )
    expect(revalidatePath).toHaveBeenCalledWith('/calendar/bookings')
  })

  it('Test 9: illegal_transition (e.g. already no_show) — surfaces the error, does not revalidate', async () => {
    mockAuthenticatedOrgContext(ORG_ID)
    const svcFake = buildFakeAdmin({})
    vi.mocked(createServiceRoleClient).mockReturnValue(svcFake as any)
    vi.mocked(transitionCancelBooking).mockResolvedValue({ ok: false, error: 'illegal_transition' })

    const result = await cancelBooking(BOOKING_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('illegal_transition')
    expect(revalidatePath).not.toHaveBeenCalled()
  })

  it('Test 10: idempotent no-op (already cancelled) — transition.ts returns ok:true, dashboard still returns ok:true, called exactly once', async () => {
    mockAuthenticatedOrgContext(ORG_ID)
    const svcFake = buildFakeAdmin({})
    vi.mocked(createServiceRoleClient).mockReturnValue(svcFake as any)
    vi.mocked(transitionCancelBooking).mockResolvedValue({ ok: true })

    const result = await cancelBooking(BOOKING_ID)

    expect(result.ok).toBe(true)
    expect(transitionCancelBooking).toHaveBeenCalledTimes(1)
    expect(transitionCancelBooking).toHaveBeenCalledWith(expect.anything(), BOOKING_ID, ORG_ID)
  })

  it('Test 11: no authenticated user — returns not_authenticated without calling transition.ts::cancelBooking', async () => {
    vi.mocked(getUser).mockResolvedValue(null as any)

    const result = await cancelBooking(BOOKING_ID)

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBe('not_authenticated')
    expect(transitionCancelBooking).not.toHaveBeenCalled()
  })
})

// tests/xkedule-webhook.test.ts
// Phase 127 Plan 05 — first-ever test coverage for POST /api/xkedule/webhook.
//
// Strategy: mock the service-role Supabase client + emitCalendarEvent + the
// phone/email normalisers, then drive the route's exported POST(request)
// directly with minimal valid webhook payloads, modeled on the chain-proxy
// style in tests/calendar-bookings.test.ts.
//
// Note for future extension (Plan 129-04): this file's describe blocks are
// scoped by concern (mapStatus / calendarEventFor / existing-row update
// branch) so new coverage for existing-row status transitions can be added
// as its own describe block without restructuring what's here.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock declarations are hoisted by Vitest — they run before imports.
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

vi.mock('@/lib/calendar/transition', () => ({
  emitCalendarEvent: vi.fn(async () => ({ dispatched: 0, dispatch_id: null })),
  confirmBooking: vi.fn(async () => ({ ok: true })),
  cancelBooking: vi.fn(async () => ({ ok: true })),
  markNoShow: vi.fn(async () => ({ ok: true })),
  markShowed: vi.fn(async () => ({ ok: true })),
}))

// Pass-through stand-ins — this route's own normalisation correctness is
// covered by the real functions' own tests, not re-tested here.
vi.mock('@/lib/contacts/zod-schemas', () => ({
  normalisePhone: vi.fn((v: string | null | undefined) => v ?? null),
  normaliseEmail: vi.fn((v: string | null | undefined) => v ?? null),
}))

// Imports come AFTER mock declarations.
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { emitCalendarEvent, confirmBooking, cancelBooking, markNoShow, markShowed } from '@/lib/calendar/transition'
import { POST } from '@/app/api/xkedule/webhook/route'

// ─── Test-data fixtures ─────────────────────────────────────────────────────

const ORG_ID = '00000000-0000-0000-0000-000000000111'
const API_KEY_ID = '00000000-0000-0000-0000-000000000222'
const EVENT_TYPE_ID = '00000000-0000-0000-0000-000000000333'
const CONTACT_ID = '00000000-0000-0000-0000-000000000444'
const BOOKING_ID = '00000000-0000-0000-0000-000000000555'
const EXISTING_BOOKING_ID = '00000000-0000-0000-0000-000000000666'

// ─── Fake Supabase service-role client ──────────────────────────────────────
//
// Each .from(table) call returns a chainable thenable, modeled on
// tests/calendar-bookings.test.ts's buildFakeAdmin.

interface FakeResp {
  data?: unknown
  error?: { message: string; code?: string } | null
}

function makeProxy(resolved: FakeResp): any {
  const proxy: any = {}
  const chain = [
    'select', 'eq', 'neq', 'is', 'limit', 'order', 'lt', 'gt', 'gte', 'lte',
    'in', 'or', 'ilike', 'filter', 'contains', 'range',
  ]
  for (const m of chain) proxy[m] = vi.fn(() => proxy)
  proxy.single = vi.fn(() => Promise.resolve(resolved))
  proxy.maybeSingle = vi.fn(() => Promise.resolve(resolved))
  // Terminal thenable for chains that end without .select()/.single()
  // (e.g. `.update(mutable).eq('id', existing.id)` with no follow-on select).
  proxy.then = (resolve: (v: FakeResp) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject)
  return proxy
}

function buildFakeClient(opts: {
  apiKey?: FakeResp
  bookingsExisting?: FakeResp // existing-row idempotency lookup
  eventTypesExisting?: FakeResp
  contactsPhoneLookup?: FakeResp
  bookingsInsert?: FakeResp
  bookingsUpdate?: FakeResp
}) {
  const bookingsInsertMock = vi.fn(() =>
    makeProxy(opts.bookingsInsert ?? { data: { id: BOOKING_ID }, error: null }),
  )
  const bookingsUpdateMock = vi.fn(() =>
    makeProxy(opts.bookingsUpdate ?? { data: null, error: null }),
  )

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'api_keys') {
        return makeProxy(opts.apiKey ?? { data: { id: API_KEY_ID, org_id: ORG_ID }, error: null })
      }
      if (table === 'bookings') {
        const proxy: any = {}
        proxy.select = vi.fn(() => makeProxy(opts.bookingsExisting ?? { data: null, error: null }))
        proxy.insert = bookingsInsertMock
        proxy.update = bookingsUpdateMock
        return proxy
      }
      if (table === 'event_types') {
        const proxy: any = {}
        proxy.select = vi.fn(() =>
          makeProxy(opts.eventTypesExisting ?? { data: { id: EVENT_TYPE_ID }, error: null }),
        )
        proxy.insert = vi.fn(() => makeProxy({ data: { id: EVENT_TYPE_ID }, error: null }))
        return proxy
      }
      if (table === 'org_members') {
        return makeProxy({ data: null, error: null })
      }
      if (table === 'contacts') {
        // Short-circuits on the phone lookup for every test in this file
        // (a valid phone is always present in makePayload's customer block).
        const proxy: any = {}
        proxy.select = vi.fn(() =>
          makeProxy(opts.contactsPhoneLookup ?? { data: { id: CONTACT_ID }, error: null }),
        )
        proxy.insert = vi.fn(() => makeProxy({ data: { id: CONTACT_ID }, error: null }))
        return proxy
      }
      return makeProxy({ data: null, error: null })
    }),
  }

  return { client, bookingsInsertMock, bookingsUpdateMock }
}

function makePayload(overrides: { event?: string; status?: string; bookingId?: number } = {}) {
  return {
    event: overrides.event ?? 'booking.updated',
    occurred_at: '2026-07-15T10:00:00.000Z',
    booking: {
      id: overrides.bookingId ?? 999,
      status: overrides.status ?? 'confirmed',
      bookingDate: '2026-07-20',
      startTime: '10:00',
      endTime: '10:30',
      timeZone: 'America/New_York',
      customer: {
        name: 'Jane Doe',
        phone: '+15555551234',
        email: 'jane@example.com',
      },
    },
  }
}

function makeRequest(payload: unknown) {
  return new Request('http://localhost/api/xkedule/webhook', {
    method: 'POST',
    headers: { authorization: 'Bearer test-token' },
    body: JSON.stringify(payload),
  })
}

// ─── mapStatus ───────────────────────────────────────────────────────────────

describe('POST /api/xkedule/webhook - mapStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("maps Xkedule 'completed' status to native 'showed' (the fix)", async () => {
    const { client, bookingsInsertMock } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ status: 'completed' })))

    expect(bookingsInsertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'showed' }))
  })

  it("maps 'cancelled' status to 'cancelled' (unchanged)", async () => {
    const { client, bookingsInsertMock } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ status: 'cancelled' })))

    expect(bookingsInsertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }))
  })

  it("maps 'no_show' status to 'no_show' (unchanged)", async () => {
    const { client, bookingsInsertMock } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ status: 'no_show' })))

    expect(bookingsInsertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'no_show' }))
  })

  it.each(['pending', 'awaiting_approval', 'confirmed', 'some_unrecognized_value'])(
    "maps unrecognized/active status '%s' to 'confirmed' (unchanged fallback)",
    async (status) => {
      const { client, bookingsInsertMock } = buildFakeClient({})
      vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

      await POST(makeRequest(makePayload({ status })))

      expect(bookingsInsertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }))
    },
  )
})

// ─── calendarEventFor ────────────────────────────────────────────────────────

describe('POST /api/xkedule/webhook - calendarEventFor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("status 'showed' emits meeting.completed regardless of event, taking priority over booking.confirmed (the fix)", async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.confirmed', status: 'completed' })))

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.completed' }),
    )
  })

  it("event 'booking.cancelled' still emits meeting.cancelled (highest priority, unchanged)", async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.cancelled', status: 'confirmed' })))

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.cancelled' }),
    )
  })

  it("status 'cancelled' still emits meeting.cancelled regardless of event (unchanged)", async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'cancelled' })))

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.cancelled' }),
    )
  })

  it("status 'no_show' still emits meeting.no_show (unchanged)", async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'no_show' })))

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.no_show' }),
    )
  })

  it("event 'booking.created' + status 'confirmed' still emits meeting.scheduled (unchanged)", async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.created', status: 'confirmed' })))

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.scheduled' }),
    )
  })

  it("event 'booking.confirmed' + status 'confirmed' still emits meeting.confirmed (unchanged)", async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.confirmed', status: 'confirmed' })))

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.confirmed' }),
    )
  })

  it("any other event + status 'confirmed' still falls back to meeting.rescheduled (unchanged)", async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'confirmed' })))

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.rescheduled' }),
    )
  })
})

// ─── Existing-row update branch (idempotency + error handling) ─────────────

describe('POST /api/xkedule/webhook - existing-row update branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("regression: 'completed' status on an EXISTING mirrored booking routes through markShowed, not a raw status update", async () => {
    const { client, bookingsUpdateMock } = buildFakeClient({
      bookingsExisting: {
        data: { id: EXISTING_BOOKING_ID, external_updated_at: '2020-01-01T00:00:00.000Z' },
        error: null,
      },
      bookingsUpdate: { data: null, error: null },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'completed' })))
    const json = await res.json()

    // The raw update payload no longer carries a status field -- status
    // transitions on existing rows are routed through the lifecycle service.
    const updatePayload = bookingsUpdateMock.mock.calls[0]?.[0]
    expect(updatePayload).not.toHaveProperty('status')
    expect(vi.mocked(markShowed)).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: expect.anything() }),
      EXISTING_BOOKING_ID,
      ORG_ID,
    )
    expect(json.ok).toBe(true)
  })

  it('update succeeds (error: null) → the lifecycle service is dispatched (existing correct-path behavior, must not regress)', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient({
      bookingsExisting: {
        data: { id: EXISTING_BOOKING_ID, external_updated_at: '2020-01-01T00:00:00.000Z' },
        error: null,
      },
      bookingsUpdate: { data: null, error: null },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'cancelled' })))

    expect(bookingsUpdateMock).toHaveBeenCalled()
    expect(vi.mocked(cancelBooking)).toHaveBeenCalled()
  })

  it("update fails (non-null error) → returns { skipped: 'update_failed' } and no lifecycle transition is dispatched (the fix)", async () => {
    const { client, bookingsUpdateMock } = buildFakeClient({
      bookingsExisting: {
        data: { id: EXISTING_BOOKING_ID, external_updated_at: '2020-01-01T00:00:00.000Z' },
        error: null,
      },
      bookingsUpdate: { data: null, error: { message: 'connection reset' } },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'cancelled' })))
    const json = await res.json()

    expect(bookingsUpdateMock).toHaveBeenCalled()
    expect(json).toEqual({ ok: true, skipped: 'update_failed' })
    expect(vi.mocked(emitCalendarEvent)).not.toHaveBeenCalled()
    expect(vi.mocked(confirmBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(cancelBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(markNoShow)).not.toHaveBeenCalled()
    expect(vi.mocked(markShowed)).not.toHaveBeenCalled()
  })
})

// ─── Existing-row status transitions through the lifecycle service ────────
// (Plan 129-04 — SYNC-02/D-02: an existing mirrored booking's status change
// must never be a raw bookings.status write; it is routed through the
// canonical lifecycle service — confirmBooking/cancelBooking/markNoShow/
// markShowed — chosen by the mapped native status.)

describe('POST /api/xkedule/webhook - existing-row status transitions through the lifecycle service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function existingOpts(bookingsUpdate: FakeResp = { data: null, error: null }) {
    return {
      bookingsExisting: {
        data: { id: EXISTING_BOOKING_ID, external_updated_at: '2020-01-01T00:00:00.000Z' },
        error: null,
      },
      bookingsUpdate,
    }
  }

  it('an existing mirrored booking receiving status=completed calls markShowed, not a raw status update', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(existingOpts())
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'completed' })))

    expect(res.status).toBe(200)
    expect(vi.mocked(markShowed)).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: expect.anything() }),
      EXISTING_BOOKING_ID,
      ORG_ID,
    )
    const updatePayload = bookingsUpdateMock.mock.calls[0]?.[0]
    expect(updatePayload).not.toHaveProperty('status')
    expect(vi.mocked(cancelBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(confirmBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(markNoShow)).not.toHaveBeenCalled()
  })

  it('an existing mirrored booking receiving status=cancelled calls cancelBooking only', async () => {
    const { client } = buildFakeClient(existingOpts())
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'cancelled' })))

    expect(vi.mocked(cancelBooking)).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: expect.anything() }),
      EXISTING_BOOKING_ID,
      ORG_ID,
    )
    expect(vi.mocked(confirmBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(markNoShow)).not.toHaveBeenCalled()
    expect(vi.mocked(markShowed)).not.toHaveBeenCalled()
  })

  it('an existing mirrored booking receiving status=no_show calls markNoShow only', async () => {
    const { client } = buildFakeClient(existingOpts())
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'no_show' })))

    expect(vi.mocked(markNoShow)).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: expect.anything() }),
      EXISTING_BOOKING_ID,
      ORG_ID,
    )
    expect(vi.mocked(confirmBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(cancelBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(markShowed)).not.toHaveBeenCalled()
  })

  it('an existing mirrored booking receiving status=pending (mapped to confirmed) calls confirmBooking only', async () => {
    const { client } = buildFakeClient(existingOpts())
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'pending' })))

    expect(vi.mocked(confirmBooking)).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: expect.anything() }),
      EXISTING_BOOKING_ID,
      ORG_ID,
    )
    expect(vi.mocked(cancelBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(markNoShow)).not.toHaveBeenCalled()
    expect(vi.mocked(markShowed)).not.toHaveBeenCalled()
  })
})

// ─── Unknown-status guard ───────────────────────────────────────────────────
// (Plan 129-04 — SYNC-02/D-02: a genuinely unrecognized Xkedule status must
// never be silently coerced to 'confirmed'. It is logged and skipped before
// any DB access beyond the initial auth/parse steps.)

describe('POST /api/xkedule/webhook - unknown-status guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('an unrecognized status is skipped entirely -- no insert, no update, no lifecycle call, still returns 200', async () => {
    const { client, bookingsInsertMock, bookingsUpdateMock } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload({ status: 'some_future_xkedule_status' })))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.skipped).toBe('unknown_status')
    expect(vi.mocked(confirmBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(cancelBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(markNoShow)).not.toHaveBeenCalled()
    expect(vi.mocked(markShowed)).not.toHaveBeenCalled()
    expect(bookingsInsertMock).not.toHaveBeenCalled()
    expect(bookingsUpdateMock).not.toHaveBeenCalled()
    expect(client.from).not.toHaveBeenCalledWith('bookings')
  })

  it.each(['pending', 'awaiting_approval', 'confirmed', 'completed', 'cancelled', 'no_show'])(
    "all 6 documented statuses ('%s') pass the guard and proceed to insert/update",
    async (status) => {
      const { client, bookingsInsertMock } = buildFakeClient({})
      vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

      const res = await POST(makeRequest(makePayload({ status })))
      const body = await res.json()

      expect(body.skipped).not.toBe('unknown_status')
      expect(res.status).toBe(200)
      expect(bookingsInsertMock).toHaveBeenCalled()
    },
  )
})

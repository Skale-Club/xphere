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
}))

// Pass-through stand-ins — this route's own normalisation correctness is
// covered by the real functions' own tests, not re-tested here.
vi.mock('@/lib/contacts/zod-schemas', () => ({
  normalisePhone: vi.fn((v: string | null | undefined) => v ?? null),
  normaliseEmail: vi.fn((v: string | null | undefined) => v ?? null),
}))

// Imports come AFTER mock declarations.
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { emitCalendarEvent } from '@/lib/calendar/transition'
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

  it("regression: 'completed' status on an EXISTING mirrored booking updates status to 'showed' and emits meeting.completed", async () => {
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

    expect(bookingsUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'showed' }))
    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.completed' }),
    )
    expect(json.ok).toBe(true)
  })

  it('update succeeds (error: null) → emitCalendarEvent IS called (existing correct-path behavior, must not regress)', async () => {
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
    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalled()
  })

  it("update fails (non-null error) → returns { skipped: 'update_failed' } and emitCalendarEvent is NEVER called (the fix)", async () => {
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
  })
})

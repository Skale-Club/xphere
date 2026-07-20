// tests/xkedule-webhook.test.ts
// Phase 127 Plan 05 — first-ever test coverage for POST /api/xkedule/webhook.
// Extended for the 2026-07 Xkedule<->Xphere integration audit's Xphere-side
// fixes: MIR-02 (E.164 + legacy reconciliation), MIR-04 (meeting.rescheduled
// + first-seen INSERT fix), MIR-06 (price/currency/staff persistence),
// MIR-07 (pending/awaiting_approval never mirrored), MIR-08 (401 on bad/
// missing bearer token), MIR-10 (terminal-state guard against out-of-order
// revival).
//
// Strategy: mock the service-role Supabase client + emitCalendarEvent + the
// phone/email normalisers, then drive the route's exported POST(request)
// directly with minimal valid webhook payloads, modeled on the chain-proxy
// style in tests/calendar-bookings.test.ts.

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
  rescheduleBooking: vi.fn(async () => ({ ok: true })),
}))

// Pass-through stand-in for email — this route's own normalisation
// correctness for email is covered by that function's own tests, not
// re-tested here. Phone canonicalization (canonicalizeContactPhone) is NOT
// mocked (tests/phone-canonicalize.test.ts covers its pure logic in
// isolation; this file proves the route actually WIRES it in — see the
// MIR-02 describe block) -- but it internally imports normalisePhone from
// THIS module, so the mock below must still provide a real (not stubbed)
// implementation for canonicalizeContactPhone to work correctly here.
vi.mock('@/lib/contacts/zod-schemas', () => ({
  normaliseEmail: vi.fn((v: string | null | undefined) => v ?? null),
  normalisePhone: vi.fn((v: string | null | undefined) => {
    if (!v) return null
    const trimmed = v.trim()
    if (!trimmed) return null
    const plus = trimmed.startsWith('+') ? '+' : ''
    const digits = trimmed.replace(/[^0-9]/g, '')
    return digits ? plus + digits : null
  }),
}))

// Imports come AFTER mock declarations.
import { createServiceRoleClient } from '@/lib/supabase/admin'
import {
  emitCalendarEvent,
  confirmBooking,
  cancelBooking,
  markNoShow,
  markShowed,
  rescheduleBooking,
} from '@/lib/calendar/transition'
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
  // (e.g. `.update(mutable).eq('id', existing.id)` with no follow-on select)
  // AND for MIR-02's `.in(...).order(...).limit(1)` contact lookup, which
  // resolves to a plain array response, not a single object.
  proxy.then = (resolve: (v: FakeResp) => void, reject?: (e: unknown) => void) =>
    Promise.resolve(resolved).then(resolve, reject)
  return proxy
}

function buildFakeClient(opts: {
  apiKey?: FakeResp
  bookingsExisting?: FakeResp // existing-row idempotency lookup
  eventTypesExisting?: FakeResp
  contactsPhoneLookup?: FakeResp // now an ARRAY response (MIR-02 .in().order().limit(1))
  bookingsInsert?: FakeResp
  bookingsUpdate?: FakeResp
}) {
  const bookingsInsertMock = vi.fn(() =>
    makeProxy(opts.bookingsInsert ?? { data: { id: BOOKING_ID }, error: null }),
  )
  const bookingsUpdateMock = vi.fn((_payload: Record<string, unknown>) =>
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
        // MIR-02: the phone lookup is now `.in('phone_e164', candidates)
        // .order(...).limit(1)`, resolving to an ARRAY, not `.maybeSingle()`.
        const proxy: any = {}
        proxy.select = vi.fn(() =>
          makeProxy(opts.contactsPhoneLookup ?? { data: [{ id: CONTACT_ID }], error: null }),
        )
        proxy.insert = vi.fn(() => makeProxy({ data: { id: CONTACT_ID }, error: null }))
        return proxy
      }
      return makeProxy({ data: null, error: null })
    }),
  }

  return { client, bookingsInsertMock, bookingsUpdateMock }
}

function makePayload(overrides: {
  event?: string
  status?: string
  bookingId?: number
  bookingDate?: string
  startTime?: string
  endTime?: string
  phone?: string | null
  totalPrice?: string | number | null
  currency?: string | null
  staff?: { id: number; name: string }
} = {}) {
  return {
    event: overrides.event ?? 'booking.updated',
    occurred_at: '2026-07-15T10:00:00.000Z',
    booking: {
      id: overrides.bookingId ?? 999,
      status: overrides.status ?? 'confirmed',
      bookingDate: overrides.bookingDate ?? '2026-07-20',
      startTime: overrides.startTime ?? '10:00',
      endTime: overrides.endTime ?? '10:30',
      timeZone: 'America/New_York',
      totalPrice: overrides.totalPrice,
      currency: overrides.currency,
      staff: overrides.staff,
      customer: {
        name: 'Jane Doe',
        phone: overrides.phone === undefined ? '+15555551234' : overrides.phone,
        email: 'jane@example.com',
      },
    },
  }
}

function makeRequest(payload: unknown, headers: Record<string, string> = { authorization: 'Bearer test-token' }) {
  return new Request('http://localhost/api/xkedule/webhook', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
  })
}

// The existing-row lookup's start_at/end_at, matching makePayload's default
// bookingDate/startTime/endTime converted to UTC, so tests that don't care
// about MIR-04's reschedule detection don't accidentally trigger it.
const UNCHANGED_START_AT = '2026-07-20T14:00:00.000Z' // 10:00 America/New_York
const UNCHANGED_END_AT = '2026-07-20T14:30:00.000Z' // 10:30 America/New_York

function existingOpts(overrides: {
  status?: string
  start_at?: string
  end_at?: string
  bookingsUpdate?: FakeResp
} = {}) {
  return {
    bookingsExisting: {
      data: {
        id: EXISTING_BOOKING_ID,
        external_updated_at: '2020-01-01T00:00:00.000Z',
        status: overrides.status ?? 'confirmed',
        start_at: overrides.start_at ?? UNCHANGED_START_AT,
        end_at: overrides.end_at ?? UNCHANGED_END_AT,
      },
      error: null,
    },
    bookingsUpdate: overrides.bookingsUpdate ?? { data: null, error: null },
  }
}

// ─── Auth (MIR-08) ──────────────────────────────────────────────────────────

describe('POST /api/xkedule/webhook - auth (MIR-08)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('a missing Authorization header is rejected with 401, before any DB access', async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload(), {}))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ error: 'unauthorized' })
    expect(client.from).not.toHaveBeenCalled()
  })

  it('a non-Bearer Authorization header is rejected with 401', async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload(), { authorization: 'Basic abc123' }))
    expect(res.status).toBe(401)
  })

  it('an empty Bearer token is rejected with 401', async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload(), { authorization: 'Bearer ' }))
    expect(res.status).toBe(401)
  })

  it('a Bearer token that matches no api_keys row (bad/revoked) is rejected with 401 (the fix — was 200 before)', async () => {
    const { client } = buildFakeClient({ apiKey: { data: null, error: null } })
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload()))
    const body = await res.json()

    expect(res.status).toBe(401)
    expect(body).toEqual({ error: 'unauthorized' })
  })

  it('a valid Bearer token proceeds normally (200, ok:true)', async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload()))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
  })
})

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

  it("maps 'confirmed' status to 'confirmed' (unchanged fallback)", async () => {
    const { client, bookingsInsertMock } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ status: 'confirmed' })))

    expect(bookingsInsertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }))
  })

  // 'some_unrecognized_value' is no longer coerced to 'confirmed' -- it is
  // rejected by the unknown-status guard instead. See that describe block.
})

// ─── MIR-07: pending/awaiting_approval never mirrored ──────────────────────

describe('POST /api/xkedule/webhook - MIR-07 unconfirmed statuses are never mirrored', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['pending', 'awaiting_approval'])(
    "status '%s' is skipped entirely -- no insert, no contact write, no bookings table access at all",
    async (status) => {
      const { client, bookingsInsertMock, bookingsUpdateMock } = buildFakeClient({})
      vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

      const res = await POST(makeRequest(makePayload({ status })))
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body).toEqual({ ok: true, skipped: 'not_yet_confirmed' })
      expect(bookingsInsertMock).not.toHaveBeenCalled()
      expect(bookingsUpdateMock).not.toHaveBeenCalled()
      expect(client.from).not.toHaveBeenCalledWith('bookings')
      expect(client.from).not.toHaveBeenCalledWith('contacts')
      expect(vi.mocked(emitCalendarEvent)).not.toHaveBeenCalled()
    },
  )

  it("a booking that starts pending then gets confirmed mirrors on the FIRST decided event, as a fresh insert (meeting.scheduled, not rescheduled)", async () => {
    const { client, bookingsInsertMock } = buildFakeClient({
      bookingsExisting: { data: null, error: null }, // never mirrored while pending
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    // The pending event never created a row (asserted above); the first
    // decided-status event is therefore still an INSERT.
    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'confirmed' })))

    expect(bookingsInsertMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'confirmed' }))
    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.scheduled' }),
    )
  })
})

// ─── MIR-04: first-seen INSERT is never mislabeled as a reschedule ─────────

describe('POST /api/xkedule/webhook - MIR-04 first-seen INSERT calendar event', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("status 'showed' emits meeting.completed regardless of event (unchanged)", async () => {
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

  it("event 'booking.created' + status 'confirmed' emits meeting.scheduled (unchanged)", async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.created', status: 'confirmed' })))

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.scheduled' }),
    )
  })

  it("event 'booking.updated' + status 'confirmed' on a NEVER-SEEN booking emits meeting.scheduled, NOT meeting.rescheduled (the fix — out-of-order booking.updated arriving before booking.created is a fresh insert, never a reschedule of something that never existed)", async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'confirmed' })))

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.scheduled' }),
    )
  })

  it("event 'booking.confirmed' + status 'confirmed' on a NEVER-SEEN booking ALSO emits meeting.scheduled (the fix — first-seen always wins over the event name)", async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.confirmed', status: 'confirmed' })))

    expect(vi.mocked(emitCalendarEvent)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ event: 'meeting.scheduled' }),
    )
  })
})

// ─── MIR-04: reschedule on an existing row ─────────────────────────────────

describe('POST /api/xkedule/webhook - MIR-04 reschedule on an existing confirmed booking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('a booking.updated that changes the date/time of an already-confirmed booking calls rescheduleBooking (the fix)', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(
      existingOpts({ status: 'confirmed', start_at: UNCHANGED_START_AT, end_at: UNCHANGED_END_AT }),
    )
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    // New startTime differs from the existing row's stored start_at (10:00 -> 11:00).
    const res = await POST(
      makeRequest(makePayload({ event: 'booking.updated', status: 'confirmed', startTime: '11:00', endTime: '11:30' })),
    )

    expect(res.status).toBe(200)
    expect(vi.mocked(rescheduleBooking)).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: expect.anything() }),
      EXISTING_BOOKING_ID,
      ORG_ID,
      '2026-07-20T15:00:00.000Z', // 11:00 America/New_York
      '2026-07-20T15:30:00.000Z', // 11:30 America/New_York
    )
    // The raw update should NOT also carry a duplicate status write, and
    // should not fight rescheduleBooking's own start_at/end_at write.
    const updatePayload = bookingsUpdateMock.mock.calls[0]?.[0]
    expect(updatePayload).not.toHaveProperty('status')
    expect(updatePayload).not.toHaveProperty('start_at')
    expect(updatePayload).not.toHaveProperty('end_at')
    // No separate lifecycle transition call -- rescheduleBooking already
    // owns this event; a redundant confirmBooking call would be a silent
    // no-op anyway, but this proves the code path takes the reschedule
    // branch exclusively.
    expect(vi.mocked(confirmBooking)).not.toHaveBeenCalled()
  })

  it('a booking.updated with the SAME date/time does NOT call rescheduleBooking (no spurious reschedule events)', async () => {
    const { client } = buildFakeClient(existingOpts({ status: 'confirmed' }))
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'confirmed' })))

    expect(vi.mocked(rescheduleBooking)).not.toHaveBeenCalled()
  })

  it('a time change alongside a status change (e.g. confirmed -> cancelled) is NOT treated as a reschedule -- the lifecycle dispatch owns it instead', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(existingOpts({ status: 'confirmed' }))
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(
      makeRequest(makePayload({ event: 'booking.updated', status: 'cancelled', startTime: '11:00', endTime: '11:30' })),
    )

    expect(vi.mocked(rescheduleBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(cancelBooking)).toHaveBeenCalled()
    // start_at/end_at ARE part of the raw update in this branch.
    const updatePayload = bookingsUpdateMock.mock.calls[0]?.[0]
    expect(updatePayload).toHaveProperty('start_at')
    expect(updatePayload).toHaveProperty('end_at')
  })
})

// ─── MIR-06: price/currency/staff persistence ──────────────────────────────

describe('POST /api/xkedule/webhook - MIR-06 price/currency/staff persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('an INSERT carries price, currency, and staff id/name from the payload', async () => {
    const { client, bookingsInsertMock } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(
      makeRequest(
        makePayload({ totalPrice: '150.00', currency: 'usd', staff: { id: 7, name: 'Alex Staff' } }),
      ),
    )

    expect(bookingsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        price: 150,
        currency: 'usd',
        external_staff_id: 7,
        external_staff_name: 'Alex Staff',
      }),
    )
  })

  it('an UPDATE also carries price/currency/staff', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(existingOpts({ status: 'confirmed' }))
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(
      makeRequest(
        makePayload({ event: 'booking.updated', totalPrice: 90, currency: 'brl', staff: { id: 3, name: 'Maria' } }),
      ),
    )

    expect(bookingsUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ price: 90, currency: 'brl', external_staff_id: 3, external_staff_name: 'Maria' }),
    )
  })

  it('omits staff (null id/name) when the payload has no staff and no staffMemberId', async () => {
    const { client, bookingsInsertMock } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({})))

    expect(bookingsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ external_staff_id: null, external_staff_name: null, price: null, currency: null }),
    )
  })
})

// ─── MIR-02: phone canonicalization + legacy reconciliation ────────────────

describe('POST /api/xkedule/webhook - MIR-02 phone canonicalization', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('a caller-id-style +1 phone is stored as real E.164 (not the raw string)', async () => {
    const { client, bookingsInsertMock } = buildFakeClient({
      contactsPhoneLookup: { data: [], error: null }, // no existing contact -- forces a create
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ phone: '+1 (508) 205-8044' })))

    expect(bookingsInsertMock).toHaveBeenCalledWith(
      expect.objectContaining({ booker_phone: '+15082058044' }),
    )
  })

  it('the contact lookup uses .in() with multiple candidates (E.164 + bare national digits), not a single .eq()', async () => {
    const { client } = buildFakeClient({})
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ phone: '+15082058044' })))

    const contactsCall = vi.mocked(client.from).mock.results.find(
      (_r, i) => vi.mocked(client.from).mock.calls[i][0] === 'contacts',
    )
    expect(contactsCall).toBeDefined()
    // Read the SAME proxy instance the route code actually called .select()
    // on (calling .select() again here would create a brand new, unrelated
    // chain object and never observe the real .in() call).
    const selectProxy = contactsCall!.value.select.mock.results[0].value
    expect(selectProxy.in).toHaveBeenCalledWith('phone_e164', expect.arrayContaining(['+15082058044', '5082058044']))
  })

  it('a booking with no phone at all still processes (phoneNorm null, no crash)', async () => {
    const { client, bookingsInsertMock } = buildFakeClient({
      contactsPhoneLookup: { data: [], error: null },
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload({ phone: null })))
    expect(res.status).toBe(200)
    expect(bookingsInsertMock).toHaveBeenCalledWith(expect.objectContaining({ booker_phone: null }))
  })
})

// ─── MIR-10: terminal-state guard against out-of-order revival ────────────

describe('POST /api/xkedule/webhook - MIR-10 terminal-state guard', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('an out-of-order booking.updated arriving AFTER a cancel (newer occurred_at, stale pre-cancel data) is dropped entirely -- no field is overwritten', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(existingOpts({ status: 'cancelled' }))
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    // occurred_at (2026-07-15T10:00:00Z, from makePayload) is newer than the
    // fixture's external_updated_at (2020-01-01) -- passes the staleness
    // check -- but the row is already terminal (cancelled) and this event's
    // status ('confirmed', a stale pre-cancel snapshot) doesn't match.
    const res = await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'confirmed' })))
    const body = await res.json()

    expect(body).toEqual({ ok: true, skipped: 'terminal_state' })
    expect(bookingsUpdateMock).not.toHaveBeenCalled()
    expect(vi.mocked(confirmBooking)).not.toHaveBeenCalled()
    expect(vi.mocked(rescheduleBooking)).not.toHaveBeenCalled()
  })

  it('a redelivery of the SAME terminal status (e.g. another cancelled event) is allowed through as an idempotent no-op, not dropped', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(existingOpts({ status: 'cancelled' }))
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload({ event: 'booking.cancelled', status: 'cancelled' })))
    const body = await res.json()

    expect(body).toEqual({ ok: true })
    expect(bookingsUpdateMock).toHaveBeenCalled()
    expect(vi.mocked(cancelBooking)).toHaveBeenCalled()
  })

  it('applies the same guard to a no_show-terminal row', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(existingOpts({ status: 'no_show' }))
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'confirmed' })))
    const body = await res.json()

    expect(body).toEqual({ ok: true, skipped: 'terminal_state' })
    expect(bookingsUpdateMock).not.toHaveBeenCalled()
  })

  it('a non-terminal (confirmed) row is unaffected by the guard -- normal updates still apply', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(existingOpts({ status: 'confirmed' }))
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'completed' })))
    const body = await res.json()

    expect(body).toEqual({ ok: true })
    expect(bookingsUpdateMock).toHaveBeenCalled()
    expect(vi.mocked(markShowed)).toHaveBeenCalled()
  })
})

// ─── Existing-row update branch (idempotency + error handling) ─────────────

describe('POST /api/xkedule/webhook - existing-row update branch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("regression: 'completed' status on an EXISTING mirrored booking routes through markShowed, not a raw status update", async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(existingOpts({ status: 'confirmed' }))
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    const res = await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'completed' })))
    const json = await res.json()

    const updatePayload = bookingsUpdateMock.mock.calls[0]?.[0]
    expect(updatePayload).not.toHaveProperty('status')
    expect(vi.mocked(markShowed)).toHaveBeenCalledWith(
      expect.objectContaining({ supabase: expect.anything() }),
      EXISTING_BOOKING_ID,
      ORG_ID,
    )
    expect(json.ok).toBe(true)
  })

  it('update succeeds (error: null) -> the lifecycle service is dispatched (existing correct-path behavior, must not regress)', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(existingOpts({ status: 'confirmed' }))
    vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

    await POST(makeRequest(makePayload({ event: 'booking.updated', status: 'cancelled' })))

    expect(bookingsUpdateMock).toHaveBeenCalled()
    expect(vi.mocked(cancelBooking)).toHaveBeenCalled()
  })

  it("update fails (non-null error) -> returns { skipped: 'update_failed' } and no lifecycle transition is dispatched (the fix)", async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(
      existingOpts({ status: 'confirmed', bookingsUpdate: { data: null, error: { message: 'connection reset' } } }),
    )
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

  it('an existing mirrored booking receiving status=completed calls markShowed, not a raw status update', async () => {
    const { client, bookingsUpdateMock } = buildFakeClient(existingOpts({ status: 'confirmed' }))
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
    const { client } = buildFakeClient(existingOpts({ status: 'confirmed' }))
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
    const { client } = buildFakeClient(existingOpts({ status: 'confirmed' }))
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

  it.each(['confirmed', 'completed', 'cancelled', 'no_show'])(
    "the 4 decided/mirrorable statuses ('%s') pass the guard and proceed to insert",
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

  it.each(['pending', 'awaiting_approval'])(
    "the 2 unconfirmed statuses ('%s') pass the unknown-status guard but are skipped by MIR-07 instead, with a DIFFERENT skip reason",
    async (status) => {
      const { client, bookingsInsertMock } = buildFakeClient({})
      vi.mocked(createServiceRoleClient).mockReturnValue(client as any)

      const res = await POST(makeRequest(makePayload({ status })))
      const body = await res.json()

      expect(body.skipped).toBe('not_yet_confirmed')
      expect(res.status).toBe(200)
      expect(bookingsInsertMock).not.toHaveBeenCalled()
    },
  )
})

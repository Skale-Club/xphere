// tests/calendar-cancel-page.test.ts
// Phase 126 Plan 05 (CAL-03) — proves the public cancellation page never
// mutates booking state on a bare GET render. Cancellation must only happen
// via the POST form action bound to cancelBookingByToken.

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/app/(dashboard)/calendar/_actions/bookings', () => ({
  cancelBookingByToken: vi.fn(async () => ({ ok: true, data: undefined })),
}))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { cancelBookingByToken } from '@/app/(dashboard)/calendar/_actions/bookings'
import CancelBookingPage from '@/app/book/cancel/[id]/page'

function fakeAdmin(bookingRow: Record<string, unknown> | null, eventTypeRow: Record<string, unknown> | null) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'bookings') {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: bookingRow })) })) })) }
      }
      if (table === 'event_types') {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(async () => ({ data: eventTypeRow })) })) })) }
      }
      throw new Error(`unexpected table: ${table}`)
    }),
  }
}

const PENDING_BOOKING = {
  id: 'b1', booker_name: 'Test', start_at: '2099-01-01T10:00:00.000Z', end_at: '2099-01-01T10:30:00.000Z',
  status: 'confirmed', event_type_id: 'et1', cancel_token: 'tok1',
}
const CANCELLED_BOOKING = { ...PENDING_BOOKING, status: 'cancelled' }
const EVENT_TYPE = { title: 'Discovery' }

describe('CancelBookingPage GET path', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pending booking: GET render never calls cancelBookingByToken', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin(PENDING_BOOKING, EVENT_TYPE) as never)
    await CancelBookingPage({
      params: Promise.resolve({ id: 'b1' }),
      searchParams: Promise.resolve({ token: 'tok1' }),
    })
    expect(cancelBookingByToken).not.toHaveBeenCalled()
  })

  it('already-cancelled booking: GET render never calls cancelBookingByToken', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin(CANCELLED_BOOKING, EVENT_TYPE) as never)
    await CancelBookingPage({
      params: Promise.resolve({ id: 'b1' }),
      searchParams: Promise.resolve({ token: 'tok1' }),
    })
    expect(cancelBookingByToken).not.toHaveBeenCalled()
  })

  it('missing token: notFound() is thrown before any mutation is attempted', async () => {
    vi.mocked(createServiceRoleClient).mockReturnValue(fakeAdmin(PENDING_BOOKING, EVENT_TYPE) as never)
    await expect(
      CancelBookingPage({ params: Promise.resolve({ id: 'b1' }), searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('NEXT_NOT_FOUND')
    expect(cancelBookingByToken).not.toHaveBeenCalled()
  })
})

// AGT-08: coverage for src/lib/xkedule/propagate.ts — native Xphere cancel/
// reschedule actions propagating back to the real Xkedule booking when the
// local row is mirrored from it (bookings.external_source = 'xkedule').

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

vi.mock('@/lib/xkedule/credentials', () => ({
  getXkeduleCredentialsForOrg: vi.fn(),
}))
vi.mock('@/lib/xkedule/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/xkedule/client')>()
  return {
    ...actual,
    xkeduleFetchJson: vi.fn().mockResolvedValue({ id: 1, status: 'cancelled' }),
  }
})

import { getXkeduleCredentialsForOrg } from '@/lib/xkedule/credentials'
import { xkeduleFetchJson } from '@/lib/xkedule/client'
import { propagateCancelToXkedule, propagateRescheduleToXkedule } from '@/lib/xkedule/propagate'

const CREDS = { tenantBaseUrl: 'https://tenant.xkedule.com', apiKey: 'xph_test' }
const ORG_ID = 'org-1'
const BOOKING_ID = 'booking-uuid-1'

function makeSupabase(bookingRow: unknown) {
  const proxy: any = {}
  const chain = ['select', 'eq']
  for (const m of chain) proxy[m] = vi.fn(() => proxy)
  proxy.maybeSingle = vi.fn(() => Promise.resolve({ data: bookingRow, error: null }))
  return { from: vi.fn(() => proxy) } as unknown as SupabaseClient<Database>
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getXkeduleCredentialsForOrg).mockResolvedValue(CREDS)
})

describe('propagateCancelToXkedule', () => {
  it('calls POST /api/v1/bookings/:external_id/cancel when the booking is mirrored from Xkedule', async () => {
    const supabase = makeSupabase({ external_source: 'xkedule', external_id: '42', booker_timezone: 'America/New_York' })

    await propagateCancelToXkedule(supabase, ORG_ID, BOOKING_ID)

    expect(vi.mocked(getXkeduleCredentialsForOrg)).toHaveBeenCalledWith(ORG_ID, supabase)
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledWith('/api/v1/bookings/42/cancel', 'POST', {}, CREDS)
  })

  it('does nothing when the booking is NOT mirrored from Xkedule (native Xphere booking)', async () => {
    const supabase = makeSupabase({ external_source: null, external_id: null, booker_timezone: 'America/New_York' })

    await propagateCancelToXkedule(supabase, ORG_ID, BOOKING_ID)

    expect(vi.mocked(getXkeduleCredentialsForOrg)).not.toHaveBeenCalled()
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })

  it('does nothing when the booking row cannot be found', async () => {
    const supabase = makeSupabase(null)
    await propagateCancelToXkedule(supabase, ORG_ID, BOOKING_ID)
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })

  it('does nothing (no throw) when the org has no Xkedule integration configured', async () => {
    vi.mocked(getXkeduleCredentialsForOrg).mockResolvedValueOnce(null)
    const supabase = makeSupabase({ external_source: 'xkedule', external_id: '42', booker_timezone: 'America/New_York' })

    await expect(propagateCancelToXkedule(supabase, ORG_ID, BOOKING_ID)).resolves.toBeUndefined()
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })

  it('swallows a propagation failure -- never throws (best-effort by design)', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('Xkedule API error 500: boom'))
    const supabase = makeSupabase({ external_source: 'xkedule', external_id: '42', booker_timezone: 'America/New_York' })

    await expect(propagateCancelToXkedule(supabase, ORG_ID, BOOKING_ID)).resolves.toBeUndefined()
  })
})

describe('propagateRescheduleToXkedule', () => {
  it('calls POST /api/v1/bookings/:external_id/reschedule with the tenant-local date/time derived from booker_timezone', async () => {
    const supabase = makeSupabase({ external_source: 'xkedule', external_id: '42', booker_timezone: 'America/New_York' })

    // 2026-08-01T18:30:00Z = 2026-08-01 14:30 America/New_York (EDT, UTC-4)
    await propagateRescheduleToXkedule(supabase, ORG_ID, BOOKING_ID, '2026-08-01T18:30:00.000Z')

    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledWith(
      '/api/v1/bookings/42/reschedule',
      'POST',
      { bookingDate: '2026-08-01', startTime: '14:30' },
      CREDS,
    )
  })

  it('does nothing when the booking is NOT mirrored from Xkedule', async () => {
    const supabase = makeSupabase({ external_source: null, external_id: null, booker_timezone: 'America/New_York' })
    await propagateRescheduleToXkedule(supabase, ORG_ID, BOOKING_ID, '2026-08-01T18:30:00.000Z')
    expect(vi.mocked(xkeduleFetchJson)).not.toHaveBeenCalled()
  })

  it('falls back to America/New_York when booker_timezone is blank', async () => {
    const supabase = makeSupabase({ external_source: 'xkedule', external_id: '42', booker_timezone: '' })
    await propagateRescheduleToXkedule(supabase, ORG_ID, BOOKING_ID, '2026-08-01T18:30:00.000Z')
    expect(vi.mocked(xkeduleFetchJson)).toHaveBeenCalledWith(
      '/api/v1/bookings/42/reschedule',
      'POST',
      { bookingDate: '2026-08-01', startTime: '14:30' },
      CREDS,
    )
  })

  it('swallows a propagation failure -- never throws', async () => {
    vi.mocked(xkeduleFetchJson).mockRejectedValueOnce(new Error('Xkedule API error 409: booking_terminal'))
    const supabase = makeSupabase({ external_source: 'xkedule', external_id: '42', booker_timezone: 'America/New_York' })
    await expect(
      propagateRescheduleToXkedule(supabase, ORG_ID, BOOKING_ID, '2026-08-01T18:30:00.000Z'),
    ).resolves.toBeUndefined()
  })
})

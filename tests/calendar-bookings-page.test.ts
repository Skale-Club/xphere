import { describe, it, expect } from 'vitest'
import { bookingStatusBadgeClass } from '@/lib/calendar/booking-status'

describe('bookingStatusBadgeClass', () => {
  it('returns a distinct class for each of the 4 DB statuses', () => {
    expect(bookingStatusBadgeClass('confirmed')).toContain('emerald')
    expect(bookingStatusBadgeClass('showed')).toContain('sky')
    expect(bookingStatusBadgeClass('no_show')).toContain('amber')
    expect(bookingStatusBadgeClass('cancelled')).toContain('zinc')
  })

  it('falls back to a neutral class for an unrecognized status rather than throwing', () => {
    expect(() => bookingStatusBadgeClass('some_future_status')).not.toThrow()
    expect(bookingStatusBadgeClass('some_future_status')).toContain('zinc')
  })
})

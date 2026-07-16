import { describe, it, expect } from 'vitest'
import { mapContactBookingRow } from '@/lib/contacts/booking-summary'

describe('mapContactBookingRow', () => {
  it('reads the event type name from the title-aliased join (event_types(name:title))', () => {
    const result = mapContactBookingRow({
      id: 'b1', booker_name: 'Jane', start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T10:30:00Z',
      status: 'confirmed', event_types: { name: 'Discovery Call' },
    })
    expect(result.event_type_name).toBe('Discovery Call')
  })

  it('handles the array-shaped join result some Supabase client configs return', () => {
    const result = mapContactBookingRow({
      id: 'b2', booker_name: 'Jane', start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T10:30:00Z',
      status: 'confirmed', event_types: [{ name: 'Discovery Call' }],
    })
    expect(result.event_type_name).toBe('Discovery Call')
  })

  it('falls back to null (not a crash) when event_types is null', () => {
    const result = mapContactBookingRow({
      id: 'b3', booker_name: 'Jane', start_at: '2026-01-01T10:00:00Z', end_at: '2026-01-01T10:30:00Z',
      status: 'cancelled', event_types: null,
    })
    expect(result.event_type_name).toBeNull()
  })
})

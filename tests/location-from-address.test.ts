// tests/location-from-address.test.ts
//
// Item 5, 2026-09-30: unit coverage for deriveLocationFromAddress/
// withDerivedLocation (src/lib/prospects/location-from-address.ts) — fills
// custom_fields.city (what the prospect_rows view reads; no dedicated
// column) from custom_fields.address/location when a caller sent a full
// address but no structured city, instead of leaving it permanently NULL.

import { describe, expect, it } from 'vitest'
import { deriveLocationFromAddress, withDerivedLocation } from '@/lib/prospects/location-from-address'

describe('deriveLocationFromAddress', () => {
  it('parses "Street, City, ST ZIP" — the measured shape (…Tremont St, Boston, MA 02116)', () => {
    expect(deriveLocationFromAddress('100 Tremont St, Boston, MA 02116')).toEqual({ city: 'Boston', state: 'MA' })
  })

  it('parses "Street, City, ST" without a ZIP', () => {
    expect(deriveLocationFromAddress('100 Tremont St, Boston, MA')).toEqual({ city: 'Boston', state: 'MA' })
  })

  it('parses a bare "City, ST" with no street', () => {
    expect(deriveLocationFromAddress('Boston, MA 02116')).toEqual({ city: 'Boston', state: 'MA' })
  })

  it('handles extra segments (suite/unit) before city/state', () => {
    expect(deriveLocationFromAddress('100 Tremont St, Suite 200, Boston, MA 02116')).toEqual({ city: 'Boston', state: 'MA' })
  })

  it('falls back to the last segment as a best-effort city when no state suffix is recognized', () => {
    expect(deriveLocationFromAddress('100 Tremont St, Boston')).toEqual({ city: 'Boston', state: null })
  })

  it('returns nulls for a single segment (nothing to safely split)', () => {
    expect(deriveLocationFromAddress('Boston')).toEqual({ city: null, state: null })
  })

  it('returns nulls for null/undefined/empty input', () => {
    expect(deriveLocationFromAddress(null)).toEqual({ city: null, state: null })
    expect(deriveLocationFromAddress(undefined)).toEqual({ city: null, state: null })
    expect(deriveLocationFromAddress('')).toEqual({ city: null, state: null })
  })
})

describe('withDerivedLocation', () => {
  it('fills city (and state) from custom_fields.address when city is absent', () => {
    const result = withDerivedLocation({ address: '100 Tremont St, Boston, MA 02116' })
    expect(result).toMatchObject({ city: 'Boston', state: 'MA' })
  })

  it('falls back to custom_fields.location when address is absent', () => {
    const result = withDerivedLocation({ location: '100 Tremont St, Boston, MA 02116' })
    expect(result).toMatchObject({ city: 'Boston', state: 'MA' })
  })

  it('never overwrites an existing non-empty city, even with a different address on file', () => {
    const result = withDerivedLocation({ city: 'Cambridge', address: '100 Tremont St, Boston, MA 02116' })
    expect(result.city).toBe('Cambridge')
  })

  it('never overwrites an existing state, only fills it when absent', () => {
    const result = withDerivedLocation({ address: '100 Tremont St, Boston, MA 02116', state: 'NY' })
    expect(result).toMatchObject({ city: 'Boston', state: 'NY' })
  })

  it('returns custom_fields unchanged when there is no address/location to derive from', () => {
    const input = { phone: '+15551234567' }
    expect(withDerivedLocation(input)).toBe(input)
  })

  it('returns an empty object unchanged when custom_fields is null/undefined', () => {
    expect(withDerivedLocation(null)).toEqual({})
    expect(withDerivedLocation(undefined)).toEqual({})
  })
})

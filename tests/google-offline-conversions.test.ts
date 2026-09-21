// tests/google-offline-conversions.test.ts
// Phase E4 (.planning/clients/o-bigode-portugues/PHASE-E-SPEC.md): the pure,
// network-free pieces of the offline click-conversion upload —
// resolveClickId, formatConversionDateTime, buildUploadClickConversionsPayload,
// and customerIdFromConversionActionResourceName. The DB/network
// orchestration (uploadBookingConversionIfEligible) is intentionally not
// covered here — see its own doc comment for why it must never throw.

import { describe, it, expect } from 'vitest'
import {
  resolveClickId,
  formatConversionDateTime,
  buildUploadClickConversionsPayload,
  customerIdFromConversionActionResourceName,
} from '@/lib/ads/google-offline-conversions'

describe('resolveClickId', () => {
  it('prefers gclid when multiple click ids are present', () => {
    expect(resolveClickId({ gclid: 'g1', gbraid: 'gb1', wbraid: 'wb1' })).toEqual({ field: 'gclid', value: 'g1' })
  })

  it('falls back to gbraid, then wbraid', () => {
    expect(resolveClickId({ gclid: null, gbraid: 'gb1', wbraid: 'wb1' })).toEqual({ field: 'gbraid', value: 'gb1' })
    expect(resolveClickId({ gclid: null, gbraid: null, wbraid: 'wb1' })).toEqual({ field: 'wbraid', value: 'wb1' })
  })

  it('returns null when no click id is present, or attribution itself is absent', () => {
    expect(resolveClickId({ gclid: null, gbraid: null, wbraid: null })).toBeNull()
    expect(resolveClickId({})).toBeNull()
    expect(resolveClickId(null)).toBeNull()
    expect(resolveClickId(undefined)).toBeNull()
  })
})

describe('formatConversionDateTime', () => {
  it('formats as "yyyy-mm-dd hh:mm:ss+hh:mm" in UTC by default', () => {
    const date = new Date('2026-09-20T14:05:09.000Z')
    expect(formatConversionDateTime(date)).toBe('2026-09-20 14:05:09+00:00')
  })

  it('applies a positive UTC offset', () => {
    const date = new Date('2026-09-20T00:30:00.000Z')
    // +02:00 -> 02:30 local, same calendar day
    expect(formatConversionDateTime(date, 120)).toBe('2026-09-20 02:30:00+02:00')
  })

  it('applies a negative UTC offset that crosses a day boundary', () => {
    const date = new Date('2026-09-20T01:00:00.000Z')
    // -05:00 -> the previous day, 20:00 local
    expect(formatConversionDateTime(date, -300)).toBe('2026-09-19 20:00:00-05:00')
  })
})

describe('customerIdFromConversionActionResourceName', () => {
  it('extracts the numeric customer id', () => {
    expect(customerIdFromConversionActionResourceName('customers/1234567890/conversionActions/987654321')).toBe(
      '1234567890',
    )
  })

  it('returns null for a malformed resource name', () => {
    expect(customerIdFromConversionActionResourceName('not-a-resource-name')).toBeNull()
    expect(customerIdFromConversionActionResourceName('customers/abc/conversionActions/123')).toBeNull()
    expect(customerIdFromConversionActionResourceName('')).toBeNull()
  })
})

describe('buildUploadClickConversionsPayload', () => {
  const base = {
    conversionActionResourceName: 'customers/1234567890/conversionActions/987654321',
    conversionDateTime: new Date('2026-09-20T14:05:09.000Z'),
    conversionValue: 49.9,
    currencyCode: 'EUR',
    orderId: 'booking-abc-123',
  }

  it('builds a single-conversion, partialFailure=true payload keyed by gclid', () => {
    const payload = buildUploadClickConversionsPayload({ ...base, gclid: 'gc1' })
    expect(payload).toEqual({
      partialFailure: true,
      conversions: [
        {
          conversionAction: base.conversionActionResourceName,
          conversionDateTime: '2026-09-20 14:05:09+00:00',
          currencyCode: 'EUR',
          orderId: 'booking-abc-123',
          conversionValue: 49.9,
          gclid: 'gc1',
        },
      ],
    })
  })

  it('keys by gbraid/wbraid when that is the only click id available', () => {
    const gbraidPayload = buildUploadClickConversionsPayload({ ...base, gbraid: 'gb1' })
    expect(gbraidPayload.conversions[0]).toMatchObject({ gbraid: 'gb1' })
    expect(gbraidPayload.conversions[0]).not.toHaveProperty('gclid')

    const wbraidPayload = buildUploadClickConversionsPayload({ ...base, wbraid: 'wb1' })
    expect(wbraidPayload.conversions[0]).toMatchObject({ wbraid: 'wb1' })
  })

  it('omits conversionValue when null (e.g. price unknown)', () => {
    const payload = buildUploadClickConversionsPayload({ ...base, gclid: 'gc1', conversionValue: null })
    expect(payload.conversions[0]).not.toHaveProperty('conversionValue')
  })

  it('throws when no click id is present — callers must check resolveClickId first', () => {
    expect(() => buildUploadClickConversionsPayload({ ...base })).toThrow(/no click id/)
  })
})

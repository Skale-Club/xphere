// tests/google-offline-conversions.test.ts
// Phase E4 (.planning/clients/o-bigode-portugues/PHASE-E-SPEC.md): the pure,
// network-free pieces of the offline click-conversion upload —
// resolveClickId, formatConversionDateTime, buildUploadClickConversionsPayload,
// and customerIdFromConversionActionResourceName. The DB/network
// orchestration (uploadBookingConversionIfEligible) is intentionally not
// covered here — see its own doc comment for why it must never throw.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Only the early-return paths of the orchestration functions are exercised
// below; these mocks let us assert they never reach the DB.
vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/logger', () => ({ log: vi.fn(async () => {}) }))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { log } from '@/lib/logger'
import {
  uploadBookingConversionIfEligible,
  retractBookingConversionIfEligible,
  attributionIndicatesWebsiteOrigin,
  classifyAdjustmentFailure,
  resolveClickId,
  formatConversionDateTime,
  buildUploadClickConversionsPayload,
  customerIdFromConversionActionResourceName,
  mapConsentStatus,
  resolveConversionCurrency,
  buildConversionAdjustmentsPayload,
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

describe('mapConsentStatus', () => {
  it('maps granted/denied and treats everything else as UNSPECIFIED', () => {
    expect(mapConsentStatus('granted')).toBe('GRANTED')
    expect(mapConsentStatus('denied')).toBe('DENIED')
    expect(mapConsentStatus(null)).toBe('UNSPECIFIED')
    expect(mapConsentStatus(undefined)).toBe('UNSPECIFIED')
  })
})

describe('buildUploadClickConversionsPayload consent', () => {
  const base = {
    conversionActionResourceName: 'customers/1234567890/conversionActions/987654321',
    conversionDateTime: new Date('2026-09-20T14:05:09.000Z'),
    conversionValue: null,
    currencyCode: 'EUR',
    orderId: 'booking-abc-123',
    gclid: 'gc1',
  }

  it('sends the visitor consent signals on the conversion', () => {
    const payload = buildUploadClickConversionsPayload({
      ...base,
      consentAdUserData: 'granted',
      consentAdPersonalization: 'denied',
    })
    expect(payload.conversions[0].consent).toEqual({ adUserData: 'GRANTED', adPersonalization: 'DENIED' })
  })

  it('omits the consent object entirely when both signals are unknown', () => {
    expect(buildUploadClickConversionsPayload({ ...base }).conversions[0]).not.toHaveProperty('consent')
    expect(
      buildUploadClickConversionsPayload({ ...base, consentAdUserData: null, consentAdPersonalization: undefined })
        .conversions[0],
    ).not.toHaveProperty('consent')
  })

  it('maps each signal independently and defaults unknowns to UNSPECIFIED', () => {
    const payload = buildUploadClickConversionsPayload({
      ...base,
      consentAdUserData: 'granted',
      consentAdPersonalization: null,
    })
    expect(payload.conversions[0].consent).toEqual({ adUserData: 'GRANTED', adPersonalization: 'UNSPECIFIED' })
  })
})

describe('resolveConversionCurrency', () => {
  it('prefers the booking currency, then the org default, then USD', () => {
    expect(resolveConversionCurrency('EUR', 'USD')).toBe('EUR')
    expect(resolveConversionCurrency(null, 'EUR')).toBe('EUR')
    expect(resolveConversionCurrency(undefined, 'eur')).toBe('EUR')
    expect(resolveConversionCurrency('  ', 'EUR')).toBe('EUR')
    expect(resolveConversionCurrency(null, null)).toBe('USD')
    expect(resolveConversionCurrency(null, undefined)).toBe('USD')
  })
})

describe('buildConversionAdjustmentsPayload', () => {
  it('builds a single RETRACTION keyed by the Xkedule booking id', () => {
    const payload = buildConversionAdjustmentsPayload({
      conversionActionResourceName: 'customers/7385502411/conversionActions/7784727960',
      orderId: '4242',
      adjustmentDateTime: new Date('2026-09-20T14:05:09.000Z'),
    })
    expect(payload).toEqual({
      partialFailure: true,
      conversionAdjustments: [
        {
          conversionAction: 'customers/7385502411/conversionActions/7784727960',
          adjustmentType: 'RETRACTION',
          adjustmentDateTime: '2026-09-20 14:05:09+00:00',
          orderId: '4242',
        },
      ],
    })
  })
})

describe('attributionIndicatesWebsiteOrigin', () => {
  it('is true when any website-capture field has a value', () => {
    expect(attributionIndicatesWebsiteOrigin({ gclid: 'gc1' })).toBe(true)
    expect(attributionIndicatesWebsiteOrigin({ landing_page: 'https://o-bigode.pt/' })).toBe(true)
    expect(attributionIndicatesWebsiteOrigin({ captured_at: '2026-09-20T10:00:00.000Z', gclid: null })).toBe(true)
  })

  it('is false for absent/empty bundles and for consent flags alone', () => {
    expect(attributionIndicatesWebsiteOrigin(null)).toBe(false)
    expect(attributionIndicatesWebsiteOrigin(undefined)).toBe(false)
    expect(attributionIndicatesWebsiteOrigin({})).toBe(false)
    expect(attributionIndicatesWebsiteOrigin({ gclid: null, utm_source: '  ' })).toBe(false)
    expect(attributionIndicatesWebsiteOrigin({ consent_ad_user_data: 'granted' })).toBe(false)
    expect(attributionIndicatesWebsiteOrigin('x')).toBe(false)
  })
})

describe('classifyAdjustmentFailure', () => {
  const failure = (...codes: string[]) => ({
    message: 'Partial failure',
    details: [
      {
        '@type': 'type.googleapis.com/google.ads.googleads.v25.errors.GoogleAdsFailure',
        errors: codes.map((c) => ({ errorCode: { conversionAdjustmentUploadError: c }, message: c })),
      },
    ],
  })

  it('is none when there is no partial failure', () => {
    expect(classifyAdjustmentFailure(undefined)).toBe('none')
  })

  it('is benign for not-found / already-retracted / expired', () => {
    expect(classifyAdjustmentFailure(failure('CONVERSION_NOT_FOUND'))).toBe('benign')
    expect(classifyAdjustmentFailure(failure('CONVERSION_ALREADY_RETRACTED'))).toBe('benign')
    expect(classifyAdjustmentFailure(failure('CONVERSION_EXPIRED', 'CONVERSION_NOT_FOUND'))).toBe('benign')
  })

  it('is error when any failure is something else', () => {
    expect(classifyAdjustmentFailure(failure('CONVERSION_NOT_FOUND', 'INVALID_CONVERSION_ACTION'))).toBe('error')
    expect(classifyAdjustmentFailure(failure('INVALID_CONVERSION_ACTION'))).toBe('error')
    expect(classifyAdjustmentFailure({ message: 'boom' })).toBe('error')
  })

  it('falls back to the serialized text when details are not structured', () => {
    expect(classifyAdjustmentFailure({ message: 'CONVERSION_NOT_FOUND: no such order' })).toBe('benign')
  })
})

describe('uploadBookingConversionIfEligible consent gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const params = (attribution: Record<string, unknown>) => ({
    orgId: 'org-1',
    bookingId: 'b-1',
    bookingEndAt: '2026-09-20T14:00:00.000Z',
    totalPrice: 30,
    currency: 'EUR',
    attribution: attribution as any,
  })

  it("skips (log skipped / consent_denied / info) when consent_ad_user_data is 'denied', without touching the DB", async () => {
    await uploadBookingConversionIfEligible(params({ gclid: 'gc1', consent_ad_user_data: 'denied' }))

    expect(vi.mocked(createServiceRoleClient)).not.toHaveBeenCalled()
    expect(vi.mocked(log)).toHaveBeenCalledWith(
      expect.objectContaining({
        event_type: 'ads.google_offline_conversion',
        status: 'skipped',
        severity: 'info',
        payload: expect.objectContaining({ reason: 'consent_denied' }),
      }),
    )
  })

  it("proceeds past the gate when consent is 'granted' or unknown (reaches the DB)", async () => {
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new Error('reached-db') // swallowed by the function's own try/catch
    })
    await uploadBookingConversionIfEligible(params({ gclid: 'gc1', consent_ad_user_data: 'granted' }))
    await uploadBookingConversionIfEligible(params({ gclid: 'gc1', consent_ad_user_data: null }))
    await uploadBookingConversionIfEligible(params({ gclid: 'gc1' }))

    expect(vi.mocked(createServiceRoleClient)).toHaveBeenCalledTimes(3)
    expect(vi.mocked(log)).not.toHaveBeenCalledWith(
      expect.objectContaining({ payload: expect.objectContaining({ reason: 'consent_denied' }) }),
    )
  })
})

describe('retractBookingConversionIfEligible website-origin gate', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const base = { orgId: 'org-1', bookingId: 'b-1', externalBookingId: '4242', cancelledAt: new Date() }

  it('does nothing (no DB, no log) when neither the stored row nor the payload carries attribution', async () => {
    await retractBookingConversionIfEligible({ ...base, storedAttribution: null, incomingAttribution: null })
    await retractBookingConversionIfEligible({ ...base, storedAttribution: {}, incomingAttribution: undefined })

    expect(vi.mocked(createServiceRoleClient)).not.toHaveBeenCalled()
    expect(vi.mocked(log)).not.toHaveBeenCalled()
  })

  it('proceeds when only the stored row has attribution', async () => {
    vi.mocked(createServiceRoleClient).mockImplementation(() => {
      throw new Error('reached-db')
    })
    await retractBookingConversionIfEligible({ ...base, storedAttribution: { gclid: 'gc1' }, incomingAttribution: null })
    expect(vi.mocked(createServiceRoleClient)).toHaveBeenCalledTimes(1)
  })
})

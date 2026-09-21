// tests/xkedule-attribution.test.ts
// Phase E3 (.planning/clients/o-bigode-portugues/PHASE-E-SPEC.md): parsing
// the fixed `attribution` contract on Xkedule's booking.* webhooks.
//
// src/lib/xkedule/attribution.ts must tolerate: the whole object being
// absent/null (most bookings), individual fields being absent/null, unknown
// extra keys, and outright malformed input -- none of these may throw or
// propagate an error that would fail the webhook.

import { describe, it, expect } from 'vitest'
import { attributionSchema, parseAttribution, extractAttributionInput } from '@/lib/xkedule/attribution'

describe('attributionSchema / parseAttribution', () => {
  it('accepts a fully-populated attribution object', () => {
    const input = {
      xphere_visitor_id: '11111111-1111-1111-1111-111111111111',
      gclid: 'gc1',
      gbraid: null,
      wbraid: null,
      fbclid: 'fb1',
      utm_source: 'google',
      utm_medium: 'cpc',
      utm_campaign: 'bigode-search',
      utm_term: null,
      utm_content: null,
      landing_page: 'https://o-bigode.pt/?gclid=gc1',
      referrer: 'https://www.google.com/',
      captured_at: '2026-09-20T10:00:00.000Z',
    }
    expect(parseAttribution(input)).toEqual(input)
  })

  it('is absent for a booking with no attribution at all', () => {
    expect(parseAttribution(undefined)).toBeNull()
    expect(parseAttribution(null)).toBeNull()
  })

  it('tolerates every field being absent (empty object)', () => {
    expect(parseAttribution({})).toEqual({})
  })

  it('ignores unknown keys instead of failing', () => {
    const result = parseAttribution({ gclid: 'gc1', some_future_field: 'whatever' })
    expect(result).toEqual({ gclid: 'gc1' })
    expect(result).not.toHaveProperty('some_future_field')
  })

  it('drops (returns null for) malformed input rather than throwing', () => {
    expect(parseAttribution('not-an-object')).toBeNull()
    expect(parseAttribution(42)).toBeNull()
    expect(parseAttribution({ gclid: 12345 })).toBeNull() // wrong type for gclid
  })

  it('does not require gclid to look like a UUID for xphere_visitor_id (deliberately lenient)', () => {
    // A slightly malformed visitor id must not blow up the whole object and
    // lose the gclid along with it -- the webhook's linkVisitorToContact call
    // is itself a safe no-op against a bad/foreign id.
    expect(attributionSchema.safeParse({ xphere_visitor_id: 'not-a-uuid', gclid: 'gc1' }).success).toBe(true)
  })
})

describe('extractAttributionInput', () => {
  it('reads a top-level attribution field (sibling of booking)', () => {
    const body = { event: 'booking.completed', booking: { id: 1 }, attribution: { gclid: 'gc1' } }
    expect(extractAttributionInput(body)).toEqual({ gclid: 'gc1' })
  })

  it('falls back to booking.attribution when there is no top-level field', () => {
    const body = { event: 'booking.completed', booking: { id: 1, attribution: { gclid: 'gc2' } } }
    expect(extractAttributionInput(body)).toEqual({ gclid: 'gc2' })
  })

  it('prefers the top-level field when both are present', () => {
    const body = {
      booking: { id: 1, attribution: { gclid: 'nested' } },
      attribution: { gclid: 'top-level' },
    }
    expect(extractAttributionInput(body)).toEqual({ gclid: 'top-level' })
  })

  it('returns undefined when neither location has it', () => {
    expect(extractAttributionInput({ event: 'booking.confirmed', booking: { id: 1 } })).toBeUndefined()
    expect(extractAttributionInput(null)).toBeUndefined()
    expect(extractAttributionInput('nonsense')).toBeUndefined()
  })
})

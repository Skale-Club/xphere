// MIR-02 (2026-07 Xkedule<->Xphere integration audit): pure coverage for
// src/lib/phone-numbers/normalize.ts's countryForTimeZone/canonicalizeContactPhone.
// No I/O, no Supabase — the webhook/contacts-route wiring that CALLS these is
// covered separately in tests/xkedule-webhook.test.ts.

import { describe, it, expect } from 'vitest'
import { countryForTimeZone, canonicalizeContactPhone } from '@/lib/phone-numbers/normalize'

describe('countryForTimeZone', () => {
  it('resolves a curated zone to its country', () => {
    expect(countryForTimeZone('America/Sao_Paulo')).toBe('BR')
    expect(countryForTimeZone('America/New_York')).toBe('US')
    expect(countryForTimeZone('Europe/Lisbon')).toBe('PT')
    expect(countryForTimeZone('Australia/Sydney')).toBe('AU')
  })

  it('falls back to US for an unmapped or missing zone (same fallback-of-last-resort as Xkedule)', () => {
    expect(countryForTimeZone('Asia/Kolkata')).toBe('US')
    expect(countryForTimeZone(null)).toBe('US')
    expect(countryForTimeZone(undefined)).toBe('US')
    expect(countryForTimeZone('')).toBe('US')
  })
})

describe('canonicalizeContactPhone', () => {
  it('returns null value + empty candidates for missing/blank input', () => {
    expect(canonicalizeContactPhone(null)).toEqual({ value: null, matchCandidates: [] })
    expect(canonicalizeContactPhone(undefined)).toEqual({ value: null, matchCandidates: [] })
    expect(canonicalizeContactPhone('   ')).toEqual({ value: null, matchCandidates: [] })
  })

  it('canonicalizes a caller-id-style +1 number to real E.164 with no hint needed', () => {
    const result = canonicalizeContactPhone('+15082058044')
    expect(result.value).toBe('+15082058044')
    expect(result.matchCandidates).toContain('+15082058044')
    // Bare national digits -- the legacy loose-normalized form a hand-typed
    // "(508) 205-8044" contact would already have as its phone_e164.
    expect(result.matchCandidates).toContain('5082058044')
  })

  it('canonicalizes a bare national number to E.164 given a country hint (US)', () => {
    const result = canonicalizeContactPhone('(508) 205-8044', 'US')
    expect(result.value).toBe('+15082058044')
    expect(result.matchCandidates).toContain('+15082058044')
    expect(result.matchCandidates).toContain('5082058044')
  })

  it('the exact MIR-02 audit scenario: a +1 caller-id number and a hand-typed national number for the SAME real number produce overlapping candidate sets', () => {
    const fromCallerId = canonicalizeContactPhone('+15082058044')
    const fromHandTyped = canonicalizeContactPhone('(508) 205-8044', 'US')
    // Neither write needs the other's context to find the row the other created.
    expect(fromCallerId.matchCandidates).toContain(fromHandTyped.value)
    expect(fromHandTyped.matchCandidates).toContain(fromCallerId.value)
  })

  it('resolves a BR-timezone hint correctly', () => {
    const result = canonicalizeContactPhone('11987654321', 'BR')
    expect(result.value).toBe('+5511987654321')
    expect(result.matchCandidates).toContain('11987654321')
  })

  it('falls back to the loose legacy form when the number cannot be parsed (no hint, no leading +)', () => {
    const result = canonicalizeContactPhone('call me maybe')
    // No digits at all -- loose form is null, so there is nothing to persist or match on.
    expect(result.value).toBeNull()
    expect(result.matchCandidates).toEqual([])
  })

  it('a bare national number with no country hint falls back to the loose digit-strip form (unchanged pre-MIR-02 behavior)', () => {
    const result = canonicalizeContactPhone('5551234567')
    expect(result.value).toBe('5551234567')
    expect(result.matchCandidates).toEqual(['5551234567'])
  })

  it('never throws on a garbage countryHint', () => {
    expect(() => canonicalizeContactPhone('+15082058044', 'not-a-country')).not.toThrow()
    expect(() => canonicalizeContactPhone('+15082058044', '')).not.toThrow()
  })

  it('is idempotent: canonicalizing an already-E.164 value returns the same value', () => {
    const first = canonicalizeContactPhone('+15082058044')
    const second = canonicalizeContactPhone(first.value)
    expect(second.value).toBe(first.value)
  })
})

// tests/contacts-blocked-emails.test.ts
// Phase 110 Plan 02 — CID-16 isBlockedEmail unit tests (D-04, D-04a).
//
// Pure unit tests for the hardcoded BLOCKED_EMAIL_PATTERNS blocklist.
// No Supabase, no DB — just regex behavior.
//
// Behavioral groups:
//   1. All 7 patterns match expected localparts/domains
//   2. Case-insensitive (NOEMAIL@FOO.COM, Test@Test.COM)
//   3. Whitespace-tolerant (trim before match)
//   4. Negative: real emails, substring-only matches do NOT trigger
//   5. Null/undefined/empty returns false (never throws)

import { describe, it, expect } from 'vitest'
import {
  BLOCKED_EMAIL_PATTERNS,
  isBlockedEmail,
} from '@/lib/contacts/blocked-emails'

describe('BLOCKED_EMAIL_PATTERNS', () => {
  it('exports a readonly array of RegExp', () => {
    expect(Array.isArray(BLOCKED_EMAIL_PATTERNS)).toBe(true)
    expect(BLOCKED_EMAIL_PATTERNS.length).toBeGreaterThanOrEqual(7)
    for (const rx of BLOCKED_EMAIL_PATTERNS) {
      expect(rx).toBeInstanceOf(RegExp)
    }
  })
})

describe('isBlockedEmail', () => {
  describe('positive matches (all 7 D-04 patterns)', () => {
    it.each([
      ['noemail@example.com', '^noemail@'],
      ['noemail@foo.com', '^noemail@'],
      ['test@test.com', '^test@test\\.'],
      ['test@test.io', '^test@test\\.'],
      ['none@somewhere.com', '^none@'],
      ['example@anything.com', '^example@'],
      ['placeholder@x.com', '^placeholder@'],
      ['noreply@brand.com', '^noreply@'],
      ['john@example.com', '@example\\.com$'],
      ['jane@example.org', '@example\\.org$'],
    ])('returns true for %s (pattern: %s)', (email) => {
      expect(isBlockedEmail(email)).toBe(true)
    })
  })

  describe('case insensitivity', () => {
    it.each([
      'NOEMAIL@FOO.COM',
      'Test@Test.COM',
      'NONE@somewhere.COM',
      'EXAMPLE@anything.com',
      'Placeholder@X.Com',
      'NoReply@brand.com',
      'john@EXAMPLE.COM',
      'jane@Example.Org',
    ])('returns true for %s', (email) => {
      expect(isBlockedEmail(email)).toBe(true)
    })
  })

  describe('whitespace tolerance', () => {
    it('trims leading whitespace', () => {
      expect(isBlockedEmail('  noemail@foo.com')).toBe(true)
    })

    it('trims trailing whitespace', () => {
      expect(isBlockedEmail('noemail@foo.com  ')).toBe(true)
    })

    it('trims both', () => {
      expect(isBlockedEmail('  noemail@foo.com  ')).toBe(true)
    })

    it('whitespace-only returns false', () => {
      expect(isBlockedEmail('   ')).toBe(false)
    })
  })

  describe('negative cases (real emails / non-anchored substrings)', () => {
    it.each([
      'real.user@gmail.com',
      'jane.doe@company.io',
      'support@brand.com',
      // substring with no `^` boundary must NOT match
      'mynoemail@x.com',
      'noemail.fake@gmail.com',
      // `@example.net` is NOT in the domain blocklist (only .com and .org)
      'john@example.net',
      // localpart `test` alone without `@test.` is fine
      'test@gmail.com',
      // `nonexample@foo.com` — not anchored at start, must not match
      'nonexample@foo.com',
    ])('returns false for %s', (email) => {
      expect(isBlockedEmail(email)).toBe(false)
    })
  })

  describe('null / undefined / empty', () => {
    it('returns false for null', () => {
      expect(isBlockedEmail(null)).toBe(false)
    })

    it('returns false for undefined', () => {
      expect(isBlockedEmail(undefined)).toBe(false)
    })

    it('returns false for empty string', () => {
      expect(isBlockedEmail('')).toBe(false)
    })

    it('never throws on weird input', () => {
      expect(() => isBlockedEmail('')).not.toThrow()
      expect(() => isBlockedEmail(null)).not.toThrow()
      expect(() => isBlockedEmail(undefined)).not.toThrow()
    })
  })
})

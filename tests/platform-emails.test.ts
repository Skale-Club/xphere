import { describe, expect, it } from 'vitest'
import { PLATFORM_EMAIL_DOMAINS, isPlatformEmail } from '@/lib/prospects/platform-emails'

describe('isPlatformEmail', () => {
  it('matches the exact platform domain', () => {
    expect(isPlatformEmail('help.us@booksy.com')).toBe(true)
    expect(isPlatformEmail('safeguarding@vagaro.com')).toBe(true)
    expect(isPlatformEmail('privacy@pocketsuite.io')).toBe(true)
  })

  it('matches every listed domain, including the Xphere-only additions', () => {
    for (const domain of PLATFORM_EMAIL_DOMAINS) expect(isPlatformEmail(`support@${domain}`)).toBe(true)
    expect(PLATFORM_EMAIL_DOMAINS).toEqual(expect.arrayContaining(['getsquire.com', 'mytime.com', 'bookedin.com']))
    expect(PLATFORM_EMAIL_DOMAINS).toHaveLength(18)
  })

  it('matches subdomains of a platform domain', () => {
    expect(isPlatformEmail('noreply@mail.booksy.com')).toBe(true)
    expect(isPlatformEmail('a@b.c.fresha.com')).toBe(true)
  })

  it('does not match lookalike domains or a platform name elsewhere in the address', () => {
    expect(isPlatformEmail('hello@notbooksy.com')).toBe(false)
    expect(isPlatformEmail('hello@booksy.com.evil.example')).toBe(false)
    expect(isPlatformEmail('hello@booksy.co')).toBe(false)
    expect(isPlatformEmail('booksy.com@gmail.com')).toBe(false)
    expect(isPlatformEmail('owner@independentshop.example')).toBe(false)
  })

  it('ignores case and surrounding whitespace', () => {
    expect(isPlatformEmail('  Help.Us@BOOKSY.com  ')).toBe(true)
    expect(isPlatformEmail('\tinfo@Mail.Vagaro.COM\n')).toBe(true)
  })

  it('returns false for null, undefined, empty and malformed input', () => {
    expect(isPlatformEmail(null)).toBe(false)
    expect(isPlatformEmail(undefined)).toBe(false)
    expect(isPlatformEmail('')).toBe(false)
    expect(isPlatformEmail('   ')).toBe(false)
    expect(isPlatformEmail('booksy.com')).toBe(false)
    expect(isPlatformEmail('help.us@')).toBe(false)
    expect(isPlatformEmail('@')).toBe(false)
  })

  it('judges the part after the LAST @', () => {
    expect(isPlatformEmail('weird@name@booksy.com')).toBe(true)
    expect(isPlatformEmail('weird@booksy.com@gmail.com')).toBe(false)
  })
})

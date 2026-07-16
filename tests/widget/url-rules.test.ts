import { describe, it, expect } from 'vitest'

import {
  matchesRule,
  isWidgetAllowed,
  normalizeWidgetUrlMode,
  normalizeWidgetUrlRules,
  resolveRequestLocation,
  isRequestAllowed,
} from '@/lib/widget/url-rules'

describe('matchesRule', () => {
  it('matches a bare domain on any path', () => {
    expect(matchesRule('example.com', 'example.com', '/')).toBe(true)
    expect(matchesRule('example.com', 'example.com', '/anything/here')).toBe(true)
  })

  it('does not match a different host', () => {
    expect(matchesRule('example.com', 'other.com', '/')).toBe(false)
    expect(matchesRule('example.com', 'sub.example.com', '/')).toBe(false)
  })

  it('supports subdomain wildcards', () => {
    expect(matchesRule('*.example.com', 'app.example.com', '/')).toBe(true)
    expect(matchesRule('*.example.com', 'example.com', '/')).toBe(true)
    expect(matchesRule('*.example.com', 'example.org', '/')).toBe(false)
  })

  it('matches an exact path', () => {
    expect(matchesRule('example.com/checkout', 'example.com', '/checkout')).toBe(true)
    expect(matchesRule('example.com/checkout', 'example.com', '/checkout/step-2')).toBe(false)
    expect(matchesRule('example.com/checkout', 'example.com', '/')).toBe(false)
  })

  it('supports path wildcards', () => {
    expect(matchesRule('example.com/app/*', 'example.com', '/app/')).toBe(true)
    expect(matchesRule('example.com/app/*', 'example.com', '/app/settings')).toBe(true)
    expect(matchesRule('example.com/app/*', 'example.com', '/other')).toBe(false)
  })

  it('supports any-host path rules', () => {
    expect(matchesRule('*/pricing', 'a.com', '/pricing')).toBe(true)
    expect(matchesRule('*/pricing', 'b.com', '/pricing')).toBe(true)
    expect(matchesRule('*/pricing', 'a.com', '/other')).toBe(false)
  })

  it('is case-insensitive and tolerates a pasted scheme/query', () => {
    expect(matchesRule('HTTPS://Example.com/Checkout?x=1', 'example.com', '/checkout')).toBe(true)
  })

  it('ignores empty patterns', () => {
    expect(matchesRule('', 'example.com', '/')).toBe(false)
    expect(matchesRule('   ', 'example.com', '/')).toBe(false)
  })
})

describe('isWidgetAllowed', () => {
  const rules = ['example.com/checkout', 'app.example.com']

  it('allows everything in "all" mode', () => {
    expect(isWidgetAllowed('all', [], { hostname: 'anything.com', pathname: '/x' })).toBe(true)
  })

  it('allowlist: only matching URLs run', () => {
    expect(isWidgetAllowed('allowlist', rules, { hostname: 'example.com', pathname: '/checkout' })).toBe(true)
    expect(isWidgetAllowed('allowlist', rules, { hostname: 'example.com', pathname: '/' })).toBe(false)
    expect(isWidgetAllowed('allowlist', rules, { hostname: 'app.example.com', pathname: '/dash' })).toBe(true)
  })

  it('blocklist: everything runs except matching URLs', () => {
    expect(isWidgetAllowed('blocklist', rules, { hostname: 'example.com', pathname: '/checkout' })).toBe(false)
    expect(isWidgetAllowed('blocklist', rules, { hostname: 'example.com', pathname: '/' })).toBe(true)
    expect(isWidgetAllowed('blocklist', rules, { hostname: 'app.example.com', pathname: '/' })).toBe(false)
  })
})

describe('normalizeWidgetUrlMode', () => {
  it('defaults invalid values to "all"', () => {
    expect(normalizeWidgetUrlMode('allowlist')).toBe('allowlist')
    expect(normalizeWidgetUrlMode('blocklist')).toBe('blocklist')
    expect(normalizeWidgetUrlMode('all')).toBe('all')
    expect(normalizeWidgetUrlMode('nonsense')).toBe('all')
    expect(normalizeWidgetUrlMode(undefined)).toBe('all')
  })
})

describe('normalizeWidgetUrlRules', () => {
  it('parses arrays and de-duplicates', () => {
    expect(normalizeWidgetUrlRules(['Example.com', 'example.com', ' app.com '])).toEqual([
      'example.com',
      'app.com',
    ])
  })

  it('parses newline/comma-separated strings', () => {
    expect(normalizeWidgetUrlRules('example.com\n app.com , x.com')).toEqual([
      'example.com',
      'app.com',
      'x.com',
    ])
  })

  it('drops empties and caps the count', () => {
    expect(normalizeWidgetUrlRules('\n\n')).toEqual([])
    const many = Array.from({ length: 60 }, (_, i) => `h${i}.com`).join('\n')
    expect(normalizeWidgetUrlRules(many, 50)).toHaveLength(50)
  })
})

describe('resolveRequestLocation', () => {
  it('takes the host from Origin (unspoofable) and path from the client URL', () => {
    expect(
      resolveRequestLocation('https://shop.com', 'https://shop.com/', 'https://shop.com/checkout'),
    ).toEqual({ hostname: 'shop.com', pathname: '/checkout' })
  })

  it('ignores a client URL whose host does not match the trusted host', () => {
    // Forged client URL claiming a different (authorized) domain must not win.
    expect(
      resolveRequestLocation('https://evil.com', null, 'https://shop.com/checkout'),
    ).toEqual({ hostname: 'evil.com', pathname: '/' })
  })

  it('falls back to Referer when Origin is absent', () => {
    expect(resolveRequestLocation(null, 'https://shop.com/pricing', null)).toEqual({
      hostname: 'shop.com',
      pathname: '/pricing',
    })
  })

  it('returns null when nothing is parseable', () => {
    expect(resolveRequestLocation(null, null, null)).toBeNull()
    expect(resolveRequestLocation('null', null, null)).toBeNull()
  })
})

describe('isRequestAllowed', () => {
  const rules = ['shop.com/checkout']

  it('allows all in "all" mode regardless of headers', () => {
    expect(isRequestAllowed('all', rules, { origin: null, referer: null, clientUrl: null })).toBe(true)
  })

  it('enforces path via the host-verified client URL', () => {
    expect(
      isRequestAllowed('allowlist', rules, {
        origin: 'https://shop.com',
        referer: 'https://shop.com/',
        clientUrl: 'https://shop.com/checkout',
      }),
    ).toBe(true)
    expect(
      isRequestAllowed('allowlist', rules, {
        origin: 'https://shop.com',
        referer: 'https://shop.com/',
        clientUrl: 'https://shop.com/home',
      }),
    ).toBe(false)
  })

  it('fails closed for allowlist and open for blocklist when location is unknown', () => {
    expect(isRequestAllowed('allowlist', rules, { origin: null, referer: null, clientUrl: null })).toBe(false)
    expect(isRequestAllowed('blocklist', rules, { origin: null, referer: null, clientUrl: null })).toBe(true)
  })

  it('blocks a foreign domain reusing the token (blocklist stays open, allowlist closed)', () => {
    // Allowlist: only shop.com is authorized, so evil.com is denied.
    expect(
      isRequestAllowed('allowlist', ['shop.com'], {
        origin: 'https://evil.com',
        referer: null,
        clientUrl: 'https://shop.com/checkout', // forged — host won't match Origin
      }),
    ).toBe(false)
  })
})

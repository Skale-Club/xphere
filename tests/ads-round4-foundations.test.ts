import { describe, expect, it, vi } from 'vitest'

// Round-4 foundations: the handler composition every new capability plugs
// into, the SSRF guard in front of caller-supplied media URLs, and the
// Customer Match hashing that keeps raw contacts out of the change ledger.

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(async (host: string) => {
    const table: Record<string, string[]> = {
      'cdn.example.com': ['93.184.216.34'],
      'internal.example.com': ['10.0.0.5'],
      'mixed.example.com': ['93.184.216.34', '127.0.0.1'],
    }
    return (table[host] ?? []).map((address) => ({ address, family: 4 }))
  }),
}))

import { withHandlers, type CommandHandler } from '@/lib/ads/providers/handlers'
import type { AdsProviderAdapter } from '@/lib/ads/providers/types'
import { isPrivateAddress, safeFetchBytes, SafeFetchError } from '@/lib/ads/safe-fetch'
import { hashContacts, normalizeEmail, sha256Hex } from '@/lib/ads/customer-match'

function fakeBase(): AdsProviderAdapter {
  return {
    platform: 'google',
    capabilities: () => [{ type: 'google.campaign.rename', label: 'Rename campaign', risk: 1 }],
    snapshot: vi.fn(async () => null),
    plan: vi.fn(() => ({ ok: false as const, code: 'base', message: 'base' })),
    validate: vi.fn(async () => {}),
    execute: vi.fn(async () => ({ providerRef: 'base', raw: {} })),
    verify: vi.fn(async () => ({ ok: true, mismatches: [], observed: {} })),
    buildRollback: vi.fn(() => null),
    classifyError: vi.fn(() => ({ code: 'base_error', message: 'x', transient: false, auth: false })),
  }
}

function fakeHandler(types: CommandHandler['types'], platform: 'google' | 'meta' = 'google'): CommandHandler {
  return {
    platform,
    types,
    snapshot: vi.fn(async () => null),
    plan: vi.fn(() => ({ ok: false as const, code: 'handler', message: 'handler' })),
    validate: vi.fn(async () => {}),
    execute: vi.fn(async () => ({ providerRef: 'handler', raw: {} })),
    verify: vi.fn(async () => ({ ok: true, mismatches: [], observed: {} })),
    buildRollback: vi.fn(() => null),
  }
}

describe('withHandlers', () => {
  it('routes a handled command to its handler and everything else to the base adapter', async () => {
    const base = fakeBase()
    const handler = fakeHandler(['google.keyword.remove'])
    const adapter = withHandlers(base, [handler])
    const ctx = { orgId: 'o', adAccountId: '1', credential: 'c' }

    await adapter.snapshot(ctx, { type: 'google.keyword.remove' } as never)
    await adapter.snapshot(ctx, { type: 'google.campaign.rename' } as never)

    expect(handler.snapshot).toHaveBeenCalledTimes(1)
    expect(base.snapshot).toHaveBeenCalledTimes(1)
  })

  it('advertises the union of base and handler capabilities', () => {
    const adapter = withHandlers(fakeBase(), [fakeHandler(['google.keyword.remove'])])
    const types = adapter.capabilities().map((c) => c.type)
    expect(types).toEqual(expect.arrayContaining(['google.campaign.rename', 'google.keyword.remove']))
  })

  it('keeps error classification on the platform adapter', () => {
    const adapter = withHandlers(fakeBase(), [fakeHandler(['google.keyword.remove'])])
    expect(adapter.classifyError(new Error('x')).code).toBe('base_error')
  })

  it('refuses two handlers claiming the same command, at composition time', () => {
    expect(() =>
      withHandlers(fakeBase(), [fakeHandler(['google.keyword.remove']), fakeHandler(['google.keyword.remove'])]),
    ).toThrow(/claimed by two handlers/)
  })

  it('refuses a handler for the wrong platform or a non-catalog command', () => {
    expect(() => withHandlers(fakeBase(), [fakeHandler(['meta.post.boost'], 'meta')])).toThrow(/adapter is google/)
    expect(() => withHandlers(fakeBase(), [fakeHandler(['meta.post.boost'])])).toThrow(/not a google catalog entry/)
  })
})

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', '::ffff:10.0.0.1'])(
    'treats %s as private',
    (ip) => expect(isPrivateAddress(ip)).toBe(true),
  )
  it.each(['93.184.216.34', '8.8.8.8', '2606:4700::1111'])('treats %s as public', (ip) => expect(isPrivateAddress(ip)).toBe(false))
})

describe('safeFetchBytes', () => {
  it('refuses plain http, embedded credentials, private and partly-private hosts before any request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    await expect(safeFetchBytes('http://cdn.example.com/a.png', { maxBytes: 10 })).rejects.toThrow(SafeFetchError)
    await expect(safeFetchBytes('https://u:p@cdn.example.com/a.png', { maxBytes: 10 })).rejects.toThrow(/credentials/)
    await expect(safeFetchBytes('https://internal.example.com/a.png', { maxBytes: 10 })).rejects.toThrow(/non-public/)
    await expect(safeFetchBytes('https://mixed.example.com/a.png', { maxBytes: 10 })).rejects.toThrow(/non-public/)
    await expect(safeFetchBytes('https://169.254.169.254/latest', { maxBytes: 10 })).rejects.toThrow(/non-public/)
    expect(fetchSpy).not.toHaveBeenCalled()
    fetchSpy.mockRestore()
  })

  it('re-checks every redirect hop', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: 'https://internal.example.com/x' } }))
    await expect(safeFetchBytes('https://cdn.example.com/a.png', { maxBytes: 10 })).rejects.toThrow(/non-public/)
    fetchSpy.mockRestore()
  })

  it('enforces content type and size while streaming', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    fetchSpy.mockResolvedValueOnce(new Response('hello', { headers: { 'content-type': 'text/html' } }))
    await expect(safeFetchBytes('https://cdn.example.com/a', { maxBytes: 100, accept: /^image\// })).rejects.toThrow(/content type/)

    fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array(50), { headers: { 'content-type': 'image/png' } }))
    await expect(safeFetchBytes('https://cdn.example.com/a', { maxBytes: 10, accept: /^image\// })).rejects.toThrow(/larger/)

    fetchSpy.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }))
    const ok = await safeFetchBytes('https://cdn.example.com/a', { maxBytes: 10, accept: /^image\// })
    expect(ok.bytes.length).toBe(3)
    expect(ok.contentType).toBe('image/png')
    fetchSpy.mockRestore()
  })
})

describe('Customer Match hashing', () => {
  it('normalises emails before hashing so case and spaces still match', () => {
    expect(normalizeEmail('  Ana@Example.COM ')).toBe('ana@example.com')
    expect(normalizeEmail('not-an-email')).toBeNull()
    const { hashed_emails } = hashContacts({ emails: ['Ana@Example.com', 'ana@example.com '] })
    expect(hashed_emails).toEqual([sha256Hex('ana@example.com')])
  })

  it('hashes only real E.164 phones and counts the rest as rejected', () => {
    const { hashed_phones, rejected } = hashContacts({ phones: ['+351 912 345 678', '12'], defaultCountry: 'PT' })
    expect(hashed_phones).toEqual([sha256Hex('+351912345678')])
    expect(rejected).toBe(1)
  })

  it('returns digests only — nothing that looks like the input', () => {
    const out = hashContacts({ emails: ['ana@example.com'], phones: ['+351912345678'] })
    const all = [...out.hashed_emails, ...out.hashed_phones]
    expect(all.every((h) => /^[a-f0-9]{64}$/.test(h))).toBe(true)
  })
})

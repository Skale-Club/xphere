// MIR-08 (2026-07 Xkedule<->Xphere integration audit, Xphere half): the
// Xkedule "Connection Token" is a Xphere-issued xph_... API key
// (paste-the-same-token-both-ways design) — previously any string was
// accepted ("credencial meio-validada"). Covers:
//   1. The registry's field-level pattern (client-side format check).
//   2. saveIntegrationCredentials's server-side guard (defense in depth).

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Part 1: pure registry pattern check ───────────────────────────────────

import { getDefinitionByProvider } from '@/lib/integrations/registry'

describe('registry.ts - xkedule api_key field pattern (MIR-08)', () => {
  const field = getDefinitionByProvider('xkedule')?.fields?.find((f) => f.key === 'api_key')

  it('the xkedule integration defines a pattern for its api_key field', () => {
    expect(field?.pattern).toBeInstanceOf(RegExp)
    expect(field?.patternError).toContain('xph_')
  })

  it('accepts a realistic xph_ key', () => {
    expect(field!.pattern!.test('xph_test_connection_token_abc123')).toBe(true)
  })

  it('rejects a value with no xph_ prefix', () => {
    expect(field!.pattern!.test('some-random-string')).toBe(false)
  })

  it('rejects a too-short xph_-prefixed value', () => {
    expect(field!.pattern!.test('xph_123')).toBe(false)
  })

  it('rejects the masked-key sentinel', () => {
    expect(field!.pattern!.test('••••••••••••••••')).toBe(false)
  })
})

// ─── Part 2: saveIntegrationCredentials server-side guard ──────────────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import { saveIntegrationCredentials } from '@/app/(dashboard)/integrations/actions'

function makeSupabase(existing: unknown = null) {
  const proxy: any = {}
  for (const m of ['select', 'eq', 'limit', 'insert', 'update']) proxy[m] = vi.fn(() => proxy)
  proxy.maybeSingle = vi.fn(() => Promise.resolve({ data: existing, error: null }))
  proxy.then = (resolve: (v: unknown) => void) => Promise.resolve({ data: null, error: null }).then(resolve)
  return {
    rpc: vi.fn(() => Promise.resolve({ data: 'org-1', error: null })),
    from: vi.fn(() => proxy),
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as any)
})

describe('saveIntegrationCredentials - xkedule format guard (MIR-08)', () => {
  it('rejects a Connection Token that does not start with xph_', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase() as any)

    const res = await saveIntegrationCredentials('xkedule', {
      api_key: 'not-a-real-key',
      location_id: 'https://tenant.xkedule.com',
    })

    expect(res).toEqual({ ok: false, error: 'Connection Token must be a Xphere API key starting with "xph_".' })
  })

  it('accepts a well-formed xph_ token and proceeds to save', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase() as any)

    const res = await saveIntegrationCredentials('xkedule', {
      api_key: 'xph_test_connection_token_abc123',
      location_id: 'https://tenant.xkedule.com',
    })

    expect(res.ok).toBe(true)
  })

  it('does not apply the xph_ guard to other providers', async () => {
    vi.mocked(createClient).mockResolvedValue(makeSupabase() as any)

    const res = await saveIntegrationCredentials('vapi', { api_key: 'anything-goes' })

    expect(res.ok).toBe(true)
  })
})

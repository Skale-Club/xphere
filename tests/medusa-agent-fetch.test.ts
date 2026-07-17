// tests/medusa-agent-fetch.test.ts
// WSL-02: signAgentBody (bare-hex HMAC) + medusaAgentFetch (signed POST to the
// privileged /agent/* surface). Locks the cross-repo signing vector so a
// future drift in either repo's HMAC convention is caught immediately. See
// 135-RESEARCH.md and .planning/research/INTEGRATION-CONTRACT.md §4.2.

import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockRateLimit = vi.fn()
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => mockRateLimit(...args),
}))

const CREDS = { baseUrl: 'http://localhost:9000', connectionToken: 'tok', publishableKey: 'pk_test' }

describe('signAgentBody — cross-repo HMAC vector (WSL-02, SECURITY CRITICAL)', () => {
  it('matches the committed CONTEXT-mandated vector (bare hex, no v1= prefix)', async () => {
    const { signAgentBody } = await import('@/lib/medusa/agent-sig')
    const sig = await signAgentBody('test-secret', '1750000000', '{"a":1}')
    expect(sig).toBe('1f11cf9a5d34d98061ca60891c660610b83d4a229b90d9c84c4f47fd5bff50c4')
  })

  it('matches the committed vector (realistic add payload)', async () => {
    const { signAgentBody } = await import('@/lib/medusa/agent-sig')
    const sig = await signAgentBody(
      'xph_test_connection_token_abc123',
      '1750000000',
      '{"customer_id":"cus_01ABC","product_id":"prod_01XYZ"}',
    )
    expect(sig).toBe('f5817eb8b59e51a70825b9961d87899bfce8f74b043265d083b00cd5bdcf5474')
  })
})

describe('medusaAgentFetch — signed POST transport (WSL-01, WSL-02)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRateLimit.mockResolvedValue({ allowed: true, remaining: 119, resetAt: 0 })
  })

  it('signs the exact sent bytes: stringify once, sign that, send that', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{}',
      json: async () => ({ ok: true }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { medusaAgentFetch } = await import('@/lib/medusa/client')
    const { signAgentBody } = await import('@/lib/medusa/agent-sig')

    await medusaAgentFetch(CREDS, '/agent/wishlists/add', 'org-1', { a: 1 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:9000/agent/wishlists/add')
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}') // the identical stringified body

    const headers = init.headers as Record<string, string>
    expect(headers['Content-Type']).toBe('application/json')
    const ts = headers['X-Xphere-Timestamp']
    expect(ts).toMatch(/^\d+$/) // stringified integer

    const expectedSig = await signAgentBody(CREDS.connectionToken, ts, init.body as string)
    expect(headers['X-Xphere-Signature']).toBe(`v1=${expectedSig}`) // v1= applied exactly once

    vi.unstubAllGlobals()
  })

  it('enforces R11 (medusa:org:{orgId}, 120/60, memory) BEFORE the fetch', async () => {
    mockRateLimit.mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const { medusaAgentFetch, MedusaRateLimitError } = await import('@/lib/medusa/client')

    await expect(medusaAgentFetch(CREDS, '/agent/wishlists/add', 'org-1', { a: 1 })).rejects.toBeInstanceOf(
      MedusaRateLimitError,
    )
    expect(fetchMock).not.toHaveBeenCalled()

    const [key, limit, window, opts] = mockRateLimit.mock.calls[0] as [
      string,
      number,
      number,
      { failMode: string },
    ]
    expect(key).toBe('medusa:org:org-1')
    expect(limit).toBe(120)
    expect(window).toBe(60)
    expect(opts.failMode).toBe('memory')

    vi.unstubAllGlobals()
  })

  it('throws MedusaApiError with .status on non-2xx', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 409,
      text: async () => '{"error":"wishlist_full"}',
    })
    vi.stubGlobal('fetch', fetchMock)

    const { medusaAgentFetch, MedusaApiError } = await import('@/lib/medusa/client')

    const err = await medusaAgentFetch(CREDS, '/agent/wishlists/add', 'org-1', { a: 1 }).catch((e) => e)
    expect(err).toBeInstanceOf(MedusaApiError)
    expect((err as InstanceType<typeof MedusaApiError>).status).toBe(409)

    vi.unstubAllGlobals()
  })
})

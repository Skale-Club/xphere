/**
 * OUTBOUND-03: triggerManychatFlow executor tests
 *
 * RESEARCH.md Pitfall 4: flow_ns is the NAMESPACE STRING (e.g. "content20250616151905_320176"),
 * NOT the numeric flow id. Operators get this from the ManyChat dashboard URL.
 * The executor accepts and passes through whatever string is provided — no format validation.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock global fetch before imports
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OUTBOUND-03: triggerManychatFlow executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POSTs to https://api.manychat.com/fb/sending/sendFlow with Bearer auth', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success' }),
    })
    const { triggerManychatFlow } = await import('@/lib/manychat/trigger-flow')
    const result = await triggerManychatFlow(
      { subscriber_id: 'sub-1', flow_ns: 'content20250101120000_123456' },
      { apiKey: 'mc-key', locationId: '' }
    )
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.manychat.com/fb/sending/sendFlow')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer mc-key')
    expect(JSON.parse(init.body as string)).toEqual({
      subscriber_id: 'sub-1',
      flow_ns: 'content20250101120000_123456',
    })
    expect(result).toBe('Flow content20250101120000_123456 triggered for subscriber sub-1.')
    expect(result).not.toContain('\n')
  })

  it('throws when subscriber_id is missing', async () => {
    const { triggerManychatFlow } = await import('@/lib/manychat/trigger-flow')
    await expect(
      triggerManychatFlow({ flow_ns: 'content...' }, { apiKey: 'k', locationId: '' })
    ).rejects.toThrow(/subscriber_id is required/)
  })

  it('throws when flow_ns is missing', async () => {
    const { triggerManychatFlow } = await import('@/lib/manychat/trigger-flow')
    await expect(
      triggerManychatFlow({ subscriber_id: 's' }, { apiKey: 'k', locationId: '' })
    ).rejects.toThrow(/flow_ns is required/)
  })

  it('throws on non-2xx ManyChat response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'flow_ns is invalid',
    })
    const { triggerManychatFlow } = await import('@/lib/manychat/trigger-flow')
    await expect(
      triggerManychatFlow(
        { subscriber_id: 's', flow_ns: 'bad-ns' },
        { apiKey: 'k', locationId: '' }
      )
    ).rejects.toThrow(/ManyChat API error 400/)
  })
})

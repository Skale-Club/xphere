import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock global fetch before imports
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

// Mock rate-limit so R11 is deterministic
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: vi.fn(),
}))

describe('MED-03: medusaStoreFetch', () => {
  const creds = { baseUrl: 'http://localhost:9000', connectionToken: 'xph_x', publishableKey: 'pk_test' }

  beforeEach(async () => {
    vi.clearAllMocks()
    const { rateLimit } = await import('@/lib/rate-limit')
    vi.mocked(rateLimit).mockResolvedValue({ allowed: true, remaining: 119, resetAt: 0 })
  })

  it('sends x-publishable-api-key header and 8s AbortSignal timeout', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ products: [] }),
    })
    const { medusaStoreFetch } = await import('@/lib/medusa/client')
    await medusaStoreFetch(creds, '/store/products?q=x', 'org-1')

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('http://localhost:9000/store/products?q=x')
    expect(init.headers['x-publishable-api-key']).toBe('pk_test')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('strips trailing slash from baseUrl before joining path', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ products: [] }),
    })
    const { medusaStoreFetch } = await import('@/lib/medusa/client')
    await medusaStoreFetch(
      { ...creds, baseUrl: 'http://localhost:9000/' },
      '/store/products',
      'org-1',
    )
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('http://localhost:9000/store/products')
  })

  it('checks R11 rate limit before fetching and throws MedusaRateLimitError when denied', async () => {
    const { rateLimit } = await import('@/lib/rate-limit')
    vi.mocked(rateLimit).mockResolvedValueOnce({ allowed: false, remaining: 0, resetAt: 0 })
    const { medusaStoreFetch, MedusaRateLimitError } = await import('@/lib/medusa/client')

    await expect(medusaStoreFetch(creds, '/store/products', 'org-1')).rejects.toThrow(MedusaRateLimitError)
    expect(mockFetch).not.toHaveBeenCalled()
    expect(rateLimit).toHaveBeenCalledWith('medusa:org:org-1', 120, 60, { failMode: 'memory' })
  })

  it('throws MedusaApiError with status on non-2xx response', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'boom',
    })
    const { medusaStoreFetch, MedusaApiError } = await import('@/lib/medusa/client')

    await expect(medusaStoreFetch(creds, '/store/products', 'org-1')).rejects.toThrow(MedusaApiError)
    await expect(medusaStoreFetch(creds, '/store/products', 'org-1')).rejects.toThrow('500')
  })
})

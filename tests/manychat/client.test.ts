import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock global fetch before imports
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OUTBOUND-client: manychat shared fetch wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POSTs to https://api.manychat.com/fb/subscriber/addTag with Bearer auth and Content-Type', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success' }),
    })
    const { manychatFetch } = await import('@/lib/manychat/client')
    await manychatFetch(
      '/fb/subscriber/addTag',
      'POST',
      { subscriber_id: 's', tag_id: 't' },
      { apiKey: 'k', locationId: '' }
    )
    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.manychat.com/fb/subscriber/addTag')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer k')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(init.body as string)).toEqual({ subscriber_id: 's', tag_id: 't' })
  })

  it('manychatFetchJson resolves parsed JSON body when response.ok=true', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success', data: { id: 42 } }),
    })
    const { manychatFetchJson } = await import('@/lib/manychat/client')
    const result = await manychatFetchJson<{ status: string; data: { id: number } }>(
      '/fb/subscriber/addTag',
      'POST',
      { subscriber_id: 's', tag_id: 't' },
      { apiKey: 'k', locationId: '' }
    )
    expect(result).toEqual({ status: 'success', data: { id: 42 } })
  })

  it('manychatFetchJson throws "ManyChat API error 400: <body>" when response.ok=false', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'tag does not exist',
    })
    const { manychatFetchJson } = await import('@/lib/manychat/client')
    await expect(
      manychatFetchJson(
        '/fb/subscriber/addTag',
        'POST',
        { subscriber_id: 's', tag_id: 'bad' },
        { apiKey: 'k', locationId: '' }
      )
    ).rejects.toThrow(/ManyChat API error 400/)
  })

  it('AbortController signal is wired — fetch receives an AbortSignal instance', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success' }),
    })
    const { manychatFetch } = await import('@/lib/manychat/client')
    await manychatFetch(
      '/fb/subscriber/addTag',
      'POST',
      { subscriber_id: 's', tag_id: 't' },
      { apiKey: 'k', locationId: '' }
    )
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.signal).toBeDefined()
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('null body arg → body is undefined (no body field sent — GET-style calls)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success' }),
    })
    const { manychatFetch } = await import('@/lib/manychat/client')
    await manychatFetch(
      '/fb/subscriber/addTag',
      'GET',
      null,
      { apiKey: 'k', locationId: '' }
    )
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(init.body).toBeUndefined()
  })
})

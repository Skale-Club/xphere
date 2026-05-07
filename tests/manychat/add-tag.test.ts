import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock global fetch before imports
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OUTBOUND-02: addManychatTag executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POSTs to https://api.manychat.com/fb/subscriber/addTag with Bearer auth', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success' }),
    })
    const { addManychatTag } = await import('@/lib/manychat/add-tag')
    const result = await addManychatTag(
      { subscriber_id: 'sub-1', tag_id: 'tag-99' },
      { apiKey: 'mc-key', locationId: '' }
    )
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.manychat.com/fb/subscriber/addTag')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer mc-key')
    expect(JSON.parse(init.body as string)).toEqual({ subscriber_id: 'sub-1', tag_id: 'tag-99' })
    expect(result).toBe('Tag tag-99 added to subscriber sub-1.')
    expect(result).not.toContain('\n')
  })

  it('throws when subscriber_id is missing', async () => {
    const { addManychatTag } = await import('@/lib/manychat/add-tag')
    await expect(
      addManychatTag({ tag_id: 'tag-99' }, { apiKey: 'k', locationId: '' })
    ).rejects.toThrow(/subscriber_id is required/)
  })

  it('throws when tag_id is missing', async () => {
    const { addManychatTag } = await import('@/lib/manychat/add-tag')
    await expect(
      addManychatTag({ subscriber_id: 's' }, { apiKey: 'k', locationId: '' })
    ).rejects.toThrow(/tag_id is required/)
  })

  it('throws on non-2xx ManyChat response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'tag does not exist',
    })
    const { addManychatTag } = await import('@/lib/manychat/add-tag')
    await expect(
      addManychatTag({ subscriber_id: 's', tag_id: 'bad' }, { apiKey: 'k', locationId: '' })
    ).rejects.toThrow(/ManyChat API error 400/)
  })
})

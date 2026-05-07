import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock global fetch before imports
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OUTBOUND-04: sendManychatMessage executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POSTs to https://api.manychat.com/fb/sending/sendContent with Bearer auth', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success' }),
    })
    const { sendManychatMessage } = await import('@/lib/manychat/send-message')
    const data = { version: 'v2', content: { messages: [{ type: 'text', text: 'Hello!' }] } }
    const result = await sendManychatMessage(
      { subscriber_id: 'sub-1', data, message_tag: 'ACCOUNT_UPDATE' },
      { apiKey: 'mc-key', locationId: '' }
    )
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.manychat.com/fb/sending/sendContent')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer mc-key')
    const body = JSON.parse(init.body as string)
    expect(body).toEqual({
      subscriber_id: 'sub-1',
      data,
      message_tag: 'ACCOUNT_UPDATE',
    })
    expect(result).toBe('Message sent to subscriber sub-1.')
    expect(result).not.toContain('\n')
  })

  it('throws when subscriber_id is missing', async () => {
    const { sendManychatMessage } = await import('@/lib/manychat/send-message')
    await expect(
      sendManychatMessage(
        { data: { version: 'v2', content: { messages: [] } } },
        { apiKey: 'k', locationId: '' }
      )
    ).rejects.toThrow(/subscriber_id is required/)
  })

  it('throws when both data and text are missing', async () => {
    const { sendManychatMessage } = await import('@/lib/manychat/send-message')
    await expect(
      sendManychatMessage({ subscriber_id: 's' }, { apiKey: 'k', locationId: '' })
    ).rejects.toThrow(/data or text is required/)
  })

  it('throws on non-2xx ManyChat response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'subscriber does not exist',
    })
    const { sendManychatMessage } = await import('@/lib/manychat/send-message')
    await expect(
      sendManychatMessage(
        { subscriber_id: 's', data: { version: 'v2', content: { messages: [] } } },
        { apiKey: 'k', locationId: '' }
      )
    ).rejects.toThrow(/ManyChat API error 400/)
  })

  it('builds v2 dynamic-block when caller passes text instead of data', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success' }),
    })
    const { sendManychatMessage } = await import('@/lib/manychat/send-message')
    const result = await sendManychatMessage(
      { subscriber_id: 'sub-1', text: 'hi' },
      { apiKey: 'mc-key', locationId: '' }
    )
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.data).toEqual({
      version: 'v2',
      content: { messages: [{ type: 'text', text: 'hi' }] },
    })
    expect(body.message_tag).toBe('ACCOUNT_UPDATE')
    expect(result).toBe('Message sent to subscriber sub-1.')
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock global fetch before imports
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('OUTBOUND-01: setManychatField executor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('POSTs to https://api.manychat.com/fb/subscriber/setCustomField with Bearer auth', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success' }),
    })
    const { setManychatField } = await import('@/lib/manychat/set-field')
    const result = await setManychatField(
      { subscriber_id: 'sub-1', field_id: 'field-99', field_value: 'gold' },
      { apiKey: 'mc-key', locationId: '' }
    )
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit & { headers: Record<string, string> }]
    expect(url).toBe('https://api.manychat.com/fb/subscriber/setCustomField')
    expect(init.method).toBe('POST')
    expect(init.headers.Authorization).toBe('Bearer mc-key')
    expect(JSON.parse(init.body as string)).toEqual({
      subscriber_id: 'sub-1',
      field_id: 'field-99',
      field_value: 'gold',
    })
    expect(result).toBe('Field field-99 set on subscriber sub-1.')
    expect(result).not.toContain('\n')
  })

  it('throws when subscriber_id is missing', async () => {
    const { setManychatField } = await import('@/lib/manychat/set-field')
    await expect(
      setManychatField({ field_id: 'f1', field_value: 'v' }, { apiKey: 'k', locationId: '' })
    ).rejects.toThrow(/subscriber_id is required/)
  })

  it('throws when field_id is missing', async () => {
    const { setManychatField } = await import('@/lib/manychat/set-field')
    await expect(
      setManychatField({ subscriber_id: 's', field_value: 'v' }, { apiKey: 'k', locationId: '' })
    ).rejects.toThrow(/field_id is required/)
  })

  it('throws on non-2xx ManyChat response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => 'field does not exist',
    })
    const { setManychatField } = await import('@/lib/manychat/set-field')
    await expect(
      setManychatField(
        { subscriber_id: 's', field_id: 'f', field_value: 'v' },
        { apiKey: 'k', locationId: '' }
      )
    ).rejects.toThrow(/ManyChat API error 400/)
  })

  it('accepts field_value: 0 (falsy but not undefined — must NOT be rejected)', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ status: 'success' }),
    })
    const { setManychatField } = await import('@/lib/manychat/set-field')
    // field_value: 0 is falsy but should be accepted; only undefined is rejected
    const result = await setManychatField(
      { subscriber_id: 'sub-1', field_id: 'field-99', field_value: 0 },
      { apiKey: 'mc-key', locationId: '' }
    )
    expect(result).toBe('Field field-99 set on subscriber sub-1.')
    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(init.body as string)
    expect(body.field_value).toBe(0)
  })
})

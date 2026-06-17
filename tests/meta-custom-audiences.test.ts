import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock global fetch before importing the module under test.
const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function okBatch() {
  return {
    ok: true,
    json: async () => ({ num_received: 1, num_invalid_entries: 0 }),
  }
}

describe('META-audiences: syncUsersToAudience ADD/REMOVE HTTP method', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("ADD issues an HTTP POST to /{audience_id}/users with the hashed payload", async () => {
    mockFetch.mockResolvedValueOnce(okBatch())
    const { syncUsersToAudience } = await import('@/lib/meta/custom-audiences')

    const result = await syncUsersToAudience(
      'aud_123',
      'tok',
      [{ email: 'a@b.com', phone: null }],
      'ADD',
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/aud_123/users')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string)
    expect(body.payload.schema).toEqual(['EMAIL_SHA256', 'PHONE_SHA256'])
    expect(body.payload.data).toHaveLength(1)
    expect(body.access_token).toBe('tok')
    expect(result).toEqual({ sent: 1, invalid: 0 })
  })

  it("REMOVE issues an HTTP DELETE (not POST) to /{audience_id}/users with the same hashed payload", async () => {
    mockFetch.mockResolvedValueOnce(okBatch())
    const { syncUsersToAudience } = await import('@/lib/meta/custom-audiences')

    await syncUsersToAudience(
      'aud_123',
      'tok',
      [{ email: 'opted-out@b.com', phone: null }],
      'REMOVE',
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toContain('/aud_123/users')
    // The compliance fix: REMOVE must DELETE, otherwise opted-out contacts are
    // silently re-ADDed to the ad audience.
    expect(init.method).toBe('DELETE')
    const body = JSON.parse(init.body as string)
    expect(body.payload.schema).toEqual(['EMAIL_SHA256', 'PHONE_SHA256'])
    expect(body.payload.data).toHaveLength(1)
  })

  it('returns early without any HTTP call when there is nothing hashable to sync', async () => {
    const { syncUsersToAudience } = await import('@/lib/meta/custom-audiences')

    const result = await syncUsersToAudience('aud_123', 'tok', [{ email: null, phone: null }], 'REMOVE')

    expect(mockFetch).not.toHaveBeenCalled()
    expect(result).toEqual({ sent: 0, invalid: 0 })
  })
})

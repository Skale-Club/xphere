import { beforeEach, describe, expect, it, vi } from 'vitest'

const createClientMock = vi.fn()
const getUserMock = vi.fn()
const getProviderKeyMock = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  getUser: getUserMock,
}))

vi.mock('@/lib/integrations/get-provider-key', () => ({
  getProviderKey: getProviderKeyMock,
}))

function makeSupabase({ linked = true, lookupError = null as { message: string } | null } = {}) {
  const mediaQuery = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    contains: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: linked ? { id: 'msg-1' } : null,
      error: lookupError,
    }),
  }
  return {
    rpc: vi.fn().mockResolvedValue({ data: 'org-1', error: null }),
    from: vi.fn((table: string) => {
      if (table === 'conversation_messages') return mediaQuery
      return mediaQuery
    }),
    mediaQuery,
  }
}

async function callRoute(mediaUrl: string, db = makeSupabase()) {
  createClientMock.mockResolvedValue(db)
  const { GET } = await import('@/app/api/zernio/media/route')
  return GET(new Request(`http://localhost/api/zernio/media?url=${encodeURIComponent(mediaUrl)}`))
}

describe('GET /api/zernio/media', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    getUserMock.mockResolvedValue({ id: 'user-1' })
    getProviderKeyMock.mockResolvedValue('ze_key')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('audio-bytes', {
        status: 200,
        headers: { 'content-type': 'audio/ogg', 'content-length': '11' },
      }),
    ))
  })

  it('rejects non-media Zernio API paths before using the tenant API key', async () => {
    const res = await callRoute('https://zernio.com/api/v1/inbox/conversations?accountId=acct-1')

    expect(res.status).toBe(400)
    expect(getProviderKeyMock).not.toHaveBeenCalled()
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('rejects media URLs that are not linked to an accessible conversation message', async () => {
    const db = makeSupabase({ linked: false })
    const mediaUrl = 'https://zernio.com/api/v1/whatsapp/media/media-1?accountId=acct-1'
    const res = await callRoute(mediaUrl, db)

    expect(res.status).toBe(404)
    expect(db.mediaQuery.contains).toHaveBeenCalledWith('metadata', {
      media: [{ provider: 'zernio', original_url: mediaUrl }],
    })
    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('proxies only stored Zernio media URLs with the org Zernio key', async () => {
    const mediaUrl = 'https://zernio.com/api/v1/whatsapp/media/media-1?accountId=acct-1'
    const res = await callRoute(mediaUrl)

    expect(res.status).toBe(200)
    expect(global.fetch).toHaveBeenCalledWith(mediaUrl, {
      headers: { Authorization: 'Bearer ze_key' },
    })
    expect(res.headers.get('content-type')).toBe('audio/ogg')
  })
})

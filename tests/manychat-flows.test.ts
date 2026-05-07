import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth + DB
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

// Mock crypto — decrypt
vi.mock('@/lib/crypto', () => ({
  encrypt: vi.fn().mockResolvedValue('iv-base64:ciphertext-base64'),
  maskApiKey: vi.fn().mockReturnValue('••••••••key4'),
  decrypt: vi.fn().mockResolvedValue('real-api-key'),
}))

// Mock revalidatePath
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'

// Helper: build a mock supabase client that returns a channel row for .from('manychat_channels').select(...).single()
function buildChannelMock(channelData: Record<string, unknown> | null = { encrypted_api_key: 'iv-base64:ciphertext-base64' }) {
  const singleSpy = vi.fn().mockResolvedValue({
    data: channelData,
    error: null,
  })
  const selectSpy = vi.fn().mockReturnValue({ single: singleSpy })
  const fromMock = vi.fn(() => ({ select: selectSpy }))
  return { from: fromMock, _singleSpy: singleSpy }
}

describe('getManychatFlows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(getUser).mockResolvedValue({
      id: 'user-1',
      email: 'test@test.com',
    } as Awaited<ReturnType<typeof getUser>>)
    vi.mocked(createClient).mockResolvedValue(
      buildChannelMock() as unknown as Awaited<ReturnType<typeof createClient>>
    )
    // Reset decrypt to success after each test (FLOWS-03 overrides it to throw)
    vi.mocked(decrypt).mockResolvedValue('real-api-key')
  })

  it('FLOWS-01: returns { error: "Not authenticated." } when no user session', async () => {
    vi.mocked(getUser).mockResolvedValue(null)

    const { getManychatFlows } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await getManychatFlows()
    expect(result).toEqual({ error: 'Not authenticated.' })
  })

  it('FLOWS-02: returns { error: "No ManyChat channel configured." } when no channel row exists', async () => {
    vi.mocked(createClient).mockResolvedValue(
      buildChannelMock(null) as unknown as Awaited<ReturnType<typeof createClient>>
    )

    const { getManychatFlows } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await getManychatFlows()
    expect(result).toEqual({ error: 'No ManyChat channel configured.' })
  })

  it('FLOWS-03: returns { error: "Failed to decrypt credentials." } when decrypt throws', async () => {
    vi.mocked(decrypt).mockRejectedValue(new Error('bad key'))

    const { getManychatFlows } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await getManychatFlows()
    expect(result).toEqual({ error: 'Failed to decrypt credentials.' })
  })

  it('FLOWS-04: returns { error: "Connection timed out after 5 seconds." } when AbortError fires', async () => {
    const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' })
    vi.spyOn(global, 'fetch').mockRejectedValue(abortError)

    const { getManychatFlows } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await getManychatFlows()
    expect(result).toEqual({ error: 'Connection timed out after 5 seconds.' })
  })

  it('FLOWS-05: returns { error: "ManyChat returned status 401" } when response is not ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response)

    const { getManychatFlows } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await getManychatFlows()
    expect(result).toEqual({ error: 'ManyChat returned status 401' })
  })

  it('FLOWS-06: returns { flows } with name and ns on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        status: 'success',
        data: [
          { id: 1, name: 'Welcome Flow', ns: 'content123_456' },
        ],
      }),
    } as unknown as Response)

    const { getManychatFlows } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await getManychatFlows()
    expect(result).toEqual({
      flows: [{ name: 'Welcome Flow', ns: 'content123_456' }],
    })
  })
})

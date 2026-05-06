import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock auth + DB
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

// Mock crypto — encrypt, maskApiKey, and decrypt
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
import { encrypt, maskApiKey } from '@/lib/crypto'

function buildMockSupabaseClient(insertError: string | null = null, deleteError: string | null = null) {
  const insertSpy = vi.fn().mockResolvedValue({ data: null, error: insertError ? { message: insertError } : null })
  const eqSpy = vi.fn().mockResolvedValue({ data: null, error: deleteError ? { message: deleteError } : null })

  const fromMock = vi.fn((table: string) => {
    if (table === 'manychat_channels') {
      return {
        insert: insertSpy,
        delete: vi.fn().mockReturnValue({ eq: eqSpy }),
      }
    }
    return {}
  })

  return { from: fromMock, _insertSpy: insertSpy, _eqSpy: eqSpy }
}

describe('CHANNEL-01: createManychatChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1', email: 'test@test.com' } as Awaited<ReturnType<typeof getUser>>)
    vi.mocked(createClient).mockResolvedValue(
      buildMockSupabaseClient() as unknown as Awaited<ReturnType<typeof createClient>>
    )
  })

  it('calls encrypt() with the provided API key', async () => {
    const { createManychatChannel } = await import('@/app/(dashboard)/integrations/manychat/actions')
    await createManychatChannel({ channelName: 'Main Bot', apiKey: 'real-api-key-value' })
    expect(encrypt).toHaveBeenCalledWith('real-api-key-value')
  })

  it('calls maskApiKey() to produce the key_hint', async () => {
    const { createManychatChannel } = await import('@/app/(dashboard)/integrations/manychat/actions')
    await createManychatChannel({ channelName: 'Main Bot', apiKey: 'real-api-key-value' })
    expect(maskApiKey).toHaveBeenCalledWith('real-api-key-value')
  })

  it('inserts encrypted_api_key and key_hint — never the raw API key', async () => {
    const mockClient = buildMockSupabaseClient()
    vi.mocked(createClient).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof createClient>>
    )

    const { createManychatChannel } = await import('@/app/(dashboard)/integrations/manychat/actions')
    await createManychatChannel({ channelName: 'Main Bot', apiKey: 'real-api-key-value' })

    expect(mockClient._insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        encrypted_api_key: 'iv-base64:ciphertext-base64',
        key_hint: '••••••••key4',
        channel_name: 'Main Bot',
      })
    )
    // Raw key MUST NOT appear in any insert call argument
    const insertArg = mockClient._insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(JSON.stringify(insertArg)).not.toContain('real-api-key-value')
  })

  it('returns error object when not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const { createManychatChannel } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await createManychatChannel({ channelName: 'Bot', apiKey: 'key' })
    expect(result).toEqual({ error: expect.any(String) })
  })
})

describe('CHANNEL-05: deleteManychatChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1', email: 'test@test.com' } as Awaited<ReturnType<typeof getUser>>)
    vi.mocked(createClient).mockResolvedValue(
      buildMockSupabaseClient() as unknown as Awaited<ReturnType<typeof createClient>>
    )
  })

  it('calls delete().eq("id", channelId) on manychat_channels', async () => {
    const mockClient = buildMockSupabaseClient()
    vi.mocked(createClient).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof createClient>>
    )

    const { deleteManychatChannel } = await import('@/app/(dashboard)/integrations/manychat/actions')
    await deleteManychatChannel('channel-uuid-123')

    expect(mockClient._eqSpy).toHaveBeenCalledWith('id', 'channel-uuid-123')
  })

  it('returns error object when not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const { deleteManychatChannel } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await deleteManychatChannel('channel-uuid-123')
    expect(result).toEqual({ error: expect.any(String) })
  })
})

// -------------------------------------------------------------------------
// Helper: build mock supabase client that supports select().maybeSingle()
// and select().single() for channel read operations.
// -------------------------------------------------------------------------

function buildMockChannelReader(
  maybeSingleResult: { data: unknown; error: unknown } | null = { data: null, error: null },
  singleResult: { data: unknown; error: unknown } | null = { data: null, error: null }
) {
  const maybeSingleSpy = vi.fn().mockResolvedValue(maybeSingleResult)
  const singleSpy = vi.fn().mockResolvedValue(singleResult)

  const selectSpy = vi.fn((cols: string) => {
    // For select that ends with maybeSingle vs single we return the matching chain
    return {
      maybeSingle: maybeSingleSpy,
      single: singleSpy,
    }
  })

  const fromMock = vi.fn(() => ({
    select: selectSpy,
  }))

  return { from: fromMock, _maybeSingleSpy: maybeSingleSpy, _singleSpy: singleSpy, _selectSpy: selectSpy }
}

describe('CHANNEL-02: getManychatChannel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1', email: 'test@test.com' } as Awaited<ReturnType<typeof getUser>>)
  })

  it('returns null when maybeSingle returns { data: null }', async () => {
    const mockClient = buildMockChannelReader({ data: null, error: null })
    vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>)

    const { getManychatChannel } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await getManychatChannel()
    expect(result).toBeNull()
  })

  it('returns ManychatChannelForDisplay when channel row exists', async () => {
    const mockClient = buildMockChannelReader({
      data: {
        id: 'ch-1',
        channel_name: 'Main Bot',
        key_hint: '••••••••abcd',
        webhook_secret: 'secret-uuid',
        is_active: true,
        created_at: '2026-01-01T00:00:00Z',
      },
      error: null,
    })
    vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>)

    const { getManychatChannel } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await getManychatChannel()
    expect(result).toEqual({
      id: 'ch-1',
      channelName: 'Main Bot',
      keyHint: '••••••••abcd',
      webhookSecret: 'secret-uuid',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('returns null when getUser returns null (unauthenticated guard)', async () => {
    vi.mocked(getUser).mockResolvedValue(null)

    const { getManychatChannel } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await getManychatChannel()
    expect(result).toBeNull()
  })
})

describe('CHANNEL-03: MANYCHAT_PAYLOAD_TEMPLATE', () => {
  it('matches the canonical template from PLANNING.md', async () => {
    const { MANYCHAT_PAYLOAD_TEMPLATE } = await import('@/app/(dashboard)/integrations/manychat/constants')
    expect(MANYCHAT_PAYLOAD_TEMPLATE).toEqual({
      subscriber_id: '{{user.id}}',
      first_name: '{{user.first_name}}',
      last_name: '{{user.last_name}}',
      email: '{{user.email}}',
      phone: '{{user.phone}}',
      tags: '{{user.tags}}',
      event_type: 'flow_completed',
      flow_id: '{{flow_id}}',
    })
  })
})

describe('CHANNEL-04: testManychatConnection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1', email: 'test@test.com' } as Awaited<ReturnType<typeof getUser>>)
  })

  it('returns { success: false, error } when not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)

    const { testManychatConnection } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await testManychatConnection()
    expect(result).toEqual({ success: false, error: expect.any(String) })
  })

  it('returns { success: false, error } when no channel row exists', async () => {
    const mockClient = buildMockChannelReader({ data: null, error: null }, { data: null, error: null })
    vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>)

    const { testManychatConnection } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await testManychatConnection()
    expect(result).toEqual({ success: false, error: expect.any(String) })
  })

  it('calls fetch GET /fb/page/getFlows with Authorization: Bearer real-api-key', async () => {
    const mockClient = buildMockChannelReader(
      { data: null, error: null },
      { data: { encrypted_api_key: 'iv-base64:ciphertext-base64' }, error: null }
    )
    vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>)

    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response)

    const { testManychatConnection } = await import('@/app/(dashboard)/integrations/manychat/actions')
    await testManychatConnection()

    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.manychat.com/fb/page/getFlows',
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: 'Bearer real-api-key' },
      })
    )

    fetchSpy.mockRestore()
  })

  it('returns { success: true } when fetch responds 200', async () => {
    const mockClient = buildMockChannelReader(
      { data: null, error: null },
      { data: { encrypted_api_key: 'iv-base64:ciphertext-base64' }, error: null }
    )
    vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>)

    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: true, status: 200 } as Response)

    const { testManychatConnection } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await testManychatConnection()
    expect(result).toEqual({ success: true })
  })

  it('returns { success: false, error } when fetch responds 401', async () => {
    const mockClient = buildMockChannelReader(
      { data: null, error: null },
      { data: { encrypted_api_key: 'iv-base64:ciphertext-base64' }, error: null }
    )
    vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>)

    vi.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 401 } as Response)

    const { testManychatConnection } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await testManychatConnection()
    expect(result).toEqual({ success: false, error: expect.stringContaining('401') })
  })

  it('returns timeout error when AbortController aborts', async () => {
    const mockClient = buildMockChannelReader(
      { data: null, error: null },
      { data: { encrypted_api_key: 'iv-base64:ciphertext-base64' }, error: null }
    )
    vi.mocked(createClient).mockResolvedValue(mockClient as unknown as Awaited<ReturnType<typeof createClient>>)

    const abortError = new DOMException('AbortError', 'AbortError')
    vi.spyOn(global, 'fetch').mockRejectedValue(abortError)

    const { testManychatConnection } = await import('@/app/(dashboard)/integrations/manychat/actions')
    const result = await testManychatConnection()
    expect(result).toEqual({ success: false, error: expect.stringContaining('timed out') })
  })
})

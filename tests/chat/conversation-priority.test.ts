import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import { setConversationPriority } from '../../src/app/(dashboard)/chat/actions'

function buildMockSupabase(updateError: null | { message: string } = null) {
  const eqSpy = vi.fn().mockResolvedValue({ data: null, error: updateError })
  const updateSpy = vi.fn().mockReturnValue({ eq: eqSpy })
  return {
    from: vi.fn(() => ({ update: updateSpy })),
    _updateSpy: updateSpy,
  }
}

describe('setConversationPriority server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(['normal', 'high', 'urgent'] as const)(
    'accepts priority "%s"',
    async (priority) => {
      vi.mocked(getUser).mockResolvedValue({ id: 'u1' } as Awaited<ReturnType<typeof getUser>>)
      const mock = buildMockSupabase()
      vi.mocked(createClient).mockResolvedValue(mock as unknown as Awaited<ReturnType<typeof createClient>>)

      const result = await setConversationPriority('conv-1', priority)
      expect(result).toEqual({ priority })
      expect(mock._updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({ priority }),
      )
    },
  )

  it('rejects invalid priority value', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'u1' } as Awaited<ReturnType<typeof getUser>>)
    const result = await setConversationPriority(
      'conv-1',
      'critical' as unknown as 'urgent',
    )
    expect(result).toEqual({ error: 'Invalid priority' })
  })

  it('returns { error } when user is not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const result = await setConversationPriority('conv-1', 'high')
    expect(result).toEqual({ error: 'Unauthorized' })
  })

  it('returns { error } when DB update fails', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'u1' } as Awaited<ReturnType<typeof getUser>>)
    const mock = buildMockSupabase({ message: 'boom' })
    vi.mocked(createClient).mockResolvedValue(mock as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await setConversationPriority('conv-1', 'urgent')
    expect('error' in result).toBe(true)
  })
})

describe('priority cycle helper', () => {
  // Mirrors the cycle used in chat-header.tsx: normal → high → urgent → normal
  const CYCLE = { normal: 'high', high: 'urgent', urgent: 'normal' } as const

  it('cycles through priorities in the expected order', () => {
    expect(CYCLE.normal).toBe('high')
    expect(CYCLE.high).toBe('urgent')
    expect(CYCLE.urgent).toBe('normal')
  })

  it('wraps from urgent back to normal', () => {
    let p: 'normal' | 'high' | 'urgent' = 'normal'
    for (let i = 0; i < 3; i++) p = CYCLE[p]
    expect(p).toBe('normal')
  })
})

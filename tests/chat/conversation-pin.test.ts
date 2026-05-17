import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import { pinConversation } from '../../src/app/(dashboard)/chat/actions'

function buildMockSupabase(updateError: null | { message: string } = null) {
  const eqSpy = vi.fn().mockResolvedValue({ data: null, error: updateError })
  const updateSpy = vi.fn().mockReturnValue({ eq: eqSpy })
  return {
    from: vi.fn(() => ({ update: updateSpy })),
    _updateSpy: updateSpy,
    _eqSpy: eqSpy,
  }
}

describe('pinConversation server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns { pinned: true } when pinning succeeds', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'u1' } as Awaited<ReturnType<typeof getUser>>)
    const mock = buildMockSupabase()
    vi.mocked(createClient).mockResolvedValue(mock as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await pinConversation('conv-1', true)
    expect(result).toEqual({ pinned: true })
    expect(mock._updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ pinned: true }),
    )
  })

  it('returns { pinned: false } when unpinning succeeds', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'u1' } as Awaited<ReturnType<typeof getUser>>)
    const mock = buildMockSupabase()
    vi.mocked(createClient).mockResolvedValue(mock as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await pinConversation('conv-1', false)
    expect(result).toEqual({ pinned: false })
    expect(mock._updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ pinned: false }),
    )
  })

  it('returns { error } when user is not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const result = await pinConversation('conv-1', true)
    expect(result).toEqual({ error: 'Unauthorized' })
  })

  it('returns { error } when DB update fails', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'u1' } as Awaited<ReturnType<typeof getUser>>)
    const mock = buildMockSupabase({ message: 'boom' })
    vi.mocked(createClient).mockResolvedValue(mock as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await pinConversation('conv-1', true)
    expect('error' in result).toBe(true)
  })
})

describe('pinned-first ordering', () => {
  it('sorts pinned conversations before unpinned ones, preserving lastMessageAt within groups', () => {
    const rows = [
      { id: 'a', pinned: false, lastMessageAt: '2026-05-10T10:00:00Z' },
      { id: 'b', pinned: true, lastMessageAt: '2026-05-09T10:00:00Z' },
      { id: 'c', pinned: false, lastMessageAt: '2026-05-12T10:00:00Z' },
      { id: 'd', pinned: true, lastMessageAt: '2026-05-11T10:00:00Z' },
    ]

    const sorted = [...rows].sort((a, b) => {
      const pinDiff = (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0)
      if (pinDiff !== 0) return pinDiff
      return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    })

    expect(sorted.map((r) => r.id)).toEqual(['d', 'b', 'c', 'a'])
  })
})

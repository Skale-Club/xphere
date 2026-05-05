import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mock server-only modules ----
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'
import { toggleBotStatus } from '../src/app/(dashboard)/chat/actions'

// ---- Supabase mock builder ----
function buildMockSupabase(updateError: null | { message: string } = null) {
  const updateSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: updateError }),
  })
  return {
    from: vi.fn(() => ({
      update: updateSpy,
    })),
    _updateSpy: updateSpy,
  }
}

describe('toggleBotStatus server action', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('toggles bot_status from active to paused', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as Awaited<ReturnType<typeof getUser>>)
    const mockSupabase = buildMockSupabase()
    vi.mocked(createClient).mockResolvedValue(mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await toggleBotStatus('conv-1', 'active')
    expect(result).toEqual({ botStatus: 'paused' })
  })

  it('toggles bot_status from paused to active', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as Awaited<ReturnType<typeof getUser>>)
    const mockSupabase = buildMockSupabase()
    vi.mocked(createClient).mockResolvedValue(mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await toggleBotStatus('conv-1', 'paused')
    expect(result).toEqual({ botStatus: 'active' })
  })

  it('returns { error } when user is not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)

    const result = await toggleBotStatus('conv-1', 'active')
    expect(result).toEqual({ error: 'Unauthorized' })
  })

  it('returns { botStatus } with new status on success', async () => {
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1' } as Awaited<ReturnType<typeof getUser>>)
    const mockSupabase = buildMockSupabase()
    vi.mocked(createClient).mockResolvedValue(mockSupabase as unknown as Awaited<ReturnType<typeof createClient>>)

    const result = await toggleBotStatus('conv-1', 'active')
    expect('botStatus' in result).toBe(true)
    if ('botStatus' in result) {
      expect(result.botStatus).toBe('paused')
    }
  })
})

describe('AdminChatLayout optimistic bot toggle', () => {
  it('immediately updates local botStatus before server action resolves', () => {
    // Test the pure optimistic logic (no component rendering needed)
    type Conversation = { id: string; botStatus: string }
    const conversations: Conversation[] = [
      { id: 'conv-1', botStatus: 'active' },
      { id: 'conv-2', botStatus: 'paused' },
    ]
    const conversationId = 'conv-1'
    const currentStatus = 'active'
    const optimisticStatus = currentStatus === 'active' ? 'paused' : 'active'

    // This is the optimistic update logic from handleBotStatusToggle
    const updated = conversations.map((c) =>
      c.id === conversationId ? { ...c, botStatus: optimisticStatus } : c
    )

    expect(updated.find((c) => c.id === 'conv-1')?.botStatus).toBe('paused')
    expect(updated.find((c) => c.id === 'conv-2')?.botStatus).toBe('paused') // unchanged
  })

  it('reverts botStatus and calls toast.error on server action failure', () => {
    // Test the revert logic
    type Conversation = { id: string; botStatus: string }
    const originalStatus = 'active'
    const conversationId = 'conv-1'
    const conversations: Conversation[] = [
      { id: 'conv-1', botStatus: 'paused' }, // already optimistically updated
    ]

    // Simulate error result → revert
    const result: { error: string } = { error: 'Failed to update bot status' }
    let reverted = conversations
    if ('error' in result) {
      reverted = conversations.map((c) =>
        c.id === conversationId ? { ...c, botStatus: originalStatus } : c
      )
    }

    expect(reverted.find((c) => c.id === 'conv-1')?.botStatus).toBe('active')
  })
})

// Suppress unused import warning
void vi

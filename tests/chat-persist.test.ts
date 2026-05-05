import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockInsertConv = vi.fn()
const mockInsertMsg = vi.fn()
const mockUpdate = vi.fn()
const mockUpdateEq = vi.fn()
const mockSelect = vi.fn()
const mockSingle = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => ({
    from: mockFrom,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  // ensureDbSession chain: .from('conversations').insert(...).select('id').single()
  mockSingle.mockResolvedValue({ data: { id: 'db-sess-uuid' }, error: null })
  mockSelect.mockReturnValue({ single: mockSingle })
  mockInsertConv.mockReturnValue({ select: mockSelect })
  // persistMessage update chain: .from('conversations').update(...).eq('id', ...)
  mockUpdateEq.mockResolvedValue({ error: null })
  mockUpdate.mockReturnValue({ eq: mockUpdateEq })

  // Route by table name — ensureDbSession uses conversations.insert,
  // persistMessage uses conversation_messages.insert + conversations.update
  mockFrom.mockImplementation((table: string) => {
    if (table === 'conversation_messages') return { insert: mockInsertMsg }
    if (table === 'conversations') return { insert: mockInsertConv, update: mockUpdate }
    return {}
  })
})

import { ensureDbSession, persistMessage } from '@/lib/chat/persist'

describe('ensureDbSession', () => {
  it('inserts a conversations row and returns the id', async () => {
    const id = await ensureDbSession({ orgId: 'org-1', sessionId: 'sess-1', widgetToken: 'tok' })
    expect(mockFrom).toHaveBeenCalledWith('conversations')
    expect(mockInsertConv).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'org-1', widget_token: 'tok', session_key: 'sess-1' })
    )
    expect(id).toBe('db-sess-uuid')
  })

  it('throws when Supabase returns an error', async () => {
    mockSingle.mockResolvedValue({ data: null, error: new Error('db error') })
    await expect(ensureDbSession({ orgId: 'org-1', sessionId: 'sess-1', widgetToken: 'tok' }))
      .rejects.toThrow()
  })
})

describe('persistMessage', () => {
  it('inserts a conversation_messages row and updates conversations preview', async () => {
    mockInsertMsg.mockResolvedValue({ error: null })
    await persistMessage({ dbSessionId: 'db-sess-uuid', orgId: 'org-1', role: 'user', content: 'Hello' })
    expect(mockFrom).toHaveBeenCalledWith('conversation_messages')
    expect(mockInsertMsg).toHaveBeenCalledWith({
      conversation_id: 'db-sess-uuid',
      org_id: 'org-1',
      role: 'user',
      content: 'Hello',
    })
    // Preview update on conversations table
    expect(mockFrom).toHaveBeenCalledWith('conversations')
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ last_message: 'Hello' })
    )
    expect(mockUpdateEq).toHaveBeenCalledWith('id', 'db-sess-uuid')
  })

  it('throws when Supabase returns an error', async () => {
    mockInsertMsg.mockResolvedValue({ error: new Error('db error') })
    await expect(persistMessage({ dbSessionId: 'x', orgId: 'y', role: 'user', content: 'z' }))
      .rejects.toThrow()
  })
})

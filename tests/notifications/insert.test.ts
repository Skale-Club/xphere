import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock @supabase/supabase-js createClient before importing the module under test
const mockInsert = vi.fn()
const mockSelect = vi.fn()
const mockEq = vi.fn()
const mockFrom = vi.fn()

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}))

import { insertNotification } from '@/lib/notifications/insert'

describe('insertNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('inserts one row per userId when explicit userIds are provided', async () => {
    const mockInsertResult = { error: null }
    mockInsert.mockResolvedValue(mockInsertResult)
    mockFrom.mockReturnValue({ insert: mockInsert })

    await insertNotification('org-001', 'missed_call', { call_log_id: 'call-001' }, ['uid1', 'uid2'])

    expect(mockInsert).toHaveBeenCalledTimes(1)
    const insertArg = mockInsert.mock.calls[0][0] as Array<{ org_id: string; user_id: string; type: string }>
    expect(insertArg).toHaveLength(2)
    expect(insertArg[0]).toMatchObject({ org_id: 'org-001', user_id: 'uid1', type: 'missed_call' })
    expect(insertArg[1]).toMatchObject({ org_id: 'org-001', user_id: 'uid2', type: 'missed_call' })
  })

  it('fetches org_members and fans out when no userIds are provided', async () => {
    const mockMembers = [{ user_id: 'member-01' }, { user_id: 'member-02' }]
    const mockInsertResult = { error: null }

    // Set up from('org_members').select().eq() chain
    const mockOrgMembersChain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ data: mockMembers, error: null }),
    }
    // Set up from('notifications').insert() chain
    mockInsert.mockResolvedValue(mockInsertResult)
    const mockNotificationsChain = {
      insert: mockInsert,
    }

    mockFrom.mockImplementation((table: string) => {
      if (table === 'org_members') return mockOrgMembersChain
      if (table === 'notifications') return mockNotificationsChain
      return {}
    })

    await insertNotification('org-002', 'new_conversation', { conversation_id: 'conv-001' })

    expect(mockOrgMembersChain.select).toHaveBeenCalledWith('user_id')
    expect(mockOrgMembersChain.eq).toHaveBeenCalledWith('organization_id', 'org-002')
    expect(mockInsert).toHaveBeenCalledTimes(1)
    const insertArg = mockInsert.mock.calls[0][0] as Array<{ user_id: string }>
    expect(insertArg).toHaveLength(2)
    expect(insertArg.map((r) => r.user_id)).toEqual(['member-01', 'member-02'])
  })

  it('swallows errors and never throws', async () => {
    mockInsert.mockRejectedValue(new Error('DB connection failed'))
    mockFrom.mockReturnValue({ insert: mockInsert })

    // Should not throw
    await expect(
      insertNotification('org-003', 'flow_failed', {}, ['uid-3'])
    ).resolves.toBeUndefined()
  })

  it('inserts with correct shape: org_id, user_id, type, payload', async () => {
    const mockInsertResult = { error: null }
    mockInsert.mockResolvedValue(mockInsertResult)
    mockFrom.mockReturnValue({ insert: mockInsert })

    await insertNotification('org-004', 'missed_call', { call_log_id: 'call-99' }, ['uid-4'])

    const insertArg = mockInsert.mock.calls[0][0] as Array<Record<string, unknown>>
    expect(insertArg[0]).toMatchObject({
      org_id: 'org-004',
      user_id: 'uid-4',
      type: 'missed_call',
      payload: { call_log_id: 'call-99' },
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
  getUser: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

import { createClient, getUser } from '@/lib/supabase/server'

function buildMockSupabaseClient(opts: {
  insertError?: string | null
  updateError?: string | null
  deleteError?: string | null
} = {}) {
  const insertSpy = vi.fn().mockResolvedValue({
    data: null,
    error: opts.insertError ? { message: opts.insertError } : null,
  })
  const updateEqSpy = vi.fn().mockResolvedValue({
    data: null,
    error: opts.updateError ? { message: opts.updateError } : null,
  })
  const updateSpy = vi.fn().mockReturnValue({ eq: updateEqSpy })
  const deleteEqSpy = vi.fn().mockResolvedValue({
    data: null,
    error: opts.deleteError ? { message: opts.deleteError } : null,
  })

  const fromMock = vi.fn((table: string) => {
    if (table === 'manychat_rules') {
      return {
        insert: insertSpy,
        update: updateSpy,
        delete: vi.fn().mockReturnValue({ eq: deleteEqSpy }),
      }
    }
    return {}
  })

  return {
    from: fromMock,
    _insertSpy: insertSpy,
    _updateSpy: updateSpy,
    _updateEqSpy: updateEqSpy,
    _deleteEqSpy: deleteEqSpy,
  }
}

describe('ROUTING-01: createManychatRule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1', email: 't@t.com' } as Awaited<ReturnType<typeof getUser>>)
    vi.mocked(createClient).mockResolvedValue(
      buildMockSupabaseClient() as unknown as Awaited<ReturnType<typeof createClient>>
    )
  })

  it('inserts a row with channel_id, event_type, condition, tool_config_id, priority, is_active', async () => {
    const mockClient = buildMockSupabaseClient()
    vi.mocked(createClient).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof createClient>>
    )

    const { createManychatRule } = await import('@/app/(dashboard)/integrations/manychat/rule-actions')
    await createManychatRule({
      channelId: 'channel-1',
      eventType: 'flow_completed',
      condition: { flow_id: 'abc123' },
      toolConfigId: 'tool-1',
      priority: 5,
      isActive: true,
    })

    expect(mockClient._insertSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel_id: 'channel-1',
        event_type: 'flow_completed',
        condition: { flow_id: 'abc123' },
        tool_config_id: 'tool-1',
        priority: 5,
        is_active: true,
      })
    )
  })

  it('does NOT manually set org_id (RLS WITH CHECK populates it)', async () => {
    const mockClient = buildMockSupabaseClient()
    vi.mocked(createClient).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof createClient>>
    )

    const { createManychatRule } = await import('@/app/(dashboard)/integrations/manychat/rule-actions')
    await createManychatRule({
      channelId: 'channel-1',
      eventType: 'flow_completed',
      condition: {},
      toolConfigId: 'tool-1',
    })

    const insertArg = mockClient._insertSpy.mock.calls[0][0] as Record<string, unknown>
    expect(insertArg.org_id).toBeUndefined()
  })

  it('returns error object when not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const { createManychatRule } = await import('@/app/(dashboard)/integrations/manychat/rule-actions')
    const result = await createManychatRule({
      channelId: 'channel-1',
      eventType: 'x',
      condition: {},
      toolConfigId: 'tool-1',
    })
    expect(result).toEqual({ error: expect.any(String) })
  })
})

describe('ROUTING-02: updateManychatRule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1', email: 't@t.com' } as Awaited<ReturnType<typeof getUser>>)
    vi.mocked(createClient).mockResolvedValue(
      buildMockSupabaseClient() as unknown as Awaited<ReturnType<typeof createClient>>
    )
  })

  it('only patches the fields provided (partial update)', async () => {
    const mockClient = buildMockSupabaseClient()
    vi.mocked(createClient).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof createClient>>
    )

    const { updateManychatRule } = await import('@/app/(dashboard)/integrations/manychat/rule-actions')
    await updateManychatRule('rule-1', { priority: 10 })

    expect(mockClient._updateSpy).toHaveBeenCalledWith(expect.objectContaining({ priority: 10 }))
    const updateArg = mockClient._updateSpy.mock.calls[0][0] as Record<string, unknown>
    expect(updateArg.condition).toBeUndefined()
    expect(updateArg.event_type).toBeUndefined()
  })

  it('calls .eq("id", ruleId) on update', async () => {
    const mockClient = buildMockSupabaseClient()
    vi.mocked(createClient).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof createClient>>
    )

    const { updateManychatRule } = await import('@/app/(dashboard)/integrations/manychat/rule-actions')
    await updateManychatRule('rule-uuid-123', { isActive: false })

    expect(mockClient._updateEqSpy).toHaveBeenCalledWith('id', 'rule-uuid-123')
  })

  it('returns error object when not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const { updateManychatRule } = await import('@/app/(dashboard)/integrations/manychat/rule-actions')
    const result = await updateManychatRule('rule-1', { priority: 1 })
    expect(result).toEqual({ error: expect.any(String) })
  })
})

describe('ROUTING-02: deleteManychatRule', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    vi.mocked(getUser).mockResolvedValue({ id: 'user-1', email: 't@t.com' } as Awaited<ReturnType<typeof getUser>>)
    vi.mocked(createClient).mockResolvedValue(
      buildMockSupabaseClient() as unknown as Awaited<ReturnType<typeof createClient>>
    )
  })

  it('calls delete().eq("id", ruleId) on manychat_rules', async () => {
    const mockClient = buildMockSupabaseClient()
    vi.mocked(createClient).mockResolvedValue(
      mockClient as unknown as Awaited<ReturnType<typeof createClient>>
    )

    const { deleteManychatRule } = await import('@/app/(dashboard)/integrations/manychat/rule-actions')
    await deleteManychatRule('rule-uuid-123')

    expect(mockClient._deleteEqSpy).toHaveBeenCalledWith('id', 'rule-uuid-123')
  })

  it('returns error object when not authenticated', async () => {
    vi.mocked(getUser).mockResolvedValue(null)
    const { deleteManychatRule } = await import('@/app/(dashboard)/integrations/manychat/rule-actions')
    const result = await deleteManychatRule('rule-uuid-123')
    expect(result).toEqual({ error: expect.any(String) })
  })
})

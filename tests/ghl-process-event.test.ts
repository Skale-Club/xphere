// tests/ghl-process-event.test.ts
// Inbound GHL webhook → process-event normalization (conversation + message).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn().mockResolvedValue('api-key') }))
vi.mock('@/lib/ghl/send-message', () => ({
  sendGhlMessage: vi.fn().mockResolvedValue(undefined),
  channelToGhlType: vi.fn().mockReturnValue('SMS'),
}))
vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: vi.fn().mockResolvedValue('automation reply'),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'

interface MockOpts {
  existingConversation?: { id: string; bot_status?: string; last_inbound_at?: string | null } | null
  ghlChannel?: { encrypted_api_key: string; automation_id: string | null; agent_id: string | null } | null
}

function buildMockSupabase(opts: MockOpts = {}) {
  const ghlChannel =
    opts.ghlChannel === undefined
      ? { encrypted_api_key: 'enc', automation_id: null, agent_id: null }
      : opts.ghlChannel

  const insertConversationSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'conv-new' }, error: null }),
  })
  const updateConversationSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
  // Chainable: normalizeInbound does `.insert(...).select('id').single()`.
  const insertMessageSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'msg-1' }, error: null }),
  })
  const insertEventSpy = vi.fn().mockResolvedValue({ data: null, error: null })

  const fromMock = vi.fn((table: string) => {
    if (table === 'ghl_events') return { insert: insertEventSpy }
    if (table === 'ghl_channels') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: ghlChannel, error: null }),
      }
    }
    if (table === 'conversations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.existingConversation ?? null, error: null }),
        insert: insertConversationSpy,
        update: updateConversationSpy,
      }
    }
    if (table === 'conversation_messages') {
      return { insert: insertMessageSpy }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  return { from: fromMock, insertConversationSpy, updateConversationSpy, insertMessageSpy, insertEventSpy }
}

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    type: 'InboundMessage',
    direction: 'inbound',
    locationId: 'loc-1',
    contactId: 'ct-1',
    conversationId: 'ghlconv-1',
    messageType: 'SMS',
    body: 'Hi from GHL',
    phone: '+15551234',
    firstName: 'Jo',
    lastName: 'Doe',
    email: 'jo@example.com',
    ...overrides,
  }
}

describe('GHL process-event — inbound message', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates a conversation (ghl_sms) + inbound message for a new thread', async () => {
    const db = buildMockSupabase({ existingConversation: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processGhlEvent } = await import('@/lib/ghl/process-event')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processGhlEvent(makePayload() as any, 'org-1')

    expect(db.insertEventSpy).toHaveBeenCalled()
    expect(db.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        channel: 'ghl_sms',
        channel_metadata: expect.objectContaining({ contact_id: 'ct-1', location_id: 'loc-1' }),
      }),
    )
    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: 'conv-new', role: 'user', content: 'Hi from GHL' }),
    )
  })

  it('maps messageType=WhatsApp to channel ghl_whatsapp', async () => {
    const db = buildMockSupabase({ existingConversation: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processGhlEvent } = await import('@/lib/ghl/process-event')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processGhlEvent(makePayload({ messageType: 'WhatsApp' }) as any, 'org-1')

    expect(db.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ channel: 'ghl_whatsapp' }),
    )
  })

  it('appends to an existing conversation (update, no insert)', async () => {
    const db = buildMockSupabase({ existingConversation: { id: 'conv-existing', bot_status: 'active', last_inbound_at: null } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processGhlEvent } = await import('@/lib/ghl/process-event')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processGhlEvent(makePayload() as any, 'org-1')

    expect(db.insertConversationSpy).not.toHaveBeenCalled()
    expect(db.updateConversationSpy).toHaveBeenCalled()
    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: 'conv-existing', role: 'user' }),
    )
  })

  it('skips outbound and non-InboundMessage events', async () => {
    const db = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processGhlEvent } = await import('@/lib/ghl/process-event')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processGhlEvent(makePayload({ direction: 'outbound' }) as any, 'org-1')
    expect(db.insertMessageSpy).not.toHaveBeenCalled()
  })

  it('does nothing when no active ghl_channel matches', async () => {
    const db = buildMockSupabase({ ghlChannel: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processGhlEvent } = await import('@/lib/ghl/process-event')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processGhlEvent(makePayload() as any, 'org-1')

    expect(db.insertConversationSpy).not.toHaveBeenCalled()
    expect(db.insertMessageSpy).not.toHaveBeenCalled()
  })
})

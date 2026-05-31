import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { MetaWebhookPayload } from '@/lib/meta/process-event'

// ---- Mock createServiceRoleClient ----
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

// ---- Mock executeAction ----
vi.mock('@/lib/action-engine/execute-action', () => ({
  executeAction: vi.fn().mockResolvedValue('automation result'),
}))

// ---- Mock decrypt ----
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue('plaintext-api-key'),
}))

// ---- Mock insertNotification (real impl builds a live client) ----
vi.mock('@/lib/notifications/insert', () => ({
  insertNotification: vi.fn().mockResolvedValue(undefined),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'

// ---- Supabase mock builder ----
// Returns a mock client with trackable spies for each table operation.
function buildMockSupabase(existingConversation: { id: string; channel_metadata: Record<string, string>; last_inbound_at: string | null } | null = null) {
  // Spies for each operation we want to assert on
  const insertConversationSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'conv-1' }, error: null }),
  })
  const updateConversationSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
  const insertMessageSpy = vi.fn().mockResolvedValue({ data: null, error: null })

  const fromMock = vi.fn((table: string) => {
    if (table === 'meta_channels') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { org_id: 'org-1', automation_id: null, config: {} },
          error: null,
        }),
      }
    }

    if (table === 'conversations') {
      return {
        // SELECT path (de-duplication query)
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: existingConversation,
          error: null,
        }),
        // INSERT path (new conversation)
        insert: insertConversationSpy,
        // UPDATE path (existing conversation)
        update: updateConversationSpy,
      }
    }

    if (table === 'conversation_messages') {
      // select chain = the mid-idempotency dup check; insert = the message write.
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: insertMessageSpy,
      }
    }

    if (table === 'tool_configs') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
      }
    }

    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  return {
    from: fromMock,
    insertConversationSpy,
    updateConversationSpy,
    insertMessageSpy,
  }
}

// ---- Payload builders ----
function makeInstagramPayload(messageOverride?: Partial<MetaWebhookPayload['entry'][0]['messaging'][0]['message']>): MetaWebhookPayload {
  return {
    object: 'instagram',
    entry: [{
      id: 'page-123',
      messaging: [{
        sender: { id: 'igsid-456' },
        message: { mid: 'mid-001', text: 'Hello from Instagram', ...messageOverride },
      }],
    }],
  }
}

function makeMessengerPayload(): MetaWebhookPayload {
  return {
    object: 'page',
    entry: [{
      id: 'page-789',
      messaging: [{
        sender: { id: 'psid-321' },
        message: { mid: 'mid-002', text: 'Hello from Messenger' },
      }],
    }],
  }
}

describe('METAEV-02: Instagram DM conversation creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('creates a new conversation with channel="instagram" and channel_metadata={igsid, page_id}', async () => {
    const mockDb = buildMockSupabase(null)
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makeInstagramPayload())

    expect(mockDb.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'instagram',
        channel_metadata: { igsid: 'igsid-456', page_id: 'page-123' },
        widget_token: '',
        org_id: 'org-1',
      })
    )
  })

  it('appends message to existing conversation when igsid+page_id already exists', async () => {
    const mockDb = buildMockSupabase({
      id: 'existing-conv',
      channel_metadata: { igsid: 'igsid-456', page_id: 'page-123' },
      last_inbound_at: new Date().toISOString(),
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makeInstagramPayload())

    // Should NOT insert a new conversation — only update + insert message
    expect(mockDb.insertConversationSpy).not.toHaveBeenCalled()
    expect(mockDb.updateConversationSpy).toHaveBeenCalled()
  })

  it('inserts a conversation_messages row with role="user" and the message text', async () => {
    const mockDb = buildMockSupabase(null)
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makeInstagramPayload())

    expect(mockDb.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: 'Hello from Instagram',
        org_id: 'org-1',
      })
    )
  })

  it('updates last_inbound_at on the conversation for every inbound message', async () => {
    const mockDb = buildMockSupabase(null)
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makeInstagramPayload())

    // New conversation insert should include last_inbound_at
    expect(mockDb.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        last_inbound_at: expect.any(String),
      })
    )
  })
})

describe('METAEV-02: Messenger conversation creation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('creates a new conversation with channel="messenger" and channel_metadata={sender_id, page_id}', async () => {
    const mockDb = buildMockSupabase(null)
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makeMessengerPayload())

    expect(mockDb.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: 'messenger',
        channel_metadata: { sender_id: 'psid-321', page_id: 'page-789' },
        org_id: 'org-1',
      })
    )
  })

  it('appends message to existing conversation when sender_id+page_id already exists', async () => {
    const mockDb = buildMockSupabase({
      id: 'existing-conv-msg',
      channel_metadata: { sender_id: 'psid-321', page_id: 'page-789' },
      last_inbound_at: new Date().toISOString(),
    })
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makeMessengerPayload())

    expect(mockDb.insertConversationSpy).not.toHaveBeenCalled()
    expect(mockDb.updateConversationSpy).toHaveBeenCalled()
  })

  it('sets widget_token to empty string for Meta conversations', async () => {
    const mockDb = buildMockSupabase(null)
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(makeMessengerPayload())

    expect(mockDb.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ widget_token: '' })
    )
  })
})

describe('METAEV-02: echo filtering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('skips events where message.is_echo is true', async () => {
    const mockDb = buildMockSupabase(null)
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const echoPayload: MetaWebhookPayload = {
      object: 'instagram',
      entry: [{
        id: 'page-123',
        messaging: [{
          sender: { id: 'igsid-456' },
          message: { mid: 'mid-echo', text: 'echo message', is_echo: true },
        }],
      }],
    }

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(echoPayload)

    // No conversation or message should be created
    expect(mockDb.from).not.toHaveBeenCalledWith('conversations')
    expect(mockDb.insertMessageSpy).not.toHaveBeenCalled()
  })

  it('skips events where message.text is absent', async () => {
    const mockDb = buildMockSupabase(null)
    vi.mocked(createServiceRoleClient).mockReturnValue(mockDb as any)

    const noTextPayload: MetaWebhookPayload = {
      object: 'instagram',
      entry: [{
        id: 'page-123',
        messaging: [{
          sender: { id: 'igsid-456' },
          message: { mid: 'mid-notext' },
        }],
      }],
    }

    const { processMetaEvent } = await import('@/lib/meta/process-event')
    await processMetaEvent(noTextPayload)

    expect(mockDb.from).not.toHaveBeenCalledWith('conversations')
    expect(mockDb.insertMessageSpy).not.toHaveBeenCalled()
  })
})

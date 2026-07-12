// tests/whatsapp-process-message.test.ts
// Coverage for the normalizeInbound migration of processWhatsAppMessage
// (src/lib/whatsapp/process-message.ts):
//   - new conversation: contact created, message inserted, new_conversation notify
//   - existing conversation: message appended, new_message notify
//   - whatsapp_message_id duplicate: message insert + notify both skipped
//   - bot_status='paused': no agent run
//   - media message: adapter.fetchMedia invoked with the resolved conversationId

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))

vi.mock('@/lib/contacts/server', () => ({
  findByChannelIdentity: vi.fn().mockResolvedValue(null),
  findByPhone: vi.fn().mockResolvedValue(null),
  attachChannelIdentity: vi.fn().mockResolvedValue(null),
}))

const insertNotificationMock = vi.fn().mockResolvedValue(undefined)
vi.mock('@/lib/notifications/insert', () => ({
  insertNotification: (...args: unknown[]) => insertNotificationMock(...args),
}))

const routeWhatsAppReplyMock = vi.fn().mockResolvedValue({ ok: true, messageIds: ['out-1'] })
vi.mock('@/lib/whatsapp/route-reply', () => ({
  routeWhatsAppReply: (...args: unknown[]) => routeWhatsAppReplyMock(...args),
}))

const runAgentMock = vi.fn().mockResolvedValue({
  text: 'Agent reply',
  usage: { tokensIn: 1, tokensOut: 1 },
  invocationId: 'inv-1',
  traceId: 'trace-1',
  status: 'success',
})
vi.mock('@/lib/agent-runtime/run-agent', () => ({ runAgent: (...args: unknown[]) => runAgentMock(...args) }))
vi.mock('@/lib/agent-runtime/load-history', () => ({ loadHistoryWindow: vi.fn().mockResolvedValue([]) }))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import type {
  NormalizedWhatsAppMessage,
  ResolvedProvider,
  WhatsAppAdapter,
} from '@/lib/whatsapp/types'

interface MockOpts {
  existingConversation?: { id: string; bot_status?: string; contact_id?: string | null } | null
  duplicateMessage?: { id: string } | null
  smsAgentDefault?: { agent_id: string } | null
}

function buildMockSupabase(opts: MockOpts = {}) {
  const insertConversationSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'conv-new' }, error: null }),
  })
  const updateConversationSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
  const insertMessageSpy = vi.fn().mockResolvedValue({ data: null, error: null })
  const insertContactSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'contact-new' }, error: null }),
  })

  const fromMock = vi.fn((table: string) => {
    if (table === 'conversations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.existingConversation ?? null, error: null }),
        insert: insertConversationSpy,
        update: updateConversationSpy,
      }
    }
    if (table === 'contacts') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        insert: insertContactSpy,
        update: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnThis() }),
      }
    }
    if (table === 'conversation_messages') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.duplicateMessage ?? null, error: null }),
        insert: insertMessageSpy,
      }
    }
    if (table === 'agent_channel_defaults') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.smsAgentDefault ?? null, error: null }),
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  return { from: fromMock, insertConversationSpy, updateConversationSpy, insertMessageSpy, insertContactSpy }
}

function makeMsg(overrides: Partial<NormalizedWhatsAppMessage> = {}): NormalizedWhatsAppMessage {
  return {
    provider: 'zapi',
    providerId: 'prov-1',
    orgId: 'org-1',
    messageId: 'wamid-1',
    fromJid: '5511999998888@s.whatsapp.net',
    fromPhone: '+5511999998888',
    fromName: 'Jane',
    isGroup: false,
    isFromMe: false,
    timestamp: Date.now(),
    text: 'Hello there',
    messageType: 'text',
    rawMessage: {},
    ...overrides,
  }
}

const provider: ResolvedProvider = {
  id: 'prov-1',
  orgId: 'org-1',
  provider: 'zapi',
  displayName: 'Z-API',
  phoneNumber: null,
  status: 'connected',
  config: {},
  webhookSecret: null,
}

function makeAdapter(media: Awaited<ReturnType<WhatsAppAdapter['fetchMedia']>>): WhatsAppAdapter {
  return {
    normalize: vi.fn(),
    fetchMedia: vi.fn().mockResolvedValue(media),
  }
}

describe('processWhatsAppMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    insertNotificationMock.mockClear()
    routeWhatsAppReplyMock.mockClear()
    runAgentMock.mockClear()
  })

  it('new conversation: creates a contact, inserts the message, and notifies new_conversation', async () => {
    const db = buildMockSupabase({ existingConversation: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)
    const { processWhatsAppMessage } = await import('@/lib/whatsapp/process-message')

    await processWhatsAppMessage(makeMsg(), provider, makeAdapter([]))

    expect(db.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        channel: 'whatsapp',
        visitor_phone: '+5511999998888',
        contact_id: 'contact-new',
      }),
    )
    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        conversation_id: 'conv-new',
        role: 'user',
        content: 'Hello there',
        metadata: expect.objectContaining({ whatsapp_message_id: 'wamid-1' }),
      }),
    )
    expect(insertNotificationMock).toHaveBeenCalledWith(
      'org-1',
      'new_conversation',
      expect.objectContaining({ conversation_id: 'conv-new', channel: 'whatsapp' }),
    )
  })

  it('existing conversation: appends the message and notifies new_message', async () => {
    const db = buildMockSupabase({
      existingConversation: { id: 'conv-existing', bot_status: 'active', contact_id: 'contact-1' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)
    const { processWhatsAppMessage } = await import('@/lib/whatsapp/process-message')

    await processWhatsAppMessage(makeMsg({ messageId: 'wamid-2' }), provider, makeAdapter([]))

    expect(db.insertConversationSpy).not.toHaveBeenCalled()
    expect(db.updateConversationSpy).toHaveBeenCalled()
    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: 'conv-existing', role: 'user' }),
    )
    expect(insertNotificationMock).toHaveBeenCalledWith(
      'org-1',
      'new_message',
      expect.objectContaining({ conversation_id: 'conv-existing' }),
    )
  })

  it('duplicate whatsapp_message_id: skips both the message insert and the notification', async () => {
    const db = buildMockSupabase({
      existingConversation: { id: 'conv-existing', bot_status: 'active', contact_id: 'contact-1' },
      duplicateMessage: { id: 'msg-dup' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)
    const { processWhatsAppMessage } = await import('@/lib/whatsapp/process-message')

    await processWhatsAppMessage(makeMsg({ messageId: 'wamid-dup' }), provider, makeAdapter([]))

    expect(db.insertMessageSpy).not.toHaveBeenCalled()
    expect(insertNotificationMock).not.toHaveBeenCalled()
    expect(runAgentMock).not.toHaveBeenCalled()
  })

  it('bot_status=paused: message is still persisted but no agent runs', async () => {
    const db = buildMockSupabase({
      existingConversation: { id: 'conv-paused', bot_status: 'paused', contact_id: 'contact-1' },
      smsAgentDefault: { agent_id: 'agent-1' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)
    const { processWhatsAppMessage } = await import('@/lib/whatsapp/process-message')

    await processWhatsAppMessage(makeMsg({ messageId: 'wamid-3' }), provider, makeAdapter([]))

    expect(db.insertMessageSpy).toHaveBeenCalled()
    expect(runAgentMock).not.toHaveBeenCalled()
    expect(routeWhatsAppReplyMock).not.toHaveBeenCalled()
  })

  it('agent configured + active bot: invokes runAgent and routes the reply', async () => {
    const db = buildMockSupabase({
      existingConversation: { id: 'conv-existing', bot_status: 'active', contact_id: 'contact-1' },
      smsAgentDefault: { agent_id: 'agent-1' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)
    const { processWhatsAppMessage } = await import('@/lib/whatsapp/process-message')

    await processWhatsAppMessage(makeMsg({ messageId: 'wamid-4' }), provider, makeAdapter([]))

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', agentId: 'agent-1', channel: 'whatsapp' }),
    )
    expect(routeWhatsAppReplyMock).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', to: '+5511999998888', text: 'Agent reply' }),
    )
  })

  it('media message: fetchMedia is called with the resolved conversationId', async () => {
    const db = buildMockSupabase({ existingConversation: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)
    const adapter = makeAdapter([{ url: 'https://x/img.jpg', mime_type: 'image/jpeg' }])
    const { processWhatsAppMessage } = await import('@/lib/whatsapp/process-message')

    await processWhatsAppMessage(
      makeMsg({ messageId: 'wamid-media', messageType: 'image', text: '' }),
      provider,
      adapter,
    )

    expect(adapter.fetchMedia).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 'wamid-media' }),
      provider,
      'conv-new',
    )
    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        message_type: 'image',
        metadata: expect.objectContaining({
          media: [{ url: 'https://x/img.jpg', mime_type: 'image/jpeg' }],
        }),
      }),
    )
  })

  it('echoes and group messages are ignored entirely', async () => {
    const db = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)
    const { processWhatsAppMessage } = await import('@/lib/whatsapp/process-message')

    await processWhatsAppMessage(makeMsg({ isFromMe: true }), provider, makeAdapter([]))
    await processWhatsAppMessage(makeMsg({ isGroup: true }), provider, makeAdapter([]))

    expect(db.from).not.toHaveBeenCalled()
  })
})

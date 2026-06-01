import { beforeEach, describe, expect, it, vi } from 'vitest'

const normalizeInboundMock = vi.fn()
const findByChannelIdentityMock = vi.fn()
const attachChannelIdentityMock = vi.fn()
const runAgentMock = vi.fn()
const sendZernioDmMock = vi.fn()
const sendZernioCommentReplyMock = vi.fn()
const getProviderKeyMock = vi.fn()

vi.mock('@/lib/messaging/normalize-inbound', () => ({
  normalizeInbound: normalizeInboundMock,
}))

vi.mock('@/lib/contacts/server', () => ({
  findByChannelIdentity: findByChannelIdentityMock,
  attachChannelIdentity: attachChannelIdentityMock,
}))

vi.mock('@/lib/agent-runtime/run-agent', () => ({
  runAgent: runAgentMock,
}))

vi.mock('@/lib/zernio/send-dm', () => ({
  sendZernioDm: sendZernioDmMock,
}))

vi.mock('@/lib/zernio/send-comment-reply', () => ({
  sendZernioCommentReply: sendZernioCommentReplyMock,
}))

vi.mock('@/lib/integrations/get-provider-key', () => ({
  getProviderKey: getProviderKeyMock,
}))

const createServiceRoleClientMock = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: createServiceRoleClientMock,
}))

function chainSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error }),
  }
}

function makeSupabase({
  duplicateEvent = false,
  agentDefault = null as { agent_id: string } | null,
} = {}) {
  const eventInsert = vi.fn().mockResolvedValue({
    data: null,
    error: duplicateEvent ? { code: '23505', message: 'duplicate' } : null,
  })
  const contactInsert = vi.fn(() => chainSingle({ id: 'contact-1' }))
  const contactDeleteEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const contactDelete = vi.fn(() => ({ eq: contactDeleteEq }))
  const agentMaybeSingle = vi.fn().mockResolvedValue({ data: agentDefault, error: null })

  const from = vi.fn((table: string) => {
    if (table === 'zernio_webhook_events') return { insert: eventInsert }
    if (table === 'contacts') return { insert: contactInsert, delete: contactDelete }
    if (table === 'agent_channel_defaults') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: agentMaybeSingle,
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  return { from, eventInsert, contactInsert }
}

const messagePayload = {
  id: 'evt-1',
  event: 'message.received',
  timestamp: '2026-06-01T00:00:00Z',
  account: { id: 'acct-1', platform: 'instagram', username: 'brand' },
  conversation: {
    id: 'conv-1',
    platformConversationId: 'ig-thread-1',
    participantId: 'user-1',
    participantName: 'Ana',
    status: 'active',
  },
  message: {
    id: 'msg-1',
    conversationId: 'conv-1',
    platform: 'instagram',
    platformMessageId: 'ig-msg-1',
    direction: 'incoming',
    text: 'Oi',
    attachments: [],
    sender: { id: 'user-1', name: 'Ana', username: 'ana' },
    sentAt: '2026-06-01T00:00:00Z',
    isRead: false,
  },
} as const

describe('processZernioEvent', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    normalizeInboundMock.mockResolvedValue({
      conversationId: 'xphere-conv-1',
      isNew: true,
      existing: null,
      messageId: 'xphere-msg-1',
      duplicate: false,
    })
    findByChannelIdentityMock.mockResolvedValue(null)
    attachChannelIdentityMock.mockResolvedValue({ contact_id: 'contact-1' })
    runAgentMock.mockResolvedValue({ text: 'Resposta do agente' })
    sendZernioDmMock.mockResolvedValue({ messageId: 'out-1' })
    sendZernioCommentReplyMock.mockResolvedValue({ commentId: 'comment-reply-1' })
    getProviderKeyMock.mockResolvedValue('ze_key')
  })

  it('maps message.received into contact identity + zernio conversation metadata', async () => {
    const db = makeSupabase()
    createServiceRoleClientMock.mockReturnValue(db)

    const { processZernioEvent } = await import('@/lib/zernio/process-event')
    await processZernioEvent(messagePayload, 'org-1')

    expect(db.eventInsert).toHaveBeenCalledWith({
      organization_id: 'org-1',
      event_id: 'evt-1',
      event_type: 'message.received',
    })
    expect(findByChannelIdentityMock).toHaveBeenCalledWith(db, 'org-1', 'zernio', 'instagram:acct-1:user-1')
    expect(db.contactInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        name: 'Ana',
        source: 'instagram',
        identity_status: 'channel_only',
      }),
    )
    expect(normalizeInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        channel: 'zernio',
        match: { by: 'metadata', keys: { zernio_conversation_id: 'conv-1' } },
        createPayload: expect.objectContaining({
          channel_metadata: expect.objectContaining({
            thread_type: 'dm',
            account_id: 'acct-1',
            zernio_conversation_id: 'conv-1',
          }),
        }),
        idempotencyMetadata: { zernio_message_id: 'msg-1' },
      }),
    )
  })

  it('skips duplicate webhook event ids before normalizing', async () => {
    const db = makeSupabase({ duplicateEvent: true })
    createServiceRoleClientMock.mockReturnValue(db)

    const { processZernioEvent } = await import('@/lib/zernio/process-event')
    await processZernioEvent(messagePayload, 'org-1')

    expect(normalizeInboundMock).not.toHaveBeenCalled()
  })

  it('runs the zernio agent and sends a DM reply when a channel default exists', async () => {
    const db = makeSupabase({ agentDefault: { agent_id: 'agent-1' } })
    createServiceRoleClientMock.mockReturnValue(db)

    const { processZernioEvent } = await import('@/lib/zernio/process-event')
    await processZernioEvent(messagePayload, 'org-1')

    expect(runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        agentId: 'agent-1',
        channel: 'zernio',
        userMessage: 'Oi',
        conversationId: 'xphere-conv-1',
      }),
    )
    expect(sendZernioDmMock).toHaveBeenCalledWith('conv-1', 'acct-1', 'Resposta do agente', 'ze_key')
  })

  it('maps comment.received into a comment thread and can reply through comments API', async () => {
    const db = makeSupabase({ agentDefault: { agent_id: 'agent-1' } })
    createServiceRoleClientMock.mockReturnValue(db)

    const payload = {
      id: 'evt-comment-1',
      event: 'comment.received',
      timestamp: '2026-06-01T00:00:00Z',
      account: { id: 'acct-1', platform: 'instagram', username: 'brand' },
      post: { id: null, platformPostId: 'post-platform-1' },
      comment: {
        id: 'comment-1',
        postId: null,
        platformPostId: 'post-platform-1',
        platform: 'instagram',
        text: 'Quero info',
        author: { id: 'user-1', username: 'ana', name: 'Ana' },
        createdAt: '2026-06-01T00:00:00Z',
        isReply: false,
        parentCommentId: null,
      },
    } as const

    const { processZernioEvent } = await import('@/lib/zernio/process-event')
    await processZernioEvent(payload, 'org-1')

    expect(normalizeInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        match: { by: 'metadata', keys: { zernio_comment_id: 'comment-1' } },
        createPayload: expect.objectContaining({
          channel_metadata: expect.objectContaining({
            thread_type: 'comment',
            zernio_post_id: 'post-platform-1',
            zernio_comment_id: 'comment-1',
            account_id: 'acct-1',
          }),
        }),
        idempotencyMetadata: { zernio_comment_id: 'comment-1' },
      }),
    )
    expect(sendZernioCommentReplyMock).toHaveBeenCalledWith({
      postId: 'post-platform-1',
      accountId: 'acct-1',
      commentId: 'comment-1',
      text: 'Resposta do agente',
      apiKey: 'ze_key',
    })
  })
})

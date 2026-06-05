import { beforeEach, describe, expect, it, vi } from 'vitest'

const normalizeInboundMock = vi.fn()
const findByChannelIdentityMock = vi.fn()
const attachChannelIdentityMock = vi.fn()
const runAgentMock = vi.fn()
const sendZernioDmMock = vi.fn()
const sendZernioCommentReplyMock = vi.fn()
const getProviderKeyMock = vi.fn()
const storeMediaFromUrlMock = vi.fn()

vi.mock('@/lib/messaging/normalize-inbound', () => ({
  normalizeInbound: normalizeInboundMock,
}))

vi.mock('@/lib/contacts/server', () => ({
  findByChannelIdentity: findByChannelIdentityMock,
  attachChannelIdentity: attachChannelIdentityMock,
  backfillContactPhone: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/agent-runtime/run-agent', () => ({
  runAgent: runAgentMock,
}))

vi.mock('@/lib/chat/store-media', () => ({
  storeMediaFromUrl: storeMediaFromUrlMock,
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
  phoneHit = null as { id: string } | null,
  existingConversation = null as { id: string; contact_id: string | null; last_message_at: string | null } | null,
  duplicateMessage = false,
} = {}) {
  const eventInsert = vi.fn().mockResolvedValue({
    data: null,
    error: duplicateEvent ? { code: '23505', message: 'duplicate' } : null,
  })
  const contactInsert = vi.fn(() => chainSingle({ id: 'contact-1' }))
  const contactDeleteEq = vi.fn().mockResolvedValue({ data: null, error: null })
  const contactDelete = vi.fn(() => ({ eq: contactDeleteEq }))
  const contactLookup = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    neq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: phoneHit, error: null }),
  }
  const conversationInsert = vi.fn(() => chainSingle({ id: 'xphere-conv-out' }))
  const conversationUpdate = vi.fn(() => ({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  }))
  const messageInsert = vi.fn().mockResolvedValue({ data: null, error: null })
  const messageMaybeSingle = vi.fn().mockResolvedValue({
    data: duplicateMessage ? { id: 'msg-dup' } : null,
    error: null,
  })
  const agentMaybeSingle = vi.fn().mockResolvedValue({ data: agentDefault, error: null })
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null })

  const from = vi.fn((table: string) => {
    if (table === 'zernio_webhook_events') return { insert: eventInsert }
    if (table === 'contacts') return { ...contactLookup, insert: contactInsert, delete: contactDelete }
    if (table === 'conversations') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: existingConversation, error: null }),
        insert: conversationInsert,
        update: conversationUpdate,
      }
    }
    if (table === 'conversation_messages') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: messageMaybeSingle,
        insert: messageInsert,
      }
    }
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

  return { from, rpc, eventInsert, contactInsert, conversationUpdate, messageInsert }
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
    storeMediaFromUrlMock.mockResolvedValue(null)
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
        channel: 'zernio_instagram',
        match: { by: 'metadata', keys: { account_id: 'acct-1', zernio_conversation_id: 'conv-1' } },
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

  it('atomically merges a channel-only Zernio contact into a phone-matched CRM contact', async () => {
    const db = makeSupabase({ phoneHit: { id: 'crm-contact-1' } })
    createServiceRoleClientMock.mockReturnValue(db)
    findByChannelIdentityMock.mockResolvedValueOnce({
      contact_id: 'channel-contact-1',
      identity_status: 'channel_only',
    })

    const payload = {
      ...messagePayload,
      account: { id: 'acct-1', platform: 'whatsapp', username: '+1 508-801-8190' },
      conversation: {
        ...messagePayload.conversation,
        contactId: 'ze-contact-1',
        participantId: '5517981259735',
        participantUsername: '+5517981259735',
      },
      message: {
        ...messagePayload.message,
        platform: 'whatsapp',
        sender: {
          id: '5517981259735',
          name: 'Ellen Laurino',
          phoneNumber: '+5517981259735',
          contactId: 'ze-contact-1',
        },
      },
    } as const

    const { processZernioEvent } = await import('@/lib/zernio/process-event')
    await processZernioEvent(payload, 'org-1')

    expect(db.rpc).toHaveBeenCalledWith('merge_zernio_channel_only_contact', {
      p_org_id: 'org-1',
      p_duplicate_contact_id: 'channel-contact-1',
      p_survivor_contact_id: 'crm-contact-1',
      p_zernio_external_ids: [
        'whatsapp:acct-1:contact:ze-contact-1',
        'whatsapp:acct-1:+5517981259735',
      ],
    })
    expect(normalizeInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        createPayload: expect.objectContaining({ contact_id: 'crm-contact-1' }),
        updatePayload: expect.objectContaining({ contact_id: 'crm-contact-1' }),
      }),
    )
  })

  it('re-hosts Zernio media when an authenticated attachment URL is received', async () => {
    storeMediaFromUrlMock.mockResolvedValue({
      publicUrl: 'https://xphere.app/storage/audio.ogg',
      size: 42,
      filename: 'audio.ogg',
    })
    const db = makeSupabase()
    createServiceRoleClientMock.mockReturnValue(db)
    const payload = {
      ...messagePayload,
      account: { id: 'acct-1', platform: 'whatsapp', username: '+1 508-801-8190' },
      message: {
        ...messagePayload.message,
        platform: 'whatsapp',
        text: null,
        attachments: [
          {
            type: 'audio',
            url: 'https://zernio.com/api/v1/whatsapp/media/media-1?accountId=acct-1',
            payload: { id: 'media-1', mimeType: 'audio/ogg; codecs=opus' },
          },
        ],
        sender: {
          id: '5517981259735',
          name: 'Ellen Laurino',
          phoneNumber: '+5517981259735',
          contactId: 'ze-contact-1',
        },
      },
    } as const

    const { processZernioEvent } = await import('@/lib/zernio/process-event')
    await processZernioEvent(payload, 'org-1')

    expect(storeMediaFromUrlMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: 'https://zernio.com/api/v1/whatsapp/media/media-1?accountId=acct-1',
        mimeType: 'audio/ogg; codecs=opus',
        authHeaders: { Authorization: 'Bearer ze_key' },
        orgId: 'org-1',
        conversationId: 'conv-1',
        messageId: 'msg-1',
        idx: 0,
      }),
    )
    expect(normalizeInboundMock).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.objectContaining({
          message_type: 'audio',
          metadata: expect.objectContaining({
            media: [
              expect.objectContaining({
                url: 'https://xphere.app/storage/audio.ogg',
                original_url: 'https://zernio.com/api/v1/whatsapp/media/media-1?accountId=acct-1',
                mime_type: 'audio/ogg; codecs=opus',
              }),
            ],
          }),
        }),
      }),
    )
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
        channel: 'instagram',
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

  it('persists outgoing message.received events as assistant history without running the agent', async () => {
    const db = makeSupabase({
      existingConversation: {
        id: 'xphere-conv-1',
        contact_id: 'contact-1',
        last_message_at: '2026-06-05T17:00:00.000Z',
      },
    })
    createServiceRoleClientMock.mockReturnValue(db)

    const payload = {
      ...messagePayload,
      id: 'evt-out-1',
      timestamp: '2026-06-05T17:13:00.000Z',
      account: { id: 'acct-wa-1', platform: 'whatsapp', username: '+1 508-801-8190' },
      conversation: {
        ...messagePayload.conversation,
        id: 'zconv-wa-1',
        platformConversationId: 'wa-thread-1',
        participantId: '+14439261289',
        participantName: 'Adriane Shahraki',
      },
      message: {
        ...messagePayload.message,
        id: 'zmsg-out-1',
        conversationId: 'zconv-wa-1',
        platform: 'whatsapp',
        platformMessageId: 'wamid.out.1',
        direction: 'outgoing',
        text: 'Claro que sim',
        sender: { id: 'operator-1', name: 'Operator' },
        sentAt: '2026-06-05T17:13:00.000Z',
        isRead: true,
      },
    } as const

    const { processZernioEvent } = await import('@/lib/zernio/process-event')
    await processZernioEvent(payload, 'org-1')

    expect(normalizeInboundMock).not.toHaveBeenCalled()
    expect(runAgentMock).not.toHaveBeenCalled()
    expect(db.messageInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        conversation_id: 'xphere-conv-1',
        role: 'assistant',
        content: 'Claro que sim',
        channel: 'zernio_whatsapp',
        metadata: expect.objectContaining({
          direction: 'outgoing',
          source: 'zernio_echo',
          zernio_message_id: 'zmsg-out-1',
        }),
      }),
    )
    expect(db.conversationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        last_message: 'Claro que sim',
        last_message_at: '2026-06-05T17:13:00.000Z',
      }),
    )
  })
})

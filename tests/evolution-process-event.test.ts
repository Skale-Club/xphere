// tests/evolution-process-event.test.ts
// SEED-004 — Evolution Go inbound webhook → process-event normalization.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mock @/lib/evolution/credentials --------------------------------------
vi.mock('@/lib/evolution/credentials', () => ({
  resolveEvolutionInstanceByName: vi.fn(),
}))

// ---- Mock supabase admin client --------------------------------------------
vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: vi.fn(),
}))

// ---- Mock runAgent + sendWhatsappMessage ----------------------------------
vi.mock('@/lib/agent-runtime/run-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({
    text: 'Hi back from the agent!',
    usage: { tokensIn: 5, tokensOut: 3 },
    invocationId: 'inv-1',
    traceId: 'trace-1',
    status: 'success',
  }),
}))
vi.mock('@/lib/evolution/send-message', () => ({
  sendWhatsappMessage: vi.fn().mockResolvedValue({ ok: true, messageIds: ['evo-out-1'] }),
}))

// ---- Mock contact resolution helpers (real impls query tables the mock
// doesn't model; without this the create path throws and silently bails) ----
vi.mock('@/lib/contacts/server', () => ({
  findByChannelIdentity: vi.fn().mockResolvedValue(null),
  findByPhone: vi.fn().mockResolvedValue(null),
  attachChannelIdentity: vi.fn().mockResolvedValue(undefined),
}))

import { resolveEvolutionInstanceByName } from '@/lib/evolution/credentials'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { sendWhatsappMessage } from '@/lib/evolution/send-message'

// ---- Supabase mock builder -------------------------------------------------
interface MockOpts {
  existingConversation?: { id: string; bot_status?: string; contact_id?: string | null } | null
  existingContact?: { id: string } | null
  duplicateMessage?: boolean
  agentDefault?: { agent_id: string } | null
}

function buildMockSupabase(opts: MockOpts = {}) {
  const insertConversationSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'conv-new' }, error: null }),
  })
  const insertContactSpy = vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'contact-new' }, error: null }),
  })
  const updateConversationSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })
  // Chainable: normalizeInbound does `.insert(...).select('id').single()`.
  const insertMessageSpy = vi.fn(() => ({
    select: vi.fn(() => ({
      single: vi.fn().mockResolvedValue({ data: { id: 'evo-msg-new' }, error: null }),
    })),
  }))
  const updateInstanceSpy = vi.fn().mockReturnValue({
    eq: vi.fn().mockResolvedValue({ data: null, error: null }),
  })

  const fromMock = vi.fn((table: string) => {
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

    if (table === 'contacts') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        neq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.existingContact ?? null, error: null }),
        insert: insertContactSpy,
      }
    }

    if (table === 'conversation_messages') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        contains: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: opts.duplicateMessage ? { id: 'msg-dup' } : null,
          error: null,
        }),
        insert: insertMessageSpy,
      }
    }

    if (table === 'agent_channel_defaults') {
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.agentDefault ?? null, error: null }),
      }
    }

    if (table === 'evolution_instances') {
      return { update: updateInstanceSpy }
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
    insertContactSpy,
    updateConversationSpy,
    insertMessageSpy,
    updateInstanceSpy,
  }
}

// ---- Helpers ---------------------------------------------------------------

function makeUpsertPayload(overrides: Record<string, unknown> = {}) {
  return {
    event: 'messages.upsert',
    instance: 'my-org-whatsapp',
    data: {
      key: {
        id: 'EVO_MSG_001',
        remoteJid: '5511999998888@s.whatsapp.net',
        fromMe: false,
      },
      pushName: 'Alice',
      message: { conversation: 'Hello operator' },
      messageType: 'conversation',
      messageTimestamp: 1700000000,
      ...overrides,
    },
  }
}

const INSTANCE = {
  id: 'inst-1',
  org_id: 'org-1',
  instance_name: 'my-org-whatsapp',
  base_url: 'https://evo.example.com',
  status: 'connected' as const,
  phone_number: '+15553334444',
  config: { baseUrl: 'https://evo.example.com', token: 't' },
  webhookSecret: null,
}

// ---- Tests -----------------------------------------------------------------

describe('Evolution process-event — messages.upsert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates a new conversation, contact, and inbound message for a fresh sender', async () => {
    vi.mocked(resolveEvolutionInstanceByName).mockResolvedValue(INSTANCE)
    const db = buildMockSupabase({ existingContact: null, existingConversation: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processEvolutionEvent } = await import('@/lib/evolution/process-event')
    await processEvolutionEvent(makeUpsertPayload())

    expect(db.insertContactSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        phone: '+5511999998888',
        source: 'whatsapp',
      }),
    )
    expect(db.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        org_id: 'org-1',
        channel: 'whatsapp',
        visitor_phone: '+5511999998888',
        evolution_instance_id: 'inst-1',
      }),
    )
    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: 'Hello operator',
        metadata: expect.objectContaining({
          channel: 'whatsapp',
          evolution_message_id: 'EVO_MSG_001',
        }),
      }),
    )
  })

  it('skips messages with fromMe=true (echo)', async () => {
    vi.mocked(resolveEvolutionInstanceByName).mockResolvedValue(INSTANCE)
    const db = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const payload = makeUpsertPayload({
      key: {
        id: 'EVO_MSG_ECHO',
        remoteJid: '5511999998888@s.whatsapp.net',
        fromMe: true,
      },
    })

    const { processEvolutionEvent } = await import('@/lib/evolution/process-event')
    await processEvolutionEvent(payload)

    expect(db.insertConversationSpy).not.toHaveBeenCalled()
    expect(db.insertMessageSpy).not.toHaveBeenCalled()
  })

  it('skips group-JID messages from inbound auto-reply pipeline', async () => {
    vi.mocked(resolveEvolutionInstanceByName).mockResolvedValue(INSTANCE)
    const db = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const payload = makeUpsertPayload({
      key: {
        id: 'EVO_GROUP_001',
        remoteJid: '120363012345678901@g.us',
        fromMe: false,
        participant: '5511999998888@s.whatsapp.net',
      },
    })

    const { processEvolutionEvent } = await import('@/lib/evolution/process-event')
    await processEvolutionEvent(payload)

    expect(db.insertConversationSpy).not.toHaveBeenCalled()
    expect(db.insertMessageSpy).not.toHaveBeenCalled()
  })

  it('de-duplicates by Evolution message id', async () => {
    vi.mocked(resolveEvolutionInstanceByName).mockResolvedValue(INSTANCE)
    const db = buildMockSupabase({
      existingConversation: { id: 'conv-existing', bot_status: 'active', contact_id: 'c-1' },
      duplicateMessage: true,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processEvolutionEvent } = await import('@/lib/evolution/process-event')
    await processEvolutionEvent(makeUpsertPayload())

    expect(db.insertMessageSpy).not.toHaveBeenCalled()
    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
  })

  it('invokes runAgent and sendWhatsappMessage when an agent is configured', async () => {
    vi.mocked(resolveEvolutionInstanceByName).mockResolvedValue(INSTANCE)
    const db = buildMockSupabase({
      existingConversation: null,
      existingContact: null,
      agentDefault: { agent_id: 'agent-wa-1' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processEvolutionEvent } = await import('@/lib/evolution/process-event')
    await processEvolutionEvent(makeUpsertPayload())

    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        agentId: 'agent-wa-1',
        channel: 'whatsapp',
        userMessage: 'Hello operator',
        stream: false,
      }),
    )
    expect(vi.mocked(sendWhatsappMessage)).toHaveBeenCalledWith(
      expect.objectContaining({
        orgId: 'org-1',
        to: '+5511999998888',
        text: 'Hi back from the agent!',
        instanceName: 'my-org-whatsapp',
      }),
    )
  })

  it('skips agent invocation when bot_status is paused', async () => {
    vi.mocked(resolveEvolutionInstanceByName).mockResolvedValue(INSTANCE)
    const db = buildMockSupabase({
      existingConversation: { id: 'conv-paused', bot_status: 'paused', contact_id: 'c-1' },
      agentDefault: { agent_id: 'agent-wa-1' },
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processEvolutionEvent } = await import('@/lib/evolution/process-event')
    await processEvolutionEvent(makeUpsertPayload())

    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
    expect(vi.mocked(sendWhatsappMessage)).not.toHaveBeenCalled()
  })

  it('ignores events when no instance matches the name', async () => {
    vi.mocked(resolveEvolutionInstanceByName).mockResolvedValue(null)
    const db = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processEvolutionEvent } = await import('@/lib/evolution/process-event')
    await processEvolutionEvent(makeUpsertPayload())

    expect(db.insertConversationSpy).not.toHaveBeenCalled()
  })
})

describe('Evolution process-event — connection.update', () => {
  beforeEach(() => vi.clearAllMocks())

  it('updates instance status to connected when state=open', async () => {
    vi.mocked(resolveEvolutionInstanceByName).mockResolvedValue(INSTANCE)
    const db = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processEvolutionEvent } = await import('@/lib/evolution/process-event')
    await processEvolutionEvent({
      event: 'connection.update',
      instance: 'my-org-whatsapp',
      data: {
        state: 'open',
        instance: { wuid: '5511999998888@s.whatsapp.net' },
      },
    })

    expect(db.updateInstanceSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'connected',
        phone_number: '+5511999998888',
      }),
    )
  })

  it('maps state=qr → qr_pending', async () => {
    vi.mocked(resolveEvolutionInstanceByName).mockResolvedValue(INSTANCE)
    const db = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processEvolutionEvent } = await import('@/lib/evolution/process-event')
    await processEvolutionEvent({
      event: 'connection.update',
      instance: 'my-org-whatsapp',
      data: { state: 'qr' },
    })

    expect(db.updateInstanceSpy).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'qr_pending' }),
    )
  })
})

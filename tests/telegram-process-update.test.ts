// tests/telegram-process-update.test.ts
// SEED-034 — Telegram inbound webhook → process-update normalization.
// Focused coverage for the private-chat automation pipeline (text messages).

import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: vi.fn() }))
vi.mock('@/lib/crypto', () => ({ decrypt: vi.fn().mockResolvedValue('bot-token-decrypted') }))
vi.mock('@/lib/agent-runtime/run-agent', () => ({
  runAgent: vi.fn().mockResolvedValue({ text: 'Reply from agent', status: 'success' }),
}))
vi.mock('@/lib/telegram/send-message', () => ({
  sendTelegramReply: vi.fn().mockResolvedValue({ ok: true, messageIds: [1] }),
}))
vi.mock('@/lib/telegram/client', () => ({
  sendTelegramMessage: vi.fn().mockResolvedValue({ ok: true, messageId: 1 }),
  getFile: vi.fn().mockResolvedValue(null),
  getFileDownloadUrl: vi.fn().mockReturnValue('https://download'),
}))
vi.mock('@/lib/telegram/storage', () => ({ storeTelegramMedia: vi.fn().mockResolvedValue(null) }))
vi.mock('@/lib/contacts/server', () => ({
  findByChannelIdentity: vi.fn().mockResolvedValue(null),
  findByPhone: vi.fn().mockResolvedValue(null),
  attachChannelIdentity: vi.fn().mockResolvedValue(undefined),
}))

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { sendTelegramReply } from '@/lib/telegram/send-message'

interface MockOpts {
  existingConversation?: { id: string; bot_status?: string; contact_id?: string | null } | null
  existingContact?: { id: string } | null
  duplicateMessage?: boolean
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
  const insertMessageSpy = vi.fn().mockResolvedValue({ data: null, error: null })

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
        maybeSingle: vi.fn().mockResolvedValue({ data: opts.duplicateMessage ? { id: 'm-dup' } : null, error: null }),
        insert: insertMessageSpy,
      }
    }
    return {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    }
  })

  return { from: fromMock, insertConversationSpy, insertContactSpy, updateConversationSpy, insertMessageSpy }
}

const BOT = {
  id: 'bot-1',
  org_id: 'org-1',
  bot_token_encrypted: 'enc',
  automation_enabled: true,
  agent_id: 'agent-tg',
}

function makeUpdate(overrides: Record<string, unknown> = {}) {
  return {
    message: {
      message_id: 555,
      chat: { id: 12345, type: 'private' },
      from: { id: 999, first_name: 'Tg', username: 'tguser' },
      text: 'Hello from telegram',
      ...overrides,
    },
  }
}

describe('Telegram process-update — private chat pipeline', () => {
  beforeEach(() => vi.clearAllMocks())

  it('creates conversation + contact + message for a fresh sender', async () => {
    const db = buildMockSupabase({ existingConversation: null, existingContact: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processTelegramUpdate } = await import('@/lib/telegram/process-update')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processTelegramUpdate(makeUpdate() as any, BOT)

    expect(db.insertContactSpy).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'org-1', phone: '12345', source: 'telegram' }),
    )
    expect(db.insertConversationSpy).toHaveBeenCalledWith(
      expect.objectContaining({ org_id: 'org-1', channel: 'telegram', visitor_phone: '12345' }),
    )
    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        role: 'user',
        content: 'Hello from telegram',
        metadata: expect.objectContaining({ channel: 'telegram', telegram_message_id: 555 }),
      }),
    )
  })

  it('appends to an existing conversation (no new conversation insert) and bumps last_message', async () => {
    const db = buildMockSupabase({ existingConversation: { id: 'conv-existing', bot_status: 'active', contact_id: 'c1' } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processTelegramUpdate } = await import('@/lib/telegram/process-update')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processTelegramUpdate(makeUpdate() as any, BOT)

    expect(db.insertConversationSpy).not.toHaveBeenCalled()
    expect(db.insertMessageSpy).toHaveBeenCalledWith(
      expect.objectContaining({ conversation_id: 'conv-existing', role: 'user' }),
    )
    expect(db.updateConversationSpy).toHaveBeenCalled()
  })

  it('de-duplicates by telegram_message_id', async () => {
    const db = buildMockSupabase({
      existingConversation: { id: 'conv-existing', bot_status: 'active', contact_id: 'c1' },
      duplicateMessage: true,
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processTelegramUpdate } = await import('@/lib/telegram/process-update')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processTelegramUpdate(makeUpdate() as any, BOT)

    expect(db.insertMessageSpy).not.toHaveBeenCalled()
    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
  })

  it('invokes runAgent + sendTelegramReply when bot is active', async () => {
    const db = buildMockSupabase({ existingConversation: null, existingContact: null })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processTelegramUpdate } = await import('@/lib/telegram/process-update')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processTelegramUpdate(makeUpdate() as any, BOT)

    expect(vi.mocked(runAgent)).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', agentId: 'agent-tg', channel: 'telegram', stream: false }),
    )
    expect(vi.mocked(sendTelegramReply)).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: 'org-1', chatId: '12345', text: 'Reply from agent' }),
    )
  })

  it('skips agent when bot_status is paused', async () => {
    const db = buildMockSupabase({ existingConversation: { id: 'conv-p', bot_status: 'paused', contact_id: 'c1' } })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processTelegramUpdate } = await import('@/lib/telegram/process-update')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processTelegramUpdate(makeUpdate() as any, BOT)

    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
  })

  it('ignores non-private chats', async () => {
    const db = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processTelegramUpdate } = await import('@/lib/telegram/process-update')
    await processTelegramUpdate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      makeUpdate({ chat: { id: 12345, type: 'group' }, text: 'hi' }) as any,
      BOT,
    )

    expect(db.insertConversationSpy).not.toHaveBeenCalled()
    expect(db.insertMessageSpy).not.toHaveBeenCalled()
  })

  it('does nothing when automation is disabled', async () => {
    const db = buildMockSupabase()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(createServiceRoleClient).mockReturnValue(db as any)

    const { processTelegramUpdate } = await import('@/lib/telegram/process-update')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await processTelegramUpdate(makeUpdate() as any, { ...BOT, automation_enabled: false })

    expect(vi.mocked(runAgent)).not.toHaveBeenCalled()
    expect(db.insertMessageSpy).not.toHaveBeenCalled()
  })
})

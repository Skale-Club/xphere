import { describe, it, expect, vi, beforeEach } from 'vitest'

// ---- Mocks (hoisted — declared before imports) ----
vi.mock('@/lib/crypto', () => ({
  decrypt: vi.fn().mockResolvedValue('decrypted-secret'),
}))
vi.mock('@/lib/meta/send-message', () => ({
  sendMetaMessage: vi.fn(),
}))
vi.mock('@/lib/ghl/send-message', () => ({
  sendGhlMessage: vi.fn(),
  channelToGhlType: vi.fn().mockReturnValue('SMS'),
}))
vi.mock('@/lib/twilio/send-sms', () => ({
  sendSms: vi.fn(),
}))
vi.mock('@/lib/email/resend', () => ({
  sendTenantEmail: vi.fn(),
}))
vi.mock('@/lib/evolution/send-message', () => ({
  sendWhatsappMessage: vi.fn(),
}))
vi.mock('@/lib/whatsapp/cloud/send-text', () => ({
  sendCloudText: vi.fn(),
}))
vi.mock('@/lib/whatsapp/cloud/resolve-account', () => ({
  getActiveCloudAccount: vi.fn(),
}))
vi.mock('@/lib/telegram/send-message', () => ({
  sendTelegramReply: vi.fn(),
}))

import { dispatchOutbound, type OutboundConversation } from '@/lib/messaging/dispatch-outbound'
import { sendMetaMessage } from '@/lib/meta/send-message'
import { sendGhlMessage } from '@/lib/ghl/send-message'
import { sendSms } from '@/lib/twilio/send-sms'
import { sendTenantEmail } from '@/lib/email/resend'
import { sendWhatsappMessage } from '@/lib/evolution/send-message'
import { sendCloudText } from '@/lib/whatsapp/cloud/send-text'
import { getActiveCloudAccount } from '@/lib/whatsapp/cloud/resolve-account'
import { sendTelegramReply } from '@/lib/telegram/send-message'

// Minimal Supabase mock supporting the two credential lookups dispatchOutbound
// performs: ghl_channels and meta_channels (select…eq…eq…eq…maybeSingle).
function buildSupabase({
  ghlChannel = null as Record<string, unknown> | null,
  metaChannel = null as Record<string, unknown> | null,
} = {}) {
  const make = (data: unknown) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  })
  return {
    from: vi.fn((table: string) => {
      if (table === 'ghl_channels') return make(ghlChannel)
      if (table === 'meta_channels') return make(metaChannel)
      return make(null)
    }),
  }
}

function conv(overrides: Partial<OutboundConversation> = {}): OutboundConversation {
  return {
    id: 'conv-1',
    org_id: 'org-1',
    channel: 'widget',
    channel_metadata: {},
    visitor_phone: null,
    visitor_email: null,
    phone_number_id: null,
    contact_id: null,
    ...overrides,
  }
}

function opts(extra: Record<string, unknown> = {}) {
  return { content: 'hello', supabase: buildSupabase() as never, ...extra }
}

describe('dispatchOutbound — channel→provider routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Re-apply default resolved values cleared above.
    vi.mocked(sendGhlMessage).mockResolvedValue(undefined as never)
    vi.mocked(sendSms).mockResolvedValue(undefined as never)
    vi.mocked(sendTenantEmail).mockResolvedValue({} as never)
    vi.mocked(sendWhatsappMessage).mockResolvedValue({ ok: true, messageIds: [1] } as never)
    vi.mocked(sendCloudText).mockResolvedValue({ ok: true } as never)
    vi.mocked(sendTelegramReply).mockResolvedValue({ ok: true, messageIds: [1] } as never)
    vi.mocked(sendMetaMessage).mockResolvedValue({ messageId: 'mid-1' } as never)
  })

  // ── No-provider channels ──────────────────────────────────────────────────
  it('widget: resolves ok and calls no provider', async () => {
    const res = await dispatchOutbound(conv({ channel: 'widget' }), opts())
    expect(res).toEqual({ ok: true })
    expect(sendMetaMessage).not.toHaveBeenCalled()
    expect(sendTelegramReply).not.toHaveBeenCalled()
  })

  it('manual/voice (unhandled): resolves ok without sending', async () => {
    const res = await dispatchOutbound(conv({ channel: 'voice' }), opts())
    expect(res).toEqual({ ok: true })
  })

  // ── Telegram (new branch) ──────────────────────────────────────────────────
  it('telegram: sends via bot using telegram_chat_id, WITHOUT conversationId', async () => {
    const res = await dispatchOutbound(
      conv({ channel: 'telegram', channel_metadata: { telegram_chat_id: 'chat-9' } }),
      opts(),
    )
    expect(res).toEqual({ ok: true })
    expect(sendTelegramReply).toHaveBeenCalledWith({ orgId: 'org-1', chatId: 'chat-9', text: 'hello' })
    // conversationId must be omitted so the caller's row isn't double-persisted.
    expect(vi.mocked(sendTelegramReply).mock.calls[0][0]).not.toHaveProperty('conversationId')
  })

  it('telegram: falls back to visitor_phone for the chat id (Phase 107 back-compat)', async () => {
    await dispatchOutbound(
      conv({ channel: 'telegram', channel_metadata: {}, visitor_phone: '12345' }),
      opts(),
    )
    expect(sendTelegramReply).toHaveBeenCalledWith({ orgId: 'org-1', chatId: '12345', text: 'hello' })
  })

  it('telegram: no recipient → 400 telegram_no_recipient, no send', async () => {
    const res = await dispatchOutbound(conv({ channel: 'telegram', channel_metadata: {} }), opts())
    expect(res).toEqual({ ok: false, status: 400, body: { error: 'telegram_no_recipient' } })
    expect(sendTelegramReply).not.toHaveBeenCalled()
  })

  it('telegram: provider failure → 502 telegram_send_failed', async () => {
    vi.mocked(sendTelegramReply).mockResolvedValue({ ok: false, messageIds: [], error: 'boom' } as never)
    const res = await dispatchOutbound(
      conv({ channel: 'telegram', channel_metadata: { telegram_chat_id: 'c' } }),
      opts(),
    )
    expect(res).toEqual({ ok: false, status: 502, body: { error: 'telegram_send_failed', message: 'boom' } })
  })

  // ── SMS (Twilio) ───────────────────────────────────────────────────────────
  it('sms: sends via Twilio to visitor_phone', async () => {
    const res = await dispatchOutbound(conv({ channel: 'sms', visitor_phone: '+15550001' }), opts())
    expect(res).toEqual({ ok: true })
    expect(sendSms).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendSms).mock.calls[0][0]).toMatchObject({ to: '+15550001', body: 'hello' })
  })

  it('sms: operator prefix is prepended to the body', async () => {
    await dispatchOutbound(
      conv({ channel: 'sms', visitor_phone: '+15550001' }),
      opts({ operatorName: 'Bob' }),
    )
    expect(vi.mocked(sendSms).mock.calls[0][0]).toMatchObject({ body: 'Bob:\nhello' })
  })

  it('sms: no recipient → 400 sms_no_recipient', async () => {
    const res = await dispatchOutbound(conv({ channel: 'sms' }), opts())
    expect(res).toEqual({ ok: false, status: 400, body: { error: 'sms_no_recipient' } })
    expect(sendSms).not.toHaveBeenCalled()
  })

  // ── Email (Resend) ─────────────────────────────────────────────────────────
  it('email: sends via tenant Resend, escaping HTML', async () => {
    const res = await dispatchOutbound(
      conv({ channel: 'email', visitor_email: 'a@b.com' }),
      opts({ content: 'a<b&c', emailSubject: 'Hi' }),
    )
    expect(res).toEqual({ ok: true })
    expect(sendTenantEmail).toHaveBeenCalledTimes(1)
    const [org, to, subject, html] = vi.mocked(sendTenantEmail).mock.calls[0]
    expect(org).toBe('org-1')
    expect(to).toBe('a@b.com')
    expect(subject).toBe('Hi')
    expect(html).toContain('a&lt;b&amp;c')
  })

  it('email: no recipient → 400 email_no_recipient', async () => {
    const res = await dispatchOutbound(conv({ channel: 'email' }), opts())
    expect(res).toEqual({ ok: false, status: 400, body: { error: 'email_no_recipient' } })
  })

  it('email: provider error → 502 email_send_failed', async () => {
    vi.mocked(sendTenantEmail).mockResolvedValue({ error: 'nope' } as never)
    const res = await dispatchOutbound(
      conv({ channel: 'email', visitor_email: 'a@b.com' }),
      opts(),
    )
    expect(res).toEqual({ ok: false, status: 502, body: { error: 'email_send_failed', message: 'nope' } })
  })

  // ── GHL ────────────────────────────────────────────────────────────────────
  it('ghl_sms: looks up channel, decrypts key, sends', async () => {
    const supabase = buildSupabase({ ghlChannel: { encrypted_api_key: 'enc' } })
    const res = await dispatchOutbound(
      conv({
        channel: 'ghl_sms',
        channel_metadata: { location_id: 'loc-1', contact_id: 'ct-1', ghl_conversation_id: 'gc-1' },
      }),
      { content: 'hello', supabase: supabase as never },
    )
    expect(res).toEqual({ ok: true })
    expect(sendGhlMessage).toHaveBeenCalledTimes(1)
    expect(vi.mocked(sendGhlMessage).mock.calls[0][0]).toMatchObject({ contactId: 'ct-1', message: 'hello' })
  })

  it('ghl_sms: channel not configured → 400 ghl_channel_not_configured', async () => {
    const res = await dispatchOutbound(
      conv({ channel: 'ghl_sms', channel_metadata: { location_id: 'loc-1' } }),
      opts(),
    )
    expect(res).toEqual({ ok: false, status: 400, body: { error: 'ghl_channel_not_configured' } })
    expect(sendGhlMessage).not.toHaveBeenCalled()
  })

  // ── WhatsApp ────────────────────────────────────────────────────────────────
  it('whatsapp (Evolution default): sends via Evolution to visitor_phone', async () => {
    const res = await dispatchOutbound(
      conv({ channel: 'whatsapp', visitor_phone: '+15551234' }),
      opts(),
    )
    expect(res).toEqual({ ok: true })
    expect(sendWhatsappMessage).toHaveBeenCalledWith({ orgId: 'org-1', to: '+15551234', text: 'hello' })
    expect(sendCloudText).not.toHaveBeenCalled()
  })

  it('whatsapp (meta_cloud): sends via Cloud API when account is active', async () => {
    vi.mocked(getActiveCloudAccount).mockResolvedValue({ id: 'acct' } as never)
    const res = await dispatchOutbound(
      conv({ channel: 'whatsapp', visitor_phone: '+1', channel_metadata: { provider: 'meta_cloud' } }),
      opts(),
    )
    expect(res).toEqual({ ok: true })
    expect(sendCloudText).toHaveBeenCalledTimes(1)
    expect(sendWhatsappMessage).not.toHaveBeenCalled()
  })

  it('whatsapp (meta_cloud): no active account → 400 wa_not_configured', async () => {
    vi.mocked(getActiveCloudAccount).mockResolvedValue(null as never)
    const res = await dispatchOutbound(
      conv({ channel: 'whatsapp', visitor_phone: '+1', channel_metadata: { provider: 'meta_cloud' } }),
      opts(),
    )
    expect(res).toEqual({ ok: false, status: 400, body: { error: 'wa_not_configured' } })
  })

  it('whatsapp: no recipient → 400 wa_no_recipient', async () => {
    const res = await dispatchOutbound(conv({ channel: 'whatsapp', channel_metadata: {} }), opts())
    expect(res).toEqual({ ok: false, status: 400, body: { error: 'wa_no_recipient' } })
  })

  // ── Meta (delegated; route test covers the full path) ───────────────────────
  it('messenger: resolves recipient from sender_id and sends', async () => {
    const supabase = buildSupabase({ metaChannel: { encrypted_page_access_token: 'enc' } })
    const res = await dispatchOutbound(
      conv({ channel: 'messenger', channel_metadata: { sender_id: 'psid-1', page_id: 'p-1' } }),
      { content: 'hello', supabase: supabase as never },
    )
    expect(res).toEqual({ ok: true })
    expect(sendMetaMessage).toHaveBeenCalledWith('decrypted-secret', 'psid-1', 'hello')
  })

  it('messenger: Meta error code 190 → 400 token_revoked', async () => {
    vi.mocked(sendMetaMessage).mockResolvedValue({ error: 'expired', code: 190 } as never)
    const supabase = buildSupabase({ metaChannel: { encrypted_page_access_token: 'enc' } })
    const res = await dispatchOutbound(
      conv({ channel: 'messenger', channel_metadata: { sender_id: 'psid-1', page_id: 'p-1' } }),
      { content: 'hello', supabase: supabase as never },
    )
    expect(res).toEqual({ ok: false, status: 400, body: { error: 'token_revoked', channel: 'messenger' } })
  })
})

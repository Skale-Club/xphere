// src/lib/messaging/dispatch-outbound.ts
//
// Single outbound dispatch point: given a conversation and the text to send,
// route to the correct provider based on `conversation.channel`. This is the
// channel→provider switch that used to live inline in
// `POST /api/chat/conversations/[id]/messages`; it was extracted so other
// senders (action-engine executors, campaign dispatchers) can route outbound
// through one place instead of each calling provider functions ad hoc.
//
// IMPORTANT: this function only SENDS. It does NOT persist the message row or
// update `last_message` — callers own persistence (the Chat route persists
// first, then dispatches). Behavior here is intentionally identical to the
// previous inline logic.

import type { createClient } from '@/lib/supabase/server'
import { decrypt } from '@/lib/crypto'
import { sendMetaMessage } from '@/lib/meta/send-message'
import { sendGhlMessage, channelToGhlType } from '@/lib/ghl/send-message'
import { sendSms } from '@/lib/twilio/send-sms'
import { sendTenantEmail } from '@/lib/email/resend'
import { sendWhatsappMessage } from '@/lib/evolution/send-message'
import { sendCloudText } from '@/lib/whatsapp/cloud/send-text'
import { getActiveCloudAccount } from '@/lib/whatsapp/cloud/resolve-account'
import { sendTelegramReply } from '@/lib/telegram/send-message'

type DbClient = Awaited<ReturnType<typeof createClient>>

/** Conversation fields the dispatcher needs to address the outbound message. */
export interface OutboundConversation {
  id: string
  org_id: string
  channel: string | null
  channel_metadata: unknown
  visitor_phone: string | null
  visitor_email: string | null
  phone_number_id: string | null
  contact_id: string | null
}

export interface DispatchOptions {
  /** The message text to send. */
  content: string
  /** Operator display name → prepended as "Name:\n" for GHL/SMS when set. */
  operatorName?: string | null
  /** Subject line for the email channel. */
  emailSubject?: string
  /** RLS-scoped Supabase client (used for credential lookups + SMS context). */
  supabase: DbClient
}

/**
 * Result mirrors the HTTP contract the Chat route exposed: on failure it
 * carries the exact status + JSON body the caller should return, so existing
 * client error handling is unchanged. Channels with no outbound provider
 * (widget, telegram, manychat, voice, …) resolve `{ ok: true }` — i.e. the
 * message is persisted but nothing is pushed to a provider, matching the
 * previous behavior where those channels had no routing branch.
 */
export type DispatchResult =
  | { ok: true }
  | { ok: false; status: number; body: Record<string, unknown> }

export async function dispatchOutbound(
  conv: OutboundConversation,
  opts: DispatchOptions,
): Promise<DispatchResult> {
  const { content, operatorName, supabase } = opts
  const emailSubject = opts.emailSubject?.trim() || 'New message'

  // GHL (ghl_sms / ghl_whatsapp): send via GHL Conversations API.
  if (conv.channel === 'ghl_sms' || conv.channel === 'ghl_whatsapp') {
    const metadata = (conv.channel_metadata as Record<string, string>) ?? {}
    const locationId = metadata.location_id
    const contactId = metadata.contact_id
    const ghlConversationId = metadata.ghl_conversation_id

    const { data: ghlChannel } = await supabase
      .from('ghl_channels')
      .select('encrypted_api_key')
      .eq('org_id', conv.org_id)
      .eq('location_id', locationId)
      .eq('is_active', true)
      .maybeSingle()

    if (!ghlChannel) {
      return { ok: false, status: 400, body: { error: 'ghl_channel_not_configured' } }
    }

    const apiKey = await decrypt(ghlChannel.encrypted_api_key)

    // Build the outbound message | optionally prefix with operator name
    const outboundContent = operatorName ? `${operatorName}:\n${content}` : content

    try {
      await sendGhlMessage(
        {
          contactId,
          message: outboundContent,
          type: channelToGhlType(conv.channel),
          conversationId: ghlConversationId || undefined,
        },
        { apiKey, locationId }
      )
    } catch (err) {
      console.error('[dispatchOutbound] GHL send error:', err)
      return { ok: false, status: 502, body: { error: 'ghl_send_failed' } }
    }
  }

  if (conv.channel === 'messenger' || conv.channel === 'instagram') {
    const metadata = (conv.channel_metadata as Record<string, string>) ?? {}
    const pageId = metadata.page_id

    const { data: metaChannel } = await supabase
      .from('meta_channels')
      .select('encrypted_page_access_token')
      .eq('page_id', pageId)
      .eq('channel_type', conv.channel)
      .eq('is_active', true)
      .maybeSingle()

    if (!metaChannel) {
      return { ok: false, status: 400, body: { error: 'channel_not_configured' } }
    }

    const pageToken = await decrypt(metaChannel.encrypted_page_access_token)

    // messenger → sender_id, instagram → igsid (per process-event.ts lines 93-96)
    // NOTE: Migration 020 SQL comment says "psid" | this is WRONG. Use sender_id.
    const recipientId =
      conv.channel === 'instagram'
        ? (metadata.igsid ?? '')
        : (metadata.sender_id ?? '')

    const result = await sendMetaMessage(pageToken, recipientId, content)

    if ('error' in result) {
      if (result.code === 190) {
        return { ok: false, status: 400, body: { error: 'token_revoked', channel: conv.channel } }
      }
      return { ok: false, status: 502, body: { error: 'meta_send_failed', message: result.error } }
    }
  }

  // Native Twilio SMS: send via the org's Twilio credentials. The recipient is
  // the conversation's visitor phone (set when the thread was created/opened
  // for the contact) or the stored to_number.
  if (conv.channel === 'sms') {
    const metadata = (conv.channel_metadata as Record<string, string>) ?? {}
    const to = conv.visitor_phone ?? metadata.to_number ?? ''
    if (!to) {
      return { ok: false, status: 400, body: { error: 'sms_no_recipient' } }
    }
    // Text-only for now (media via Twilio MMS is a separate follow-up).
    const outboundContent = operatorName ? `${operatorName}:\n${content}` : content
    try {
      await sendSms(
        {
          to,
          body: outboundContent,
          phone_number_id: conv.phone_number_id ?? undefined,
        },
        {
          organizationId: conv.org_id,
          supabase,
          contactId: conv.contact_id ?? undefined,
          conversationId: conv.id,
        },
      )
    } catch (err) {
      console.error('[dispatchOutbound] Twilio SMS send error:', err)
      const message = err instanceof Error ? err.message : 'sms_send_failed'
      return { ok: false, status: 502, body: { error: 'sms_send_failed', message } }
    }
  }

  // Email: send via the org's Resend (tenant) integration.
  if (conv.channel === 'email') {
    const to = conv.visitor_email ?? ''
    if (!to) {
      return { ok: false, status: 400, body: { error: 'email_no_recipient' } }
    }
    const safe = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const html = `<div style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">${safe}</div>`
    const res = await sendTenantEmail(conv.org_id, to, emailSubject, html)
    if (res.error) {
      return { ok: false, status: 502, body: { error: 'email_send_failed', message: res.error } }
    }
  }

  // Native WhatsApp (Evolution or Meta Cloud). Callers persist the message row
  // themselves, so we use the low-level senders (no extra persistence).
  if (conv.channel === 'whatsapp') {
    const metadata = (conv.channel_metadata as Record<string, string>) ?? {}
    const to = conv.visitor_phone ?? metadata.to_number ?? metadata.sender_jid ?? ''
    if (!to) {
      return { ok: false, status: 400, body: { error: 'wa_no_recipient' } }
    }
    if (metadata.provider === 'meta_cloud') {
      const account = await getActiveCloudAccount(conv.org_id)
      if (!account) {
        return { ok: false, status: 400, body: { error: 'wa_not_configured' } }
      }
      const res = await sendCloudText({ account, to, body: content })
      if (!res.ok) {
        return {
          ok: false,
          status: 502,
          body: { error: 'wa_send_failed', message: res.error, outsideWindow: res.outsideWindow },
        }
      }
    } else {
      // Evolution Go (default). Omit conversationId so it does NOT persist again.
      const res = await sendWhatsappMessage({ orgId: conv.org_id, to, text: content })
      if (!res.ok) {
        return { ok: false, status: 502, body: { error: 'wa_send_failed', message: res.error } }
      }
    }
  }

  // Telegram: reply via the org's active bot. The recipient chat id is stored
  // on the conversation (Phase 107 back-compat: it used to live in
  // visitor_phone). conversationId is intentionally omitted so sendTelegramReply
  // does NOT persist again — the caller already persisted the message row.
  if (conv.channel === 'telegram') {
    const metadata = (conv.channel_metadata as Record<string, string>) ?? {}
    const chatId = metadata.telegram_chat_id ?? conv.visitor_phone ?? ''
    if (!chatId) {
      return { ok: false, status: 400, body: { error: 'telegram_no_recipient' } }
    }
    const res = await sendTelegramReply({ orgId: conv.org_id, chatId, text: content })
    if (!res.ok) {
      return { ok: false, status: 502, body: { error: 'telegram_send_failed', message: res.error } }
    }
  }

  return { ok: true }
}

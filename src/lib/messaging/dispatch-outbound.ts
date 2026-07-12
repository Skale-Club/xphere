// Shared outbound-message dispatcher for chat conversations.
//
// Extracted from the admin inbox route (POST /api/chat/conversations/[id]/messages)
// so the exact same channel-routing + provider-confirmation + persistence logic
// can be reused by other framework surfaces — starting with the
// `conversations_send_message` MCP tool, which previously only inserted a
// `conversation_messages` row and never actually delivered anything on the
// conversation's real channel.
//
// This is a plain, framework-agnostic function: no Request/Response, no
// cookies, no auth. Callers own:
//   - auth (who is allowed to send)
//   - input validation (content/media shape)
//   - loading + org-scoping the conversation row
// This function owns: channel routing, provider dispatch (confirm before
// persisting), and the conversation_messages insert + last_message bump.
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { decrypt } from '@/lib/crypto'
import { sendMetaMessage } from '@/lib/meta/send-message'
import { sendGhlMessage, channelToGhlType } from '@/lib/ghl/send-message'
import { sendSms } from '@/lib/twilio/send-sms'
import { sendTenantEmail } from '@/lib/email/resend'
import { sendWhatsappMessage } from '@/lib/evolution/send-message'
import { sendCloudText } from '@/lib/whatsapp/cloud/send-text'
import { getActiveCloudAccount } from '@/lib/whatsapp/cloud/resolve-account'
import { sendZernioDm } from '@/lib/zernio/send-dm'
import { sendZernioCommentReply } from '@/lib/zernio/send-comment-reply'
import { isZernioChannel } from '@/lib/zernio/channel'
import { getProviderKey } from '@/lib/integrations/get-provider-key'

export interface OutboundMediaItem {
  url: string
  mime_type: string
  size?: number
  filename?: string
}

/**
 * Minimal conversation shape dispatch needs. Callers load + org-scope this
 * row themselves (RLS-scoped client in the admin route; service-role client
 * with an explicit `.eq('org_id', ...)` filter in MCP tools) — dispatch never
 * fetches or authorizes the conversation on its own.
 */
export interface DispatchConversation {
  id: string
  channel: string
  channel_metadata: unknown
  visitor_phone: string | null
  visitor_email: string | null
  phone_number_id: string | null
  contact_id: string | null
  last_inbound_at: string | null
}

export interface DispatchOutboundParams {
  /** Service-role or RLS-scoped client — caller decides which is appropriate. */
  supabase: SupabaseClient<Database>
  orgId: string
  conversation: DispatchConversation
  content: string
  /** Cross-channel override: send on a different channel than conversation.channel (SEED-039). */
  channel?: string | null
  media?: OutboundMediaItem[]
  /** Email channel only: subject line. Defaults to 'New message'. */
  subject?: string
  deliveryOverride?: 'evolution_manual_escape'
  /**
   * Already-resolved display name to prefix outbound content with (dashboard
   * "operator_prefix" feature: "Name:\n<content>"). Pass null/undefined to skip.
   * Callers resolve the name themselves (this function has no notion of a
   * Supabase Auth user).
   */
  operatorName?: string | null
  role: 'assistant' | 'agent'
  /** Extra metadata merged into the persisted row (e.g. MCP's { source: 'mcp', actor }). */
  metadata?: Record<string, unknown>
}

type ConversationMessageRow = Database['public']['Tables']['conversation_messages']['Row']

export type DispatchOutboundResult =
  | { ok: true; message: ConversationMessageRow }
  | { ok: false; error: string; message: string; status: number; extra?: Record<string, unknown> }

function fail(
  error: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): DispatchOutboundResult {
  return { ok: false, error, message, status, extra }
}

export async function dispatchOutboundMessage(
  params: DispatchOutboundParams,
): Promise<DispatchOutboundResult> {
  const {
    supabase,
    orgId,
    conversation,
    content,
    channel,
    media,
    subject,
    deliveryOverride,
    operatorName = null,
    role,
    metadata,
  } = params

  // PRECONDITION: the caller must have verified that `conversation` belongs to
  // `orgId` BEFORE calling in. Provider-credential lookups below (meta_channels
  // by page_id, contacts by id, etc.) trust IDs taken from the conversation row
  // and run without org filters — safe only under that precondition, which both
  // current callers (authed route via RLS, MCP tool via explicit org check) uphold.

  // Defensive guard — both current callers (route + MCP) validate this
  // themselves before calling in, so this should be unreachable in practice.
  if (!content && (!media || media.length === 0)) {
    return fail('empty_message', 'Either content or media is required', 400)
  }

  const messageChannel = channel ?? conversation.channel ?? null
  // Email subject: caller-provided, else a sensible default.
  const emailSubject = subject?.trim() || 'New message'

  // SEED-039 multichannel: a message may be sent on a channel different from the
  // conversation's primary channel (e.g. reply by Email inside an SMS thread).
  // Native channels (recipient derived from the contact) route by the per-message
  // channel; provider-bound channels (GHL/Meta/Zernio) only when it matches conversation.channel.
  const NATIVE_CHANNELS = ['sms', 'email', 'whatsapp'] as const
  const routeChannel = (messageChannel ?? conversation.channel ?? '') as string
  const isNativeRoute = (NATIVE_CHANNELS as readonly string[]).includes(routeChannel)

  // Resolve the recipient from the contact when the conversation's own visitor_*
  // doesn't carry it (cross-channel send within the same thread).
  let contactPhone: string | null = null
  let contactEmail: string | null = null
  if (isNativeRoute && conversation.contact_id) {
    const needPhone = (routeChannel === 'sms' || routeChannel === 'whatsapp') && !conversation.visitor_phone
    const needEmail = routeChannel === 'email' && !conversation.visitor_email
    if (needPhone || needEmail) {
      const { data: c } = await supabase
        .from('contacts')
        .select('phone_e164, phone, email')
        .eq('id', conversation.contact_id)
        .maybeSingle()
      contactPhone = c?.phone_e164 ?? c?.phone ?? null
      contactEmail = c?.email ?? null
    }
  }
  // Recipient email actually used (for stamping email_to on the persisted row).
  let emailTo: string | null = null

  // Resolve operator display name for the prefix feature
  // (already resolved by the caller — see `operatorName` param doc above)

  // Single outbound content string reused by all channel providers.
  // Skip prefix when there is no text (media-only messages).
  const outboundContent = operatorName && content ? `${operatorName}:\n${content}` : content

  // Determine message_type
  const messageType = media?.length ? (content ? 'mixed' : (() => {
    const first = media[0]
    if (first.mime_type.startsWith('image/')) return 'image'
    if (first.mime_type.startsWith('audio/')) return 'audio'
    if (first.mime_type.startsWith('video/')) return 'video'
    return 'document'
  })()) : 'text'

  // Compose metadata
  const msgMetadata: Record<string, unknown> = {}
  if (operatorName) msgMetadata.sender_name = operatorName
  if (media?.length) msgMetadata.media = media

  // Compute last_message | use media label when content is empty
  let lastMessageDisplay = content
  if (!content && media?.length) {
    const first = media[0]
    if (first.mime_type.startsWith('image/')) lastMessageDisplay = '📷 Foto'
    else if (first.mime_type.startsWith('audio/')) lastMessageDisplay = '🎵 Áudio'
    else if (first.mime_type.startsWith('video/')) lastMessageDisplay = '🎬 Vídeo'
    else lastMessageDisplay = `📎 ${first.filename ?? 'Arquivo'}`
  }

  // --- Outbound channel routing ---
  // Provider-backed channels must confirm first. Only then do we persist the
  // message as delivered; otherwise the UI would show a false sent
  // bubble for a message that never left Xphere.
  const deliveryMetadata: Record<string, unknown> = {}
  const wantsEvolutionManualEscape = deliveryOverride === 'evolution_manual_escape'
  const canUseEvolutionManualEscape =
    wantsEvolutionManualEscape &&
    routeChannel === conversation.channel &&
    conversation.channel === 'zernio_whatsapp'

  if (wantsEvolutionManualEscape && !canUseEvolutionManualEscape) {
    return fail(
      'evolution_escape_not_allowed',
      'Evolution GO fallback is only available for manual Zernio WhatsApp replies.',
      400,
    )
  }

  if (canUseEvolutionManualEscape) {
    if (media?.length) {
      return fail(
        'evolution_escape_text_only',
        'Evolution GO fallback currently supports text-only manual replies.',
        400,
      )
    }

    const lastInboundAt = conversation.last_inbound_at ? new Date(conversation.last_inbound_at).getTime() : 0
    const outsideWindow =
      !lastInboundAt || Date.now() - lastInboundAt > 24 * 60 * 60 * 1000
    if (!outsideWindow) {
      return fail(
        'evolution_escape_window_open',
        'Use the normal Zernio reply path while the 24-hour WhatsApp window is still open.',
        400,
      )
    }

    const metadataRec = (conversation.channel_metadata as Record<string, string>) ?? {}
    let to =
      conversation.visitor_phone ??
      metadataRec.participant_phone ??
      metadataRec.participant_id ??
      metadataRec.to_number ??
      contactPhone ??
      ''
    if (!to && conversation.contact_id) {
      const { data: c } = await supabase
        .from('contacts')
        .select('phone_e164, phone')
        .eq('id', conversation.contact_id)
        .maybeSingle()
      to = c?.phone_e164 ?? c?.phone ?? ''
    }
    if (!to) {
      return fail(
        'wa_no_recipient',
        'This WhatsApp conversation has no recipient phone number or chat ID.',
        400,
      )
    }

    const res = await sendWhatsappMessage({
      orgId,
      to,
      text: outboundContent,
      splitIntoChunks: false,
    })
    if (!res.ok) {
      return fail('wa_send_failed', res.error ?? 'Evolution GO send failed.', 502)
    }

    deliveryMetadata.delivery_provider = 'evolution_manual_escape'
    deliveryMetadata.evolution_manual_escape = true
    deliveryMetadata.evolution_message_ids = res.messageIds
    deliveryMetadata.to = to
  }

  // Widget / web: no outbound call needed | SSE picks up the persisted message.
  // Messenger / Instagram: call Meta Send API synchronously.
  // GHL (ghl_sms / ghl_whatsapp): send via GHL Conversations API.
  if (routeChannel === conversation.channel && (conversation.channel === 'ghl_sms' || conversation.channel === 'ghl_whatsapp')) {
    const metadataRec = conversation.channel_metadata as Record<string, string>
    const locationId = metadataRec.location_id
    const contactId = metadataRec.contact_id
    const ghlConversationId = metadataRec.ghl_conversation_id

    const { data: ghlChannel } = await supabase
      .from('ghl_channels')
      .select('encrypted_api_key')
      .eq('org_id', orgId)
      .eq('location_id', locationId)
      .eq('is_active', true)
      .maybeSingle()

    if (!ghlChannel) {
      return fail(
        'ghl_channel_not_configured',
        'GHL is not connected for this location. Reconnect GHL before sending this message.',
        400,
      )
    }

    const apiKey = await decrypt(ghlChannel.encrypted_api_key)

    try {
      const sent = await sendGhlMessage(
        {
          contactId,
          message: outboundContent,
          type: channelToGhlType(conversation.channel),
          conversationId: ghlConversationId || undefined,
        },
        { apiKey, locationId }
      )
      deliveryMetadata.ghl_message_id = sent.messageId
    } catch (err) {
      console.error('[dispatchOutboundMessage] GHL send error:', err)
      const message = err instanceof Error ? err.message : 'GHL rejected the message.'
      return fail('ghl_send_failed', message, 502)
    }
  }

  if (routeChannel === conversation.channel && (conversation.channel === 'messenger' || conversation.channel === 'instagram')) {
    const metadataRec = conversation.channel_metadata as Record<string, string>
    const pageId = metadataRec.page_id

    const { data: metaChannel } = await supabase
      .from('meta_channels')
      .select('encrypted_page_access_token')
      .eq('page_id', pageId)
      .eq('channel_type', conversation.channel)
      .eq('is_active', true)
      .maybeSingle()

    if (!metaChannel) {
      return fail(
        'channel_not_configured',
        `${conversation.channel === 'instagram' ? 'Instagram' : 'Messenger'} is not connected or is inactive for this page.`,
        400,
      )
    }

    const pageToken = await decrypt(metaChannel.encrypted_page_access_token)

    // messenger → sender_id, instagram → igsid (per process-event.ts lines 93-96)
    // NOTE: Migration 020 SQL comment says "psid" | this is WRONG. Use sender_id.
    const recipientId =
      conversation.channel === 'instagram'
        ? (metadataRec.igsid ?? '')
        : (metadataRec.sender_id ?? '')

    if (!recipientId) {
      return fail(
        'meta_no_recipient',
        `This ${conversation.channel === 'instagram' ? 'Instagram' : 'Messenger'} conversation has no recipient ID.`,
        400,
      )
    }

    const result = await sendMetaMessage(pageToken, recipientId, outboundContent)

    if ('error' in result) {
      if (result.code === 190) {
        return fail(
          'token_revoked',
          'The Meta page token was revoked or expired. Reconnect the channel before sending.',
          400,
          { channel: conversation.channel },
        )
      }
      return fail('meta_send_failed', result.error, 502)
    }
    deliveryMetadata.meta_message_id = result.messageId
  }

  // Native Twilio SMS: send via the org's Twilio credentials. The recipient is
  // the conversation's visitor phone (set when the thread was created/opened
  // for the contact) or the stored to_number.
  if (routeChannel === 'sms') {
    const metadataRec = (conversation.channel_metadata as Record<string, string>) ?? {}
    const to = conversation.visitor_phone ?? metadataRec.to_number ?? contactPhone ?? ''
    if (!to) {
      return fail(
        'sms_no_recipient',
        'This conversation has no recipient phone number. Add a phone number before sending SMS.',
        400,
      )
    }
    // MMS: forward the public media URLs to Twilio.
    const mediaUrls = media?.map((m) => m.url) ?? []
    try {
      await sendSms(
        {
          to,
          body: outboundContent,
          media_urls: mediaUrls,
          phone_number_id: conversation.phone_number_id ?? undefined,
        },
        {
          organizationId: orgId,
          supabase,
          contactId: conversation.contact_id ?? undefined,
          conversationId: conversation.id,
        },
      )
    } catch (err) {
      console.error('[dispatchOutboundMessage] Twilio SMS send error:', err)
      const message = err instanceof Error ? err.message : 'sms_send_failed'
      return fail('sms_send_failed', message, 502)
    }
  }

  // Email: send via the org's Resend (tenant) integration.
  if (routeChannel === 'email') {
    const to = conversation.visitor_email ?? contactEmail ?? ''
    if (!to) {
      return fail(
        'email_no_recipient',
        'This contact has no email address. Add an email before sending.',
        400,
      )
    }
    emailTo = to
    const safe = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const html = `<div style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">${safe}</div>`
    const res = await sendTenantEmail(orgId, to, emailSubject, html)
    if (res.error) {
      return fail('email_send_failed', res.error, 502)
    }
    if (res.id) deliveryMetadata.email_message_id = res.id
  }

  // Native WhatsApp (Evolution or Meta Cloud). The route already persisted the
  // message row above, so we use the low-level senders (no extra persistence).
  if (routeChannel === 'whatsapp') {
    const metadataRec = (conversation.channel_metadata as Record<string, string>) ?? {}
    const to = conversation.visitor_phone ?? metadataRec.to_number ?? metadataRec.sender_jid ?? contactPhone ?? ''
    if (!to) {
      return fail(
        'wa_no_recipient',
        'This WhatsApp conversation has no recipient phone number or chat ID.',
        400,
      )
    }
    if (metadataRec.provider === 'meta_cloud') {
      const account = await getActiveCloudAccount(orgId)
      if (!account) {
        return fail(
          'wa_not_configured',
          'WhatsApp Cloud is not connected for this organization.',
          400,
        )
      }
      const res = await sendCloudText({ account, to, body: outboundContent })
      if (!res.ok) {
        return fail('wa_send_failed', res.error, 502, { outsideWindow: res.outsideWindow })
      }
      deliveryMetadata.whatsapp_message_id = res.wamid
    } else {
      // Evolution Go (default). Omit conversationId so it does NOT persist again.
      const res = await sendWhatsappMessage({ orgId, to, text: outboundContent })
      if (!res.ok) {
        return fail('wa_send_failed', res.error ?? 'WhatsApp send failed.', 502)
      }
      if (res.messageIds.length) deliveryMetadata.whatsapp_message_ids = res.messageIds
    }
  }

  // Zernio unified social inbox (Instagram, Facebook, LinkedIn, TikTok, etc.)
  if (!canUseEvolutionManualEscape && routeChannel === conversation.channel && isZernioChannel(conversation.channel)) {
    const metadataRec = (conversation.channel_metadata as Record<string, string>) ?? {}
    const zernioAccountId = metadataRec.account_id ?? ''

    const apiKey = await getProviderKey('zernio', orgId, supabase)
    if (!apiKey) {
      return fail(
        'zernio_not_configured',
        'Zernio is not connected for this organization. Add a Zernio API key in Integrations.',
        400,
      )
    }

    try {
      if (!zernioAccountId) {
        return fail(
          'zernio_no_account_id',
          'This Zernio conversation has no account ID. Reconnect Zernio and wait for a fresh inbound event.',
          400,
        )
      }

      if (metadataRec.thread_type === 'comment') {
        const postId = metadataRec.zernio_post_id ?? metadataRec.zernio_platform_post_id ?? ''
        const commentId = metadataRec.zernio_comment_id ?? ''
        if (!postId || !commentId) {
          return fail(
            'zernio_no_comment_context',
            'This Zernio comment thread is missing the post or comment ID required to reply.',
            400,
          )
        }

        const { commentId: replyCommentId } = await sendZernioCommentReply({
          postId,
          accountId: zernioAccountId,
          commentId,
          text: outboundContent,
          apiKey,
        })
        if (replyCommentId) deliveryMetadata.zernio_comment_id = replyCommentId
      } else {
        const zernioConversationId = metadataRec.zernio_conversation_id ?? ''
        if (!zernioConversationId) {
          return fail(
            'zernio_no_conversation_id',
            'This Zernio conversation has no conversation ID. The channel may not have been set up correctly.',
            400,
          )
        }

        const sentIds: string[] = []
        if (media?.length) {
          for (const [index, item] of media.entries()) {
            const isWhatsAppVoice =
              conversation.channel === 'zernio_whatsapp' &&
              item.mime_type.startsWith('audio/') &&
              item.mime_type.includes('ogg')
            const { messageId } = await sendZernioDm(
              zernioConversationId,
              zernioAccountId,
              index === 0 ? outboundContent : '',
              apiKey,
              { attachment: item, voiceNote: isWhatsAppVoice },
            )
            if (messageId) sentIds.push(messageId)
          }
        } else {
          const { messageId } = await sendZernioDm(zernioConversationId, zernioAccountId, outboundContent, apiKey)
          if (messageId) sentIds.push(messageId)
        }
        if (sentIds.length === 1) deliveryMetadata.zernio_message_id = sentIds[0]
        if (sentIds.length > 1) deliveryMetadata.zernio_message_ids = sentIds
      }
    } catch (err) {
      console.error('[dispatchOutboundMessage] Zernio send error:', err)
      const message = err instanceof Error ? err.message : 'Zernio rejected the message.'
      return fail('zernio_send_failed', message, 502)
    }
  }

  const providerRoute =
    routeChannel === conversation.channel &&
    (isZernioChannel(conversation.channel) ||
      ['widget', 'web', 'ghl_sms', 'ghl_whatsapp', 'messenger', 'instagram'].includes(conversation.channel))
  if (!isNativeRoute && !providerRoute) {
    return fail(
      'channel_not_sendable',
      `The ${routeChannel || 'selected'} channel is not configured for outbound messages.`,
      400,
    )
  }
  // --- End outbound channel routing ---

  // WhatsApp-style delivery ticks: every reply that reaches here was accepted by
  // its provider (or routed on a native channel), so stamp it 'sent' for a single
  // tick immediately. Delivery/read webhooks (e.g. Zernio) later upgrade the
  // status to 'delivered'/'read' → two ticks, reflected live via the UPDATE
  // realtime subscription in chat-layout.
  deliveryMetadata.delivery_status = 'sent'

  const finalMetadata = { ...msgMetadata, ...(metadata ?? {}), ...deliveryMetadata }

  // SEED-039: stamp channel on each message so multi-channel threads can be
  // filtered + rendered with per-message origin pills. We default to the
  // selected outbound channel, falling back to the conversation's primary channel.
  const { data: msg, error } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: conversation.id,
      org_id: orgId,
      role,
      content,
      message_type: messageType,
      channel: messageChannel,
      ...(Object.keys(finalMetadata).length > 0 ? { metadata: finalMetadata } : {}),
      ...(routeChannel === 'email'
        ? { email_subject: emailSubject, email_to: emailTo }
        : {}),
    })
    .select('*')
    .single()

  if (error) {
    console.error('[dispatchOutboundMessage]', error)
    return fail(
      'message_persist_failed',
      'The provider accepted the message, but Xphere could not save it in the conversation history.',
      500,
    )
  }

  // Update last_message and last_message_at on parent conversation. The extra
  // org_id filter is defense-in-depth for service-role callers (RLS bypassed).
  await supabase
    .from('conversations')
    .update({ last_message: lastMessageDisplay, last_message_at: msg.created_at, updated_at: new Date().toISOString() })
    .eq('id', conversation.id)
    .eq('org_id', orgId)

  return { ok: true, message: msg }
}

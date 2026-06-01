// GET /api/chat/conversations/[id]/messages | paginated message history
// POST /api/chat/conversations/[id]/messages | admin sends message
import { createClient, getUser } from '@/lib/supabase/server'
import { z } from 'zod'
import type { ConversationMessage } from '@/types/chat'
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

export const runtime = 'nodejs'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const { searchParams } = new URL(request.url)
  const limitRaw = parseInt(searchParams.get('limit') ?? '50', 10)
  const limit = Math.min(Number.isNaN(limitRaw) ? 50 : limitRaw, 200)
  const before = searchParams.get('before')
  const includeInternal = searchParams.get('includeInternal') === 'true'

  const supabase = await createClient()

  // Verify conversation belongs to org (RLS handles this but be explicit)
  const { data: conv } = await supabase
    .from('conversations')
    .select('id')
    .eq('id', id)
    .single()

  if (!conv) return Response.json({ error: 'Conversation not found' }, { status: 404 })

  // Cursor: if `before` provided, find the created_at of that message first
  let beforeCreatedAt: string | null = null
  if (before) {
    const { data: anchor } = await supabase
      .from('conversation_messages')
      .select('created_at')
      .eq('id', before)
      .single()
    if (anchor) beforeCreatedAt = anchor.created_at
  }

  let query = supabase
    .from('conversation_messages')
    .select('id, conversation_id, org_id, role, content, created_at, metadata, channel, email_subject, email_from, email_to, email_cc, email_message_id, email_delivery_status')
    .eq('conversation_id', id)
    .order('created_at', { ascending: false })
    .limit(limit + 1)  // fetch one extra to determine hasMore

  if (beforeCreatedAt) {
    query = query.lt('created_at', beforeCreatedAt)
  }

  if (!includeInternal) {
    // Filter out messages where metadata->>'internal' = 'true'
    query = query.or('metadata.is.null,metadata->>internal.neq.true')
  }

  const { data, error } = await query

  if (error) {
    console.error('[GET messages]', error)
    return Response.json({ error: 'Failed to load messages' }, { status: 500 })
  }

  const rows = data ?? []
  const hasMore = rows.length > limit
  const sliced = rows.slice(0, limit)

  const messages: ConversationMessage[] = sliced.reverse().map((row) => {
    const r = row as typeof row & {
      channel?: string | null
      email_subject?: string | null
      email_from?: string | null
      email_to?: string | null
      email_cc?: string | null
      email_message_id?: string | null
      email_delivery_status?: string | null
    }
    return {
      id: r.id,
      conversationId: r.conversation_id,
      role: r.role,
      content: r.content,
      createdAt: r.created_at,
      metadata: r.metadata as Record<string, unknown> | null,
      channel: r.channel ?? null,
      email_subject: r.email_subject ?? null,
      email_from: r.email_from ?? null,
      email_to: r.email_to ?? null,
      email_cc: r.email_cc ?? null,
      email_message_id: r.email_message_id ?? null,
      email_delivery_status: r.email_delivery_status ?? null,
    }
  })

  return Response.json({ messages, hasMore })
}

const MediaItemSchema = z.object({
  url: z.string().url(),
  mime_type: z.string(),
  size: z.number().optional(),
  filename: z.string().optional(),
})

const SendMessageSchema = z.object({
  content: z.string().default(''),
  role: z.literal('assistant'),
  channel: z.string().optional(),
  // operator_prefix: true → prepend "Name:\n" to outbound GHL messages
  operator_prefix: z.boolean().optional().default(false),
  /** Optional media attachments (uploaded via /api/chat/upload beforehand). */
  media: z.array(MediaItemSchema).optional(),
  /** Email channel: subject line for the outbound email. */
  subject: z.string().optional(),
})

function sendError(
  error: string,
  message: string,
  status: number,
  extra?: Record<string, unknown>,
): Response {
  return Response.json({ error, message, ...extra }, { status })
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<Response> {
  const user = await getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const supabase = await createClient()

  // Verify conversation belongs to org via RLS
  const { data: conv } = await supabase
    .from('conversations')
    .select('id, org_id, channel, channel_metadata, assigned_user_id, visitor_phone, visitor_email, phone_number_id, contact_id')
    .eq('id', id)
    .single()

  if (!conv) return Response.json({ error: 'Conversation not found' }, { status: 404 })

  let body: unknown
  try { body = await request.json() } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const parsed = SendMessageSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({ error: parsed.error.errors[0]?.message ?? 'Invalid request' }, { status: 400 })
  }

  const { content, role, operator_prefix, media } = parsed.data
  const messageChannel = parsed.data.channel ?? conv.channel ?? null
  // Email subject: operator-provided, else a sensible default.
  const emailSubject = parsed.data.subject?.trim() || 'New message'

  // SEED-039 multichannel: a message may be sent on a channel different from the
  // conversation's primary channel (e.g. reply by Email inside an SMS thread).
  // Native channels (recipient derived from the contact) route by the per-message
  // channel; provider-bound channels (GHL/Meta/Zernio) only when it matches conv.channel.
  const NATIVE_CHANNELS = ['sms', 'email', 'whatsapp'] as const
  const routeChannel = (messageChannel ?? conv.channel ?? '') as string
  const isNativeRoute = (NATIVE_CHANNELS as readonly string[]).includes(routeChannel)

  // Resolve the recipient from the contact when the conversation's own visitor_*
  // doesn't carry it (cross-channel send within the same thread).
  let contactPhone: string | null = null
  let contactEmail: string | null = null
  if (isNativeRoute && conv.contact_id) {
    const needPhone = (routeChannel === 'sms' || routeChannel === 'whatsapp') && !conv.visitor_phone
    const needEmail = routeChannel === 'email' && !conv.visitor_email
    if (needPhone || needEmail) {
      const { data: c } = await supabase
        .from('contacts')
        .select('phone_e164, phone, email')
        .eq('id', conv.contact_id)
        .maybeSingle()
      contactPhone = c?.phone_e164 ?? c?.phone ?? null
      contactEmail = c?.email ?? null
    }
  }
  // Recipient email actually used (for stamping email_to on the persisted row).
  let emailTo: string | null = null

  // Require either content or media
  if (!content && (!media || media.length === 0)) {
    return Response.json({ error: 'Either content or media is required' }, { status: 400 })
  }

  // Resolve operator display name for the prefix feature
  const operatorName: string | null = operator_prefix
    ? (user.user_metadata?.full_name as string | undefined)
      ?? (user.user_metadata?.name as string | undefined)
      ?? user.email
      ?? null
    : null

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
  // assistant message as delivered; otherwise the UI would show a false sent
  // bubble for a message that never left Xphere.
  const deliveryMetadata: Record<string, unknown> = {}

  // Widget / web: no outbound call needed | SSE picks up the persisted message.
  // Messenger / Instagram: call Meta Send API synchronously.
  // GHL (ghl_sms / ghl_whatsapp): send via GHL Conversations API.
  if (routeChannel === conv.channel && (conv.channel === 'ghl_sms' || conv.channel === 'ghl_whatsapp')) {
    const metadata = conv.channel_metadata as Record<string, string>
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
      return sendError(
        'ghl_channel_not_configured',
        'GHL is not connected for this location. Reconnect GHL before sending this message.',
        400,
      )
    }

    const apiKey = await decrypt(ghlChannel.encrypted_api_key)

    // Build the outbound message | optionally prefix with operator name
    const outboundContent = operatorName ? `${operatorName}:\n${content}` : content

    try {
      const sent = await sendGhlMessage(
        {
          contactId,
          message: outboundContent,
          type: channelToGhlType(conv.channel),
          conversationId: ghlConversationId || undefined,
        },
        { apiKey, locationId }
      )
      deliveryMetadata.ghl_message_id = sent.messageId
    } catch (err) {
      console.error('[POST messages] GHL send error:', err)
      const message = err instanceof Error ? err.message : 'GHL rejected the message.'
      return sendError('ghl_send_failed', message, 502)
    }
  }

  if (routeChannel === conv.channel && (conv.channel === 'messenger' || conv.channel === 'instagram')) {
    const metadata = conv.channel_metadata as Record<string, string>
    const pageId = metadata.page_id

    const { data: metaChannel } = await supabase
      .from('meta_channels')
      .select('encrypted_page_access_token')
      .eq('page_id', pageId)
      .eq('channel_type', conv.channel)
      .eq('is_active', true)
      .maybeSingle()

    if (!metaChannel) {
      return sendError(
        'channel_not_configured',
        `${conv.channel === 'instagram' ? 'Instagram' : 'Messenger'} is not connected or is inactive for this page.`,
        400,
      )
    }

    const pageToken = await decrypt(metaChannel.encrypted_page_access_token)

    // messenger → sender_id, instagram → igsid (per process-event.ts lines 93-96)
    // NOTE: Migration 020 SQL comment says "psid" | this is WRONG. Use sender_id.
    const recipientId =
      conv.channel === 'instagram'
        ? (metadata.igsid ?? '')
        : (metadata.sender_id ?? '')

    if (!recipientId) {
      return sendError(
        'meta_no_recipient',
        `This ${conv.channel === 'instagram' ? 'Instagram' : 'Messenger'} conversation has no recipient ID.`,
        400,
      )
    }

    const result = await sendMetaMessage(pageToken, recipientId, content)

    if ('error' in result) {
      if (result.code === 190) {
        return sendError(
          'token_revoked',
          'The Meta page token was revoked or expired. Reconnect the channel before sending.',
          400,
          { channel: conv.channel },
        )
      }
      return sendError('meta_send_failed', result.error, 502)
    }
    deliveryMetadata.meta_message_id = result.messageId
  }

  // Native Twilio SMS: send via the org's Twilio credentials. The recipient is
  // the conversation's visitor phone (set when the thread was created/opened
  // for the contact) or the stored to_number.
  if (routeChannel === 'sms') {
    const metadata = (conv.channel_metadata as Record<string, string>) ?? {}
    const to = conv.visitor_phone ?? metadata.to_number ?? contactPhone ?? ''
    if (!to) {
      return sendError(
        'sms_no_recipient',
        'This conversation has no recipient phone number. Add a phone number before sending SMS.',
        400,
      )
    }
    // MMS: forward the public media URLs to Twilio. Don't prefix the operator
    // name when there's no text (media-only message).
    const mediaUrls = media?.map((m) => m.url) ?? []
    const outboundContent = operatorName && content ? `${operatorName}:\n${content}` : content
    try {
      await sendSms(
        {
          to,
          body: outboundContent,
          media_urls: mediaUrls,
          phone_number_id: conv.phone_number_id ?? undefined,
        },
        {
          organizationId: conv.org_id,
          supabase,
          contactId: conv.contact_id ?? undefined,
          conversationId: id,
        },
      )
    } catch (err) {
      console.error('[POST messages] Twilio SMS send error:', err)
      const message = err instanceof Error ? err.message : 'sms_send_failed'
      return sendError('sms_send_failed', message, 502)
    }
  }

  // Email: send via the org's Resend (tenant) integration.
  if (routeChannel === 'email') {
    const to = conv.visitor_email ?? contactEmail ?? ''
    if (!to) {
      return sendError(
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
    const res = await sendTenantEmail(conv.org_id, to, emailSubject, html)
    if (res.error) {
      return sendError('email_send_failed', res.error, 502)
    }
    if (res.id) deliveryMetadata.email_message_id = res.id
  }

  // Native WhatsApp (Evolution or Meta Cloud). The route already persisted the
  // message row above, so we use the low-level senders (no extra persistence).
  if (routeChannel === 'whatsapp') {
    const metadata = (conv.channel_metadata as Record<string, string>) ?? {}
    const to = conv.visitor_phone ?? metadata.to_number ?? metadata.sender_jid ?? contactPhone ?? ''
    if (!to) {
      return sendError(
        'wa_no_recipient',
        'This WhatsApp conversation has no recipient phone number or chat ID.',
        400,
      )
    }
    if (metadata.provider === 'meta_cloud') {
      const account = await getActiveCloudAccount(conv.org_id)
      if (!account) {
        return sendError(
          'wa_not_configured',
          'WhatsApp Cloud is not connected for this organization.',
          400,
        )
      }
      const res = await sendCloudText({ account, to, body: content })
      if (!res.ok) {
        return sendError('wa_send_failed', res.error, 502, { outsideWindow: res.outsideWindow })
      }
      deliveryMetadata.whatsapp_message_id = res.wamid
    } else {
      // Evolution Go (default). Omit conversationId so it does NOT persist again.
      const res = await sendWhatsappMessage({ orgId: conv.org_id, to, text: content })
      if (!res.ok) {
        return sendError('wa_send_failed', res.error ?? 'WhatsApp send failed.', 502)
      }
      if (res.messageIds.length) deliveryMetadata.whatsapp_message_ids = res.messageIds
    }
  }

  // Zernio unified social inbox (Instagram, Facebook, LinkedIn, TikTok, etc.)
  if (routeChannel === conv.channel && isZernioChannel(conv.channel)) {
    const metadata = (conv.channel_metadata as Record<string, string>) ?? {}
    const zernioAccountId = metadata.account_id ?? ''

    const apiKey = await getProviderKey('zernio', conv.org_id, supabase)
    if (!apiKey) {
      return sendError(
        'zernio_not_configured',
        'Zernio is not connected for this organization. Add a Zernio API key in Integrations.',
        400,
      )
    }

    try {
      if (!zernioAccountId) {
        return sendError(
          'zernio_no_account_id',
          'This Zernio conversation has no account ID. Reconnect Zernio and wait for a fresh inbound event.',
          400,
        )
      }

      if (metadata.thread_type === 'comment') {
        const postId = metadata.zernio_post_id ?? metadata.zernio_platform_post_id ?? ''
        const commentId = metadata.zernio_comment_id ?? ''
        if (!postId || !commentId) {
          return sendError(
            'zernio_no_comment_context',
            'This Zernio comment thread is missing the post or comment ID required to reply.',
            400,
          )
        }

        const { commentId: replyCommentId } = await sendZernioCommentReply({
          postId,
          accountId: zernioAccountId,
          commentId,
          text: content,
          apiKey,
        })
        if (replyCommentId) deliveryMetadata.zernio_comment_id = replyCommentId
      } else {
        const zernioConversationId = metadata.zernio_conversation_id ?? ''
        if (!zernioConversationId) {
          return sendError(
            'zernio_no_conversation_id',
            'This Zernio conversation has no conversation ID. The channel may not have been set up correctly.',
            400,
          )
        }

        const sentIds: string[] = []
        if (media?.length) {
          for (const [index, item] of media.entries()) {
            const isWhatsAppVoice =
              conv.channel === 'zernio_whatsapp' &&
              item.mime_type.startsWith('audio/') &&
              item.mime_type.includes('ogg')
            const { messageId } = await sendZernioDm(
              zernioConversationId,
              zernioAccountId,
              index === 0 ? content : '',
              apiKey,
              { attachment: item, voiceNote: isWhatsAppVoice },
            )
            if (messageId) sentIds.push(messageId)
          }
        } else {
          const { messageId } = await sendZernioDm(zernioConversationId, zernioAccountId, content, apiKey)
          if (messageId) sentIds.push(messageId)
        }
        if (sentIds.length === 1) deliveryMetadata.zernio_message_id = sentIds[0]
        if (sentIds.length > 1) deliveryMetadata.zernio_message_ids = sentIds
      }
    } catch (err) {
      console.error('[POST messages] Zernio send error:', err)
      const message = err instanceof Error ? err.message : 'Zernio rejected the message.'
      return sendError('zernio_send_failed', message, 502)
    }
  }

  const providerRoute =
    routeChannel === conv.channel &&
    (isZernioChannel(conv.channel) ||
      ['widget', 'web', 'ghl_sms', 'ghl_whatsapp', 'messenger', 'instagram'].includes(conv.channel))
  if (!isNativeRoute && !providerRoute) {
    return sendError(
      'channel_not_sendable',
      `The ${routeChannel || 'selected'} channel is not configured for outbound messages.`,
      400,
    )
  }
  // --- End outbound channel routing ---

  const finalMetadata = { ...msgMetadata, ...deliveryMetadata }

  // SEED-039: stamp channel on each message so multi-channel threads can be
  // filtered + rendered with per-message origin pills. We default to the
  // selected outbound channel, falling back to the conversation's primary channel.
  const { data: msg, error } = await supabase
    .from('conversation_messages')
    .insert({
      conversation_id: id,
      org_id: conv.org_id,
      role,
      content,
      message_type: messageType,
      channel: messageChannel,
      ...(Object.keys(finalMetadata).length > 0 ? { metadata: finalMetadata } : {}),
      ...(routeChannel === 'email'
        ? { email_subject: emailSubject, email_to: emailTo }
        : {}),
    })
    .select('id, conversation_id, role, content, created_at, metadata, channel')
    .single()

  if (error) {
    console.error('[POST messages]', error)
    return sendError(
      'message_persist_failed',
      'The provider accepted the message, but Xphere could not save it in the conversation history.',
      500,
    )
  }

  // Update last_message and last_message_at on parent conversation
  await supabase
    .from('conversations')
    .update({ last_message: lastMessageDisplay, last_message_at: msg.created_at, updated_at: new Date().toISOString() })
    .eq('id', id)

  const message: ConversationMessage = {
    id: msg.id,
    conversationId: msg.conversation_id,
    role: msg.role,
    content: msg.content,
    createdAt: msg.created_at,
    metadata: msg.metadata as Record<string, unknown> | null,
    channel: msg.channel ?? null,
  }

  return Response.json({ message }, { status: 201 })
}

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
      ...(Object.keys(msgMetadata).length > 0 ? { metadata: msgMetadata } : {}),
      ...(conv.channel === 'email'
        ? { email_subject: emailSubject, email_to: conv.visitor_email }
        : {}),
    })
    .select('id, conversation_id, role, content, created_at, metadata, channel')
    .single()

  if (error) {
    console.error('[POST messages]', error)
    return Response.json({ error: 'Failed to send message' }, { status: 500 })
  }

  // Compute last_message | use media label when content is empty
  let lastMessageDisplay = content
  if (!content && media?.length) {
    const first = media[0]
    if (first.mime_type.startsWith('image/')) lastMessageDisplay = '📷 Foto'
    else if (first.mime_type.startsWith('audio/')) lastMessageDisplay = '🎵 Áudio'
    else if (first.mime_type.startsWith('video/')) lastMessageDisplay = '🎬 Vídeo'
    else lastMessageDisplay = `📎 ${first.filename ?? 'Arquivo'}`
  }

  // Update last_message and last_message_at on parent conversation
  await supabase
    .from('conversations')
    .update({ last_message: lastMessageDisplay, last_message_at: msg.created_at, updated_at: new Date().toISOString() })
    .eq('id', id)

  // --- Outbound channel routing ---
  // DB insert and last_message update are complete for ALL channels at this point.
  // Widget: no outbound call needed | SSE picks up the persisted message.
  // Messenger / Instagram: call Meta Send API synchronously.
  // GHL (ghl_sms / ghl_whatsapp): send via GHL Conversations API.
  if (conv.channel === 'ghl_sms' || conv.channel === 'ghl_whatsapp') {
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
      return Response.json({ error: 'ghl_channel_not_configured' }, { status: 400 })
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
      console.error('[POST messages] GHL send error:', err)
      return Response.json({ error: 'ghl_send_failed' }, { status: 502 })
    }
  }

  if (conv.channel === 'messenger' || conv.channel === 'instagram') {
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
      return Response.json({ error: 'channel_not_configured' }, { status: 400 })
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
        return Response.json({ error: 'token_revoked', channel: conv.channel }, { status: 400 })
      }
      return Response.json({ error: 'meta_send_failed', message: result.error }, { status: 502 })
    }
  }

  // Native Twilio SMS: send via the org's Twilio credentials. The recipient is
  // the conversation's visitor phone (set when the thread was created/opened
  // for the contact) or the stored to_number.
  if (conv.channel === 'sms') {
    const metadata = (conv.channel_metadata as Record<string, string>) ?? {}
    const to = conv.visitor_phone ?? metadata.to_number ?? ''
    if (!to) {
      return Response.json({ error: 'sms_no_recipient' }, { status: 400 })
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
          conversationId: id,
        },
      )
    } catch (err) {
      console.error('[POST messages] Twilio SMS send error:', err)
      const message = err instanceof Error ? err.message : 'sms_send_failed'
      return Response.json({ error: 'sms_send_failed', message }, { status: 502 })
    }
  }

  // Email: send via the org's Resend (tenant) integration.
  if (conv.channel === 'email') {
    const to = conv.visitor_email ?? ''
    if (!to) {
      return Response.json({ error: 'email_no_recipient' }, { status: 400 })
    }
    const safe = content
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
    const html = `<div style="white-space:pre-wrap;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;">${safe}</div>`
    const res = await sendTenantEmail(conv.org_id, to, emailSubject, html)
    if (res.error) {
      return Response.json({ error: 'email_send_failed', message: res.error }, { status: 502 })
    }
  }

  // Native WhatsApp (Evolution or Meta Cloud). The route already persisted the
  // message row above, so we use the low-level senders (no extra persistence).
  if (conv.channel === 'whatsapp') {
    const metadata = (conv.channel_metadata as Record<string, string>) ?? {}
    const to = conv.visitor_phone ?? metadata.to_number ?? metadata.sender_jid ?? ''
    if (!to) {
      return Response.json({ error: 'wa_no_recipient' }, { status: 400 })
    }
    if (metadata.provider === 'meta_cloud') {
      const account = await getActiveCloudAccount(conv.org_id)
      if (!account) {
        return Response.json({ error: 'wa_not_configured' }, { status: 400 })
      }
      const res = await sendCloudText({ account, to, body: content })
      if (!res.ok) {
        return Response.json(
          { error: 'wa_send_failed', message: res.error, outsideWindow: res.outsideWindow },
          { status: 502 },
        )
      }
    } else {
      // Evolution Go (default). Omit conversationId so it does NOT persist again.
      const res = await sendWhatsappMessage({ orgId: conv.org_id, to, text: content })
      if (!res.ok) {
        return Response.json({ error: 'wa_send_failed', message: res.error }, { status: 502 })
      }
    }
  }
  // --- End outbound channel routing ---


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

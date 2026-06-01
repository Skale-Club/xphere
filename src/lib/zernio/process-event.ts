// src/lib/zernio/process-event.ts
// Processes validated Zernio inbox webhook payloads.
//
// Flow:
//   1. Deduplicate by Zernio webhook event id
//   2. Resolve/create contact via contact_channel_identities(provider='zernio')
//   3. normalizeInbound() -> find-or-create conversation + insert message
//   4. If bot_status='active': runAgent() -> reply via Zernio

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { normalizeInbound } from '@/lib/messaging/normalize-inbound'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { findByChannelIdentity, attachChannelIdentity } from '@/lib/contacts/server'
import { sendZernioDm } from './send-dm'
import { sendZernioCommentReply } from './send-comment-reply'
import { zernioChannel } from './channel'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { conversationChannelToAgentChannel } from '@/lib/agents/channel-map'
import { normalisePhone } from '@/lib/contacts/zod-schemas'
import type {
  ZernioCommentReceivedPayload,
  ZernioMessageReceivedPayload,
  ZernioWebhookPayload,
} from './types'

export type { ZernioWebhookPayload } from './types'

function isMessageReceived(payload: ZernioWebhookPayload): payload is ZernioMessageReceivedPayload {
  return payload.event === 'message.received' && typeof payload.message === 'object'
}

function isCommentReceived(payload: ZernioWebhookPayload): payload is ZernioCommentReceivedPayload {
  return payload.event === 'comment.received' && typeof payload.comment === 'object'
}

function identityKey(platform: string, accountId: string, participantId: string): string {
  return `${platform}:${accountId}:${participantId}`
}

function zernioContactIdentityKey(platform: string, accountId: string, contactId: string): string {
  return `${platform}:${accountId}:contact:${contactId}`
}

function contactSourceForPlatform(platform: string): 'manual' | 'whatsapp' | 'instagram' | 'facebook' | 'messenger' {
  if (platform === 'whatsapp') return 'whatsapp'
  if (platform === 'instagram') return 'instagram'
  if (platform === 'facebook') return 'facebook'
  if (platform === 'messenger') return 'messenger'
  return 'manual'
}

function splitDisplayName(displayName: string | null): { first_name: string | null; last_name: string | null } {
  const parts = displayName?.trim().split(/\s+/).filter(Boolean) ?? []
  if (parts.length === 0) return { first_name: null, last_name: null }
  return {
    first_name: parts[0] ?? null,
    last_name: parts.length > 1 ? parts.slice(1).join(' ') : null,
  }
}

function mimeTypeForZernioAttachment(attachment: { type: string; payload?: Record<string, unknown> }): string {
  const payloadMime = attachment.payload?.mimeType
  if (typeof payloadMime === 'string' && payloadMime.trim()) return payloadMime
  if (attachment.type === 'image') return 'image/jpeg'
  if (attachment.type === 'audio') return 'audio/ogg'
  if (attachment.type === 'video') return 'video/mp4'
  return 'application/octet-stream'
}

function proxiedZernioMediaUrl(url: string): string {
  return `/api/zernio/media?url=${encodeURIComponent(url)}`
}

function mediaLabel(attachments: Array<{ type: string }> | undefined): string {
  const firstType = attachments?.[0]?.type
  if (!firstType) return ''
  if (firstType === 'audio') return 'Audio'
  if (firstType === 'image') return 'Image'
  if (firstType === 'video') return 'Video'
  return 'File'
}

function messageTypeForAttachments(
  text: string,
  attachments: Array<{ type: string }> | undefined,
): string {
  if (!attachments?.length) return 'text'
  if (text) return 'mixed'
  const firstType = attachments[0]?.type
  if (firstType === 'audio') return 'audio'
  if (firstType === 'image') return 'image'
  if (firstType === 'video') return 'video'
  return 'document'
}

async function markWebhookEventSeen(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orgId: string,
  eventId: string | undefined,
  eventType: string | undefined,
): Promise<boolean> {
  if (!eventId) return true

  const { error } = await supabase
    .from('zernio_webhook_events')
    .insert({
      organization_id: orgId,
      event_id: eventId,
      event_type: eventType ?? 'unknown',
    })

  if (!error) return true
  if (error.code === '23505') return false

  console.error('[zernio/process] webhook idempotency insert failed:', error.message)
  return true
}

async function resolveOrCreateChannelContact({
  supabase,
  orgId,
  platform,
  accountId,
  participantId,
  zernioContactId,
  phoneNumber,
  displayName,
}: {
  supabase: ReturnType<typeof createServiceRoleClient>
  orgId: string
  platform: string
  accountId: string
  participantId: string
  zernioContactId?: string | null
  phoneNumber?: string | null
  displayName: string | null
}): Promise<string | null> {
  if (!participantId || !accountId) return null

  const identityKeys = [
    zernioContactId ? zernioContactIdentityKey(platform, accountId, zernioContactId) : null,
    identityKey(platform, accountId, participantId),
  ].filter((v): v is string => Boolean(v))

  const normalizedPhone = normalisePhone(phoneNumber)
  const phoneHit = normalizedPhone
    ? await supabase
        .from('contacts')
        .select('id')
        .eq('org_id', orgId)
        .eq('phone_e164', normalizedPhone)
        .neq('identity_status', 'archived_duplicate')
        .maybeSingle()
    : { data: null }

  for (const externalId of identityKeys) {
    const channelHit = await findByChannelIdentity(supabase, orgId, 'zernio', externalId)
    if (channelHit) {
      if (phoneHit.data?.id && phoneHit.data.id !== channelHit.contact_id && channelHit.identity_status === 'channel_only') {
        await supabase
          .from('contacts')
          .update({
            identity_status: 'archived_duplicate',
            merged_into_contact_id: phoneHit.data.id,
          })
          .eq('id', channelHit.contact_id)
        await supabase
          .from('contact_channel_identities')
          .delete()
          .eq('org_id', orgId)
          .eq('provider', 'zernio')
          .eq('contact_id', channelHit.contact_id)
        for (const key of identityKeys) {
          await attachChannelIdentity(supabase, orgId, phoneHit.data.id, 'zernio', key)
        }
        await supabase
          .from('conversations')
          .update({ contact_id: phoneHit.data.id })
          .eq('org_id', orgId)
          .eq('contact_id', channelHit.contact_id)
        return phoneHit.data.id
      }
      return channelHit.contact_id
    }
  }

  if (phoneHit.data?.id) {
    for (const externalId of identityKeys) {
      await attachChannelIdentity(supabase, orgId, phoneHit.data.id, 'zernio', externalId)
    }
    return phoneHit.data.id
  }

  const nameParts = splitDisplayName(displayName)

  const { data: created, error: insertError } = await supabase
    .from('contacts')
    .insert({
      org_id: orgId,
      first_name: nameParts.first_name,
      last_name: nameParts.last_name,
      name: displayName,
      phone: normalizedPhone,
      source: contactSourceForPlatform(platform),
      identity_status: normalizedPhone ? 'identified' : 'channel_only',
    })
    .select('id')
    .single()

  if (insertError) {
    console.error('[zernio/process] insert contact error:', insertError.message)
    return null
  }

  const createdContactId = created?.id ?? null
  if (!createdContactId) return null

  for (const externalId of identityKeys) {
    const attached = await attachChannelIdentity(supabase, orgId, createdContactId, 'zernio', externalId)
    if (attached?.contact_id && attached.contact_id !== createdContactId) {
      await supabase.from('contacts').delete().eq('id', createdContactId)
      return attached.contact_id
    }
  }

  return createdContactId
}

export async function processZernioEvent(
  payload: ZernioWebhookPayload,
  orgId: string,
): Promise<void> {
  const supabase = createServiceRoleClient()

  const firstTime = await markWebhookEventSeen(supabase, orgId, payload.id, payload.event)
  if (!firstTime) return

  if (isMessageReceived(payload)) {
    await processMessageReceived(payload, orgId, supabase)
    return
  }

  if (isCommentReceived(payload)) {
    await processCommentReceived(payload, orgId, supabase)
  }
}

async function processMessageReceived(
  payload: ZernioMessageReceivedPayload,
  orgId: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  const msg = payload.message
  if (msg.direction !== 'incoming') return

  const zernioMessageId = msg.id
  const zernioPlatformMessageId = msg.platformMessageId
  const zernioConversationId = msg.conversationId || payload.conversation.id
  const zernioAccountId = payload.account.id
  const platform = msg.platform || payload.account.platform || 'unknown'
  const participantId =
    msg.sender.businessScopedUserId ??
    msg.sender.phoneNumber ??
    msg.sender.id ??
    payload.conversation.participantId ??
    ''
  const senderName =
    msg.sender.name ??
    payload.conversation.participantName ??
    msg.sender.username ??
    payload.conversation.participantUsername ??
    null
  const messageText = msg.text ?? ''
  const channel = zernioChannel(platform)

  if (!zernioConversationId || !zernioAccountId || !participantId) {
    console.warn('[zernio/process] Missing required message routing fields; skipping')
    return
  }

  const contactId = await resolveOrCreateChannelContact({
    supabase,
    orgId,
    platform,
    accountId: zernioAccountId,
    participantId,
    zernioContactId: msg.sender.contactId ?? payload.conversation.contactId ?? null,
    phoneNumber: msg.sender.phoneNumber ?? null,
    displayName: senderName,
  })

  const fallback = mediaLabel(msg.attachments)
  const displayText = messageText || fallback
  const sentAt = msg.sentAt || payload.timestamp || new Date().toISOString()
  const media = msg.attachments.map((attachment) => ({
    url: proxiedZernioMediaUrl(attachment.url),
    original_url: attachment.url,
    mime_type: mimeTypeForZernioAttachment(attachment),
    filename:
      typeof attachment.payload?.filename === 'string'
        ? attachment.payload.filename
        : `${attachment.type}-${attachment.payload?.id ?? zernioMessageId}`,
    provider: 'zernio',
    zernio_media_id: typeof attachment.payload?.id === 'string' ? attachment.payload.id : undefined,
  }))
  const updatePayload: Record<string, unknown> = {
    last_message: displayText,
    last_message_at: sentAt,
    last_inbound_at: sentAt,
    updated_at: new Date().toISOString(),
    visitor_name: senderName,
    visitor_phone: msg.sender.phoneNumber ?? null,
  }
  if (contactId) updatePayload.contact_id = contactId

  const norm = await normalizeInbound({
    supabase,
    orgId,
    channel,
    match: {
      by: 'metadata',
      keys: { account_id: zernioAccountId, zernio_conversation_id: zernioConversationId },
    },
    updatePayload,
    createPayload: {
      widget_token: '',
      channel_metadata: {
        thread_type: 'dm',
        platform,
        account_id: zernioAccountId,
        account_username: payload.account.username ?? null,
        zernio_conversation_id: zernioConversationId,
        zernio_platform_conversation_id: payload.conversation.platformConversationId,
        participant_id: participantId,
        participant_username: payload.conversation.participantUsername ?? msg.sender.username ?? null,
      },
      visitor_name: senderName,
      visitor_phone: msg.sender.phoneNumber ?? null,
      contact_id: contactId,
      last_message: displayText,
      last_message_at: sentAt,
      last_inbound_at: sentAt,
    },
    message: {
      role: 'user',
      content: messageText,
      created_at: sentAt,
      message_type: messageTypeForAttachments(messageText, msg.attachments),
      channel,
      metadata: {
        zernio_event_id: payload.id,
        zernio_message_id: zernioMessageId,
        zernio_platform_message_id: zernioPlatformMessageId,
        zernio_conversation_id: zernioConversationId,
        account_id: zernioAccountId,
        platform,
        attachments: msg.attachments,
        media,
      },
    },
    idempotencyMetadata: { zernio_message_id: zernioMessageId },
  })

  if (norm.error) {
    console.error('[zernio/process] normalizeInbound failed:', norm.error)
    return
  }
  if (norm.duplicate) return

  await maybeRunAgentAndReply({
    supabase,
    orgId,
    channel,
    conversationId: norm.conversationId,
    existingBotStatus: norm.existing?.bot_status ?? null,
    userMessage: messageText,
    reply: async (text, apiKey) => {
      await sendZernioDm(zernioConversationId, zernioAccountId, text, apiKey)
    },
  })
}

async function processCommentReceived(
  payload: ZernioCommentReceivedPayload,
  orgId: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  const comment = payload.comment
  const zernioAccountId = payload.account.id
  const platform = comment.platform || payload.account.platform || 'unknown'
  const participantId = comment.author.id
  const senderName = comment.author.name ?? comment.author.username ?? null
  const postId = payload.post.id ?? comment.postId ?? comment.platformPostId
  const channel = zernioChannel(platform)
  const now = new Date().toISOString()

  if (!zernioAccountId || !participantId || !postId || !comment.id) {
    console.warn('[zernio/process] Missing required comment routing fields; skipping')
    return
  }

  const contactId = await resolveOrCreateChannelContact({
    supabase,
    orgId,
    platform,
    accountId: zernioAccountId,
    participantId,
    displayName: senderName,
  })

  const norm = await normalizeInbound({
    supabase,
    orgId,
    channel,
    match: { by: 'metadata', keys: { zernio_comment_id: comment.id } },
    updatePayload: {
      last_message: comment.text,
      last_message_at: now,
      last_inbound_at: now,
      updated_at: now,
    },
    createPayload: {
      widget_token: '',
      channel_metadata: {
        thread_type: 'comment',
        platform,
        account_id: zernioAccountId,
        account_username: payload.account.username ?? null,
        zernio_post_id: postId,
        zernio_platform_post_id: comment.platformPostId,
        zernio_comment_id: comment.id,
        zernio_parent_comment_id: comment.parentCommentId,
        participant_id: participantId,
        participant_username: comment.author.username ?? null,
        is_ad_comment: Boolean(comment.ad),
      },
      visitor_name: senderName,
      contact_id: contactId,
      last_message: comment.text,
      last_message_at: now,
      last_inbound_at: now,
    },
    message: {
      role: 'user',
      content: comment.text,
      message_type: 'text',
      channel,
      metadata: {
        zernio_event_id: payload.id,
        zernio_comment_id: comment.id,
        zernio_post_id: postId,
        zernio_platform_post_id: comment.platformPostId,
        account_id: zernioAccountId,
        platform,
        parent_comment_id: comment.parentCommentId,
        is_reply: comment.isReply,
        ad: comment.ad ?? null,
      },
    },
    idempotencyMetadata: { zernio_comment_id: comment.id },
  })

  if (norm.error) {
    console.error('[zernio/process] normalizeInbound failed:', norm.error)
    return
  }
  if (norm.duplicate) return

  await maybeRunAgentAndReply({
    supabase,
    orgId,
    channel,
    conversationId: norm.conversationId,
    existingBotStatus: norm.existing?.bot_status ?? null,
    userMessage: comment.text,
    reply: async (text, apiKey) => {
      await sendZernioCommentReply({
        postId,
        accountId: zernioAccountId,
        commentId: comment.id,
        text,
        apiKey,
      })
    },
  })
}

async function maybeRunAgentAndReply({
  supabase,
  orgId,
  channel,
  conversationId,
  existingBotStatus,
  userMessage,
  reply,
}: {
  supabase: ReturnType<typeof createServiceRoleClient>
  orgId: string
  channel: string
  conversationId: string
  existingBotStatus: string | null
  userMessage: string
  reply: (text: string, apiKey: string) => Promise<void>
}): Promise<void> {
  const botStatus = existingBotStatus ?? 'active'
  if (botStatus !== 'active') return
  if (!userMessage) return

  // Map the Zernio platform channel (e.g. zernio_instagram) to the agent channel
  // (instagram). Platforms without an agent channel get no auto-reply.
  const agentChannel = conversationChannelToAgentChannel(channel)
  if (!agentChannel) return

  const { data: defaultRow } = await supabase
    .from('agent_channel_defaults')
    .select('agent_id')
    .eq('organization_id', orgId)
    .eq('channel', agentChannel)
    .maybeSingle()

  if (!defaultRow?.agent_id) return

  try {
    const apiKey = await getProviderKey('zernio', orgId, supabase)
    if (!apiKey) {
      console.warn('[zernio/process] No active Zernio integration for org:', orgId)
      return
    }

    const result = await runAgent({
      orgId,
      agentId: defaultRow.agent_id,
      channel: agentChannel,
      userMessage,
      conversationId,
      stream: false,
    })

    if (!result.text) return

    await reply(result.text, apiKey)
  } catch (err) {
    console.error('[zernio/process] runAgent/send error:', err)
  }
}

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
import { storeMediaFromUrl } from '@/lib/chat/store-media'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { loadHistoryWindow } from '@/lib/agent-runtime/load-history'
import { findByChannelIdentity, attachChannelIdentity, backfillContactPhone } from '@/lib/contacts/server'
import { storeContactAvatarFromUrl } from '@/lib/contacts/store-avatar'
import { sendZernioDm } from './send-dm'
import { sendZernioCommentReply } from './send-comment-reply'
import { zernioChannel } from './channel'
import { emitCommentEvent } from './events'
import { getProviderKey } from '@/lib/integrations/get-provider-key'
import { conversationChannelToAgentChannel } from '@/lib/agents/channel-map'
import { normalisePhone } from '@/lib/contacts/zod-schemas'
import type {
  ZernioCommentReceivedPayload,
  ZernioWebhookMessage,
  ZernioMessageReceivedPayload,
  ZernioMessageSentPayload,
  ZernioMessageStatusPayload,
  ZernioDeliveryStatus,
  ZernioTemplateStatusChangedPayload,
  ZernioWebhookPayload,
} from './types'

export type { ZernioWebhookPayload } from './types'

function isMessageReceived(payload: ZernioWebhookPayload): payload is ZernioMessageReceivedPayload {
  return payload.event === 'message.received' && typeof payload.message === 'object'
}

function isMessageSent(payload: ZernioWebhookPayload): payload is ZernioMessageSentPayload {
  return payload.event === 'message.sent' && typeof payload.message === 'object'
}

function isMessageStatusChanged(payload: ZernioWebhookPayload): payload is ZernioMessageStatusPayload {
  return (
    (payload.event === 'message.delivered' ||
      payload.event === 'message.read' ||
      payload.event === 'message.failed') &&
    typeof payload.message === 'object'
  )
}

// Outbound delivery lifecycle, ascending. Never let a later/out-of-order event
// downgrade the status; `failed` is terminal and only `sent` may precede it.
const DELIVERY_STATUS_RANK: Record<ZernioDeliveryStatus, number> = {
  sent: 0,
  delivered: 1,
  read: 2,
  failed: 3,
}

function eventToDeliveryStatus(event: string): ZernioDeliveryStatus | null {
  if (event === 'message.delivered') return 'delivered'
  if (event === 'message.read') return 'read'
  if (event === 'message.failed') return 'failed'
  return null
}

// The send-API messageId stored by the Xphere UI (route.ts) may equal either the
// webhook msg.id or its platformMessageId, so we probe every id pairing. Used for
// both echo dedup and delivery-status matching.
function outgoingIdCandidates(
  messageId: string | undefined,
  platformMessageId: string | undefined,
): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = []
  if (messageId) out.push({ zernio_message_id: messageId })
  if (platformMessageId) {
    out.push({ zernio_platform_message_id: platformMessageId })
    out.push({ zernio_message_id: platformMessageId })
  }
  return out
}

// Finds an existing outbound (role='assistant') message by any id candidate.
// Uses one .contains() per candidate (supabase-js URL-encodes the jsonb value,
// unlike an inline .or() filter which mis-parses ids containing dots/=, e.g.
// WhatsApp wamids).
async function findOutgoingMessageByIds(
  supabase: ReturnType<typeof createServiceRoleClient>,
  candidates: Array<Record<string, string>>,
  scope: { conversationId?: string; orgId?: string },
): Promise<{ id: string; metadata: Record<string, unknown> | null } | null> {
  for (const candidate of candidates) {
    let query = supabase
      .from('conversation_messages')
      .select('id, metadata')
      .eq('role', 'assistant')
      .contains('metadata', candidate as never)
    if (scope.conversationId) query = query.eq('conversation_id', scope.conversationId)
    if (scope.orgId) query = query.eq('org_id', scope.orgId)
    const { data } = await query.order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (data) return data as { id: string; metadata: Record<string, unknown> | null }
  }
  return null
}

function isCommentReceived(payload: ZernioWebhookPayload): payload is ZernioCommentReceivedPayload {
  return payload.event === 'comment.received' && typeof payload.comment === 'object'
}

function isTemplateStatusChanged(
  payload: ZernioWebhookPayload,
): payload is ZernioTemplateStatusChangedPayload {
  return (
    (payload.event === 'whatsapp.template.status_updated' ||
      payload.event === 'whatsapp.template.status_changed') &&
    typeof (payload as ZernioTemplateStatusChangedPayload).template === 'object'
  )
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

// Um "nome" que na verdade é só o telefone (caso comum do WhatsApp Cloud, onde o
// Zernio manda participantUsername = número) não deve poluir o contato — assim ele
// continua enriquecível e a UI cai no fallback de telefone (displayNameOf).
function realDisplayName(name: string | null, phone: string | null): string | null {
  const trimmed = name?.trim() || null
  if (!trimmed) return null
  const nameDigits = trimmed.replace(/[^0-9]/g, '')
  const phoneDigits = (phone ?? '').replace(/[^0-9]/g, '')
  if (nameDigits && phoneDigits && nameDigits === phoneDigits) return null
  return trimmed
}

// Preenche o nome do contato quando um nome real aparece, sem nunca sobrescrever
// um nome já definido por operador/CRM. "Vazio" = null/branco ou só o telefone.
// Fire-and-forget (non-fatal).
async function maybeBackfillContactName(
  supabase: ReturnType<typeof createServiceRoleClient>,
  contactId: string,
  realName: string | null,
  phone: string | null,
): Promise<void> {
  if (!contactId || !realName) return
  const { data } = await supabase
    .from('contacts')
    .select('name, phone_e164')
    .eq('id', contactId)
    .maybeSingle()
  if (realDisplayName(data?.name ?? null, data?.phone_e164 ?? phone)) return // já tem nome real
  const parts = splitDisplayName(realName)
  const { error } = await supabase
    .from('contacts')
    .update({ name: realName, first_name: parts.first_name, last_name: parts.last_name })
    .eq('id', contactId)
  if (error) console.warn('[zernio/process] name backfill failed:', error.message)
}

// Persists the sender's avatar on the contact when the platform sends one
// (Instagram/Messenger/Facebook — WhatsApp Cloud never does). Re-hosts the image
// into our `avatars` bucket so it survives the source URL's expiry. Only fills
// when empty — never overwrites a photo an operator uploaded. AWAITED: a prior
// fire-and-forget version lost writes in the webhook's after() context.
// Non-fatal: avatars are best-effort.
async function maybeStoreContactAvatar(
  supabase: ReturnType<typeof createServiceRoleClient>,
  orgId: string,
  contactId: string,
  pictureUrl: string | null,
): Promise<void> {
  if (!contactId || !pictureUrl) return
  const { data } = await supabase
    .from('contacts')
    .select('avatar_url')
    .eq('id', contactId)
    .maybeSingle()
  if (data?.avatar_url) return // already has an avatar (incl. manual upload)

  const publicUrl = await storeContactAvatarFromUrl({ supabase, orgId, contactId, sourceUrl: pictureUrl })
  if (!publicUrl) return

  const { error } = await supabase
    .from('contacts')
    .update({ avatar_url: publicUrl })
    .eq('id', contactId)
  if (error) console.warn('[zernio/process] avatar update failed:', error.message)
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

async function buildZernioMedia({
  supabase,
  orgId,
  zernioConversationId,
  zernioMessageId,
  attachments,
}: {
  supabase: ReturnType<typeof createServiceRoleClient>
  orgId: string
  zernioConversationId: string
  zernioMessageId: string
  attachments: ZernioWebhookMessage['attachments']
}): Promise<Array<Record<string, unknown>>> {
  const zernioMediaKey =
    attachments.length > 0 ? await getProviderKey('zernio', orgId, supabase) : null
  const media: Array<Record<string, unknown>> = []

  for (let i = 0; i < attachments.length; i++) {
    const attachment = attachments[i]
    const mimeType = mimeTypeForZernioAttachment(attachment)
    const stored = zernioMediaKey
      ? await storeMediaFromUrl({
          url: attachment.url,
          mimeType,
          authHeaders: { Authorization: `Bearer ${zernioMediaKey}` },
          orgId,
          conversationId: zernioConversationId,
          messageId: zernioMessageId,
          idx: i,
        })
      : null
    media.push({
      url: stored?.publicUrl ?? proxiedZernioMediaUrl(attachment.url),
      original_url: attachment.url,
      mime_type: mimeType,
      filename:
        typeof attachment.payload?.filename === 'string'
          ? attachment.payload.filename
          : `${attachment.type}-${attachment.payload?.id ?? zernioMessageId}`,
      provider: 'zernio',
      zernio_media_id: typeof attachment.payload?.id === 'string' ? attachment.payload.id : undefined,
    })
  }

  return media
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

  // For WhatsApp the participant id IS the phone number, so fall back to it when
  // the payload omits sender.phoneNumber.
  const effectivePhone = phoneNumber ?? (platform === 'whatsapp' ? participantId : null)
  const normalizedPhone = normalisePhone(effectivePhone)
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
        const { error: mergeError } = await supabase.rpc('merge_zernio_channel_only_contact' as never, {
          p_org_id: orgId,
          p_duplicate_contact_id: channelHit.contact_id,
          p_survivor_contact_id: phoneHit.data.id,
          p_zernio_external_ids: identityKeys,
        } as never)
        if (mergeError) {
          console.error('[zernio/process] merge channel-only contact failed:', mergeError.message)
          return channelHit.contact_id
        }
        return phoneHit.data.id
      }
      // Backfill the phone on contacts that were created without one (the
      // WhatsApp number is known from the participant id).
      await backfillContactPhone(supabase, orgId, channelHit.contact_id, effectivePhone)
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

  // Outbound echo — messages sent by the operator (incl. replies sent from the
  // WhatsApp app, which Zernio captures and re-emits as message.sent).
  if (isMessageSent(payload)) {
    await processOutgoingMessage(payload, orgId, supabase)
    return
  }

  // Delivery lifecycle for an outbound message: update its delivery_status.
  if (isMessageStatusChanged(payload)) {
    await processMessageStatusChanged(payload, orgId, supabase)
    return
  }

  if (isCommentReceived(payload)) {
    await processCommentReceived(payload, orgId, supabase)
    return
  }

  if (isTemplateStatusChanged(payload)) {
    await processTemplateStatusChanged(payload, orgId, supabase)
  }
}

async function processMessageReceived(
  payload: ZernioMessageReceivedPayload,
  orgId: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  const msg = payload.message
  if (msg.direction === 'outgoing') {
    await processOutgoingMessage(payload, orgId, supabase)
    return
  }
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
  const rawName =
    msg.sender.name ??
    payload.conversation.participantName ??
    msg.sender.username ??
    payload.conversation.participantUsername ??
    null
  const phoneForName = msg.sender.phoneNumber ?? (platform === 'whatsapp' ? participantId : null)
  const senderName = realDisplayName(rawName, phoneForName)
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

  // Re-host Zernio media in our chat-media bucket so it survives Zernio URL
  // expiry and never needs the org API key at view time. Falls back to the
  // authenticated proxy URL when ingestion fails (network/storage hiccup).
  const media = await buildZernioMedia({
    supabase,
    orgId,
    zernioConversationId,
    zernioMessageId,
    attachments: msg.attachments,
  })
  const updatePayload: Record<string, unknown> = {
    last_message: displayText,
    last_message_at: sentAt,
    last_inbound_at: sentAt,
    updated_at: new Date().toISOString(),
    visitor_phone: msg.sender.phoneNumber ?? null,
  }
  // Só atualiza o nome quando há um nome real — evita que uma mensagem posterior
  // só-com-número apague um nome já conhecido na conversa.
  if (senderName) updatePayload.visitor_name = senderName
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

  // Persist sender avatar (re-hosted) when the platform sends one.
  const inboundPicture = msg.sender.picture ?? payload.conversation.participantPicture ?? null
  if (contactId) await maybeStoreContactAvatar(supabase, orgId, contactId, inboundPicture)

  // Preenche o nome do contato assim que um nome real chega (conversa nova ou
  // existente). Não sobrescreve nome já definido.
  if (contactId) await maybeBackfillContactName(supabase, contactId, senderName, phoneForName)

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

async function processOutgoingMessage(
  payload: ZernioMessageReceivedPayload | ZernioMessageSentPayload,
  orgId: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  const msg = payload.message
  const zernioMessageId = msg.id
  const zernioPlatformMessageId = msg.platformMessageId
  const zernioConversationId = msg.conversationId || payload.conversation.id
  const zernioAccountId = payload.account.id
  const platform = msg.platform || payload.account.platform || 'unknown'
  const channel = zernioChannel(platform)
  const participantId =
    payload.conversation.participantId ??
    msg.sender.businessScopedUserId ??
    msg.sender.phoneNumber ??
    msg.sender.id ??
    ''
  const participantName =
    payload.conversation.participantName ??
    payload.conversation.participantUsername ??
    msg.sender.name ??
    msg.sender.username ??
    null
  const participantPhone = platform === 'whatsapp' ? participantId : null
  const messageText = msg.text ?? ''
  const fallback = mediaLabel(msg.attachments)
  const displayText = messageText || fallback
  const sentAt = msg.sentAt || payload.timestamp || new Date().toISOString()

  if (!zernioConversationId || !zernioAccountId) {
    console.warn('[zernio/process] Missing outgoing message routing fields; skipping')
    return
  }

  const { data: existing } = await supabase
    .from('conversations')
    .select('id, contact_id, last_message_at')
    .eq('org_id', orgId)
    .eq('channel', channel)
    .eq('channel_metadata->>account_id', zernioAccountId)
    .eq('channel_metadata->>zernio_conversation_id', zernioConversationId)
    .maybeSingle()

  const existingRow = existing as { id: string; contact_id: string | null; last_message_at: string | null } | null
  let conversationId = existingRow?.id ?? null
  let contactId = existingRow?.contact_id ?? null

  if (!conversationId) {
    contactId = participantId
      ? await resolveOrCreateChannelContact({
          supabase,
          orgId,
          platform,
          accountId: zernioAccountId,
          participantId,
          zernioContactId: payload.conversation.contactId ?? null,
          phoneNumber: participantPhone,
          displayName: participantName,
        })
      : null

    const { data: created, error } = await supabase
      .from('conversations')
      .insert({
        org_id: orgId,
        widget_token: '',
        channel,
        channel_metadata: {
          thread_type: 'dm',
          platform,
          account_id: zernioAccountId,
          account_username: payload.account.username ?? null,
          zernio_conversation_id: zernioConversationId,
          zernio_platform_conversation_id: payload.conversation.platformConversationId,
          participant_id: participantId,
          participant_username: payload.conversation.participantUsername ?? null,
        },
        visitor_name: participantName,
        visitor_phone: participantPhone,
        contact_id: contactId,
        last_message: displayText,
        last_message_at: sentAt,
      } as never)
      .select('id')
      .single()

    if (error || !created) {
      console.error('[zernio/process] create outgoing conversation failed:', error?.message)
      return
    }
    conversationId = (created as { id: string }).id
  }

  // Dedup against a message already inserted by the Xphere send path
  // (route.ts stamps metadata.zernio_message_id with the send-API messageId) and
  // against a re-delivered webhook.
  const dup = await findOutgoingMessageByIds(
    supabase,
    outgoingIdCandidates(zernioMessageId, zernioPlatformMessageId),
    { conversationId: conversationId as string },
  )
  if (dup) return

  const media = await buildZernioMedia({
    supabase,
    orgId,
    zernioConversationId,
    zernioMessageId,
    attachments: msg.attachments,
  })

  const { error: msgError } = await supabase
    .from('conversation_messages')
    .insert({
      org_id: orgId,
      conversation_id: conversationId,
      role: 'assistant',
      content: messageText,
      created_at: sentAt,
      message_type: messageTypeForAttachments(messageText, msg.attachments),
      channel,
      metadata: {
        direction: 'outgoing',
        source: 'zernio_echo',
        delivery_status: 'sent',
        zernio_event_id: payload.id,
        zernio_message_id: zernioMessageId,
        zernio_platform_message_id: zernioPlatformMessageId,
        zernio_conversation_id: zernioConversationId,
        account_id: zernioAccountId,
        platform,
        attachments: msg.attachments,
        media,
      },
    } as never)

  if (msgError) {
    console.error('[zernio/process] insert outgoing message failed:', msgError.message)
    return
  }

  const shouldBumpPreview =
    !existingRow?.last_message_at ||
    new Date(sentAt).getTime() > new Date(existingRow.last_message_at).getTime()
  if (shouldBumpPreview) {
    await supabase
      .from('conversations')
      .update({
        last_message: displayText,
        last_message_at: sentAt,
        updated_at: new Date().toISOString(),
      } as never)
      .eq('id', conversationId)
  }
}

// Updates the delivery_status of a previously-stored outbound message when
// Zernio reports delivered/read/failed. Matches the row by zernio_message_id or
// zernio_platform_message_id and never downgrades a higher status (out-of-order
// safe). A status event may arrive before its message.sent echo — in that case
// there is no row yet and we simply skip; the next status (or a re-delivery)
// reconciles it.
async function processMessageStatusChanged(
  payload: ZernioMessageStatusPayload,
  orgId: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  const newStatus = eventToDeliveryStatus(payload.event)
  if (!newStatus) return

  const zernioMessageId = payload.message.id
  const zernioPlatformMessageId = payload.message.platformMessageId
  if (!zernioMessageId && !zernioPlatformMessageId) {
    console.warn('[zernio/process] status event missing message id; skipping')
    return
  }

  const target = await findOutgoingMessageByIds(
    supabase,
    outgoingIdCandidates(zernioMessageId, zernioPlatformMessageId),
    { orgId },
  )
  if (!target) return // message.sent echo not yet stored; skip

  const current = (target.metadata?.delivery_status as ZernioDeliveryStatus | undefined) ?? 'sent'
  // Don't downgrade (delivered after read) and don't move off the terminal failed.
  if (current === 'failed') return
  if (DELIVERY_STATUS_RANK[newStatus] <= DELIVERY_STATUS_RANK[current]) return

  const { error } = await supabase
    .from('conversation_messages')
    .update({ metadata: { ...(target.metadata ?? {}), delivery_status: newStatus } } as never)
    .eq('id', target.id)

  if (error) {
    console.error('[zernio/process] delivery status update failed:', error.message)
  }
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
  const senderName = realDisplayName(comment.author.name ?? comment.author.username ?? null, null)
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

  // Persist author avatar (re-hosted) when the platform sends one.
  const inboundPicture = comment.author.picture ?? null
  if (contactId) await maybeStoreContactAvatar(supabase, orgId, contactId, inboundPicture)

  if (contactId) await maybeBackfillContactName(supabase, contactId, senderName, null)

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

  void emitCommentEvent(orgId, {
    platform,
    post_id: postId,
    comment_id: comment.id,
    text: comment.text,
    author_id: participantId,
    author_name: senderName,
    author_username: comment.author.username ?? null,
    is_reply: Boolean(comment.isReply),
    is_ad_comment: Boolean(comment.ad),
    conversation_id: norm.conversationId,
    contact_id: contactId ?? null,
  }, { supabase }).catch(() => {})
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

    const historyWindow = await loadHistoryWindow({
      supabase,
      conversationId,
      currentUserMessage: userMessage,
    })
    const result = await runAgent({
      orgId,
      agentId: defaultRow.agent_id,
      channel: agentChannel,
      userMessage,
      conversationId,
      historyWindow,
      stream: false,
    })

    if (!result.text) return

    await reply(result.text, apiKey)
  } catch (err) {
    console.error('[zernio/process] runAgent/send error:', err)
  }
}

// ── Template status tracking ──────────────────────────────────────────────────

async function processTemplateStatusChanged(
  payload: ZernioTemplateStatusChangedPayload,
  orgId: string,
  supabase: ReturnType<typeof createServiceRoleClient>,
): Promise<void> {
  const { name, status, language } = payload.template
  if (!name || !status) return

  const normalizedStatus = status.toUpperCase()
  const validStatuses = ['PENDING', 'APPROVED', 'REJECTED', 'DISABLED']
  if (!validStatuses.includes(normalizedStatus)) return

  const { error } = await supabase
    .from('zernio_whatsapp_templates')
    .update({ status: normalizedStatus, updated_at: new Date().toISOString() })
    .eq('org_id', orgId)
    .eq('name', name)
    .eq('language', language)

  if (error) {
    console.error('[zernio/process] template status update error:', error)
  }
}

// src/lib/evolution/process-event.ts
// Normalizes Evolution Go webhook payloads into Operator domain events.
// Called from /api/evolution/webhook via after() | never throws.
//
// Pipeline for messages.upsert:
//   1. Resolve instance + org from instanceName.
//   2. Skip echoes (fromMe=true) and non-text events for now.
//   3. Upsert conversation by (org_id, channel='whatsapp', visitor_phone=from).
//   4. Lookup or create contact by phone.
//   5. Insert inbound user message (idempotent by Evolution message id).
//   6. If bot_status='active' AND an agent is configured for channel='whatsapp',
//      invoke runAgent({channel:'whatsapp', stream:false}) and dispatch reply
//      via lib/evolution/send-message.ts.
//
// Pipeline for connection.update:
//   - Update evolution_instances.status + phone_number.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { normalizeInbound } from '@/lib/messaging/normalize-inbound'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { loadHistoryWindow } from '@/lib/agent-runtime/load-history'
import { findByPhone, findByChannelIdentity, attachChannelIdentity, backfillContactPhone } from '@/lib/contacts/server'
import { normalisePhone } from '@/lib/contacts/zod-schemas'
import { sendWhatsappMessage } from './send-message'
import { resolveEvolutionInstanceByName } from './credentials'
import type { ChannelProvider } from '@/types/database'

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

export interface EvolutionWebhookPayload {
  event: string                  // e.g. 'messages.upsert', 'connection.update'
  instance: string               // instanceName
  data: Record<string, unknown>
  destination?: string
  date_time?: string
  sender?: string
  server_url?: string
  apikey?: string
}

interface MessagesUpsertData {
  key: {
    id: string
    remoteJid: string            // sender JID (e.g. "55119...@s.whatsapp.net" or group JID)
    fromMe: boolean
    participant?: string         // when group, the actual sender's JID
  }
  pushName?: string
  message?: {
    conversation?: string
    extendedTextMessage?: { text: string }
    imageMessage?: { caption?: string }
    videoMessage?: { caption?: string }
    audioMessage?: unknown
    documentMessage?: { fileName?: string; caption?: string }
  }
  messageType?: string
  messageTimestamp?: number
}

interface ConnectionUpdateData {
  state?: 'open' | 'close' | 'connecting' | 'qr' | string
  instance?: {
    instanceName?: string
    state?: string
    profilePicUrl?: string
    wuid?: string                // E.164 with @s.whatsapp.net suffix once connected
  }
  wuid?: string                  // some Evolution Go versions put this at top-level
}

// ---------------------------------------------------------------------------
// Top-level dispatcher
// ---------------------------------------------------------------------------

export async function processEvolutionEvent(payload: EvolutionWebhookPayload): Promise<void> {
  try {
    const eventType = (payload.event ?? '').toLowerCase()

    if (eventType === 'messages.upsert' || eventType === 'messages_upsert') {
      await handleMessagesUpsert(payload)
      return
    }

    if (eventType === 'connection.update' || eventType === 'connection_update') {
      await handleConnectionUpdate(payload)
      return
    }

    // Other events (presence, contacts, etc.) are silently ignored for now.
  } catch (err) {
    console.error('[evolution/webhook] processEvolutionEvent error:', err)
  }
}

// ---------------------------------------------------------------------------
// messages.upsert → conversation + agent
// ---------------------------------------------------------------------------

function extractText(msg: MessagesUpsertData['message']): string {
  if (!msg) return ''
  if (typeof msg.conversation === 'string' && msg.conversation.trim()) return msg.conversation.trim()
  if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text.trim()
  if (msg.imageMessage?.caption) return msg.imageMessage.caption?.trim() ?? ''
  if (msg.videoMessage?.caption) return msg.videoMessage.caption?.trim() ?? ''
  if (msg.documentMessage?.caption) return msg.documentMessage.caption?.trim() ?? ''
  return ''
}

/**
 * Determines the message_type for an Evolution WhatsApp message.
 * Returns 'text' for plain text, or the appropriate media type.
 */
function determineEvolutionMessageType(msg: MessagesUpsertData['message'], textContent: string): string {
  if (!msg) return 'text'
  if (msg.imageMessage) return textContent ? 'mixed' : 'image'
  if (msg.audioMessage) return 'audio'
  if (msg.videoMessage) return textContent ? 'mixed' : 'video'
  if (msg.documentMessage) return textContent ? 'mixed' : 'document'
  return 'text'
}

/**
 * Returns true if the Evolution message has any media (image, audio, video, document).
 * Used to decide whether to process messages without text content.
 */
function hasEvolutionMedia(msg: MessagesUpsertData['message']): boolean {
  if (!msg) return false
  return !!(msg.imageMessage || msg.audioMessage || msg.videoMessage || msg.documentMessage)
}

/**
 * Returns a human-readable last_message label for media-only Evolution messages.
 */
function formatEvolutionLastMessage(msg: MessagesUpsertData['message']): string {
  if (!msg) return ''
  if (msg.imageMessage) return '📷 Foto'
  if (msg.audioMessage) return '🎵 Áudio'
  if (msg.videoMessage) return '🎬 Vídeo'
  if (msg.documentMessage) {
    const doc = msg.documentMessage as { fileName?: string }
    return `📎 ${doc.fileName ?? 'Documento'}`
  }
  return ''
}

function jidToPhone(jid: string): string {
  // "5511999998888@s.whatsapp.net" → "+5511999998888"
  const num = jid.split('@')[0]
  if (!num) return jid
  return num.startsWith('+') ? num : `+${num}`
}

function isGroupJid(jid: string): boolean {
  return jid.endsWith('@g.us')
}

async function handleMessagesUpsert(payload: EvolutionWebhookPayload): Promise<void> {
  const instance = await resolveEvolutionInstanceByName(payload.instance)
  if (!instance) {
    console.warn('[evolution/webhook] No instance for:', payload.instance)
    return
  }

  // Evolution sometimes wraps data.messages = [...]; sometimes data is the message itself
  const raw = payload.data as unknown as { messages?: MessagesUpsertData[] } & MessagesUpsertData
  const messages: MessagesUpsertData[] = Array.isArray(raw?.messages)
    ? raw.messages
    : [raw]

  const supabase = createServiceRoleClient()
  const orgId = instance.org_id

  for (const m of messages) {
    if (!m?.key) continue
    if (m.key.fromMe) continue // skip echoes
    if (isGroupJid(m.key.remoteJid)) continue // skip groups for inbound auto-reply

    const messageText = extractText(m.message)
    const hasMedia = hasEvolutionMedia(m.message)

    // Skip messages with no text and no recognized media type
    if (!messageText && !hasMedia) continue

    const messageType = determineEvolutionMessageType(m.message, messageText)

    const senderJid = m.key.remoteJid
    const fromPhone = jidToPhone(senderJid)
    const evolutionMessageId = m.key.id

    // --- 1+2. Upsert conversation + insert inbound message via the shared
    // inbound normalizer (dedup by org + channel='whatsapp' + visitor_phone;
    // idempotent by evolution message id). Contact resolution runs lazily in
    // createPayload, only when a brand-new conversation is created.
    const now = new Date().toISOString()
    // Build a display text for last_message (handles media-only messages)
    const lastMessageDisplay = messageText || formatEvolutionLastMessage(m.message)

    const norm = await normalizeInbound({
      supabase,
      orgId,
      channel: 'whatsapp',
      match: { by: 'visitor_phone', phone: fromPhone },
      updatePayload: {
        last_message: lastMessageDisplay,
        last_message_at: now,
        last_inbound_at: now,
        updated_at: now,
        evolution_instance_id: instance.id,
      },
      createPayload: async () => {
        // Phase 108 D-03 lookup-first: channel identity → phone → insert.
        let contactId: string | null = null
        const channelProvider: ChannelProvider = 'evolution'
        const externalId = m.key?.remoteJid ?? ''

        const channelHit = externalId
          ? await findByChannelIdentity(supabase, orgId, channelProvider, externalId)
          : null
        if (channelHit) {
          contactId = channelHit.contact_id
          // Backfill the phone if this contact was created without one.
          await backfillContactPhone(supabase, orgId, contactId, fromPhone)
        } else {
          const phoneNorm = normalisePhone(fromPhone)
          const { data: contact } = phoneNorm
            ? await supabase
                .from('contacts')
                .select('id')
                .eq('org_id', orgId)
                .eq('phone_e164', phoneNorm)
                .neq('identity_status', 'archived_duplicate')
                .limit(1)
                .maybeSingle()
            : { data: null }

          if (contact?.id) {
            contactId = contact.id
            // D-03b: attach channel identity to existing phone-rooted contact.
            if (externalId) {
              await attachChannelIdentity(supabase, orgId, contactId, channelProvider, externalId)
            }
          } else {
            // D-04a (Phase 110-02): Evolution payloads carry no email field —
            // pure phone+channel provider. No isBlockedEmail wiring needed here.
            // If a future Evolution payload variant exposes email, gate with
            // isBlockedEmail from '@/lib/contacts/blocked-emails' before write.
            const { data: created, error: insErr } = await supabase
              .from('contacts')
              .insert({
                org_id: orgId,
                name: m.pushName ?? null,
                phone: fromPhone,
                source: 'whatsapp',
              })
              .select('id')
              .single()
            if (insErr?.code === '23505') {
              // D-03: race lost — look up the winner via the canonical helper.
              const winner = await findByPhone(supabase, orgId, fromPhone)
              contactId = winner?.id ?? null
              if (winner) {
                console.log(
                  `[evolution/process] contact.unique_collision source=evolution org_id=${orgId} contact_id=${winner.id} matched_via=phone`,
                )
              }
            } else if (insErr) {
              console.error('[evolution/webhook] insert contact error:', insErr.message)
              contactId = null
            } else {
              contactId = created?.id ?? null
            }
            if (contactId && externalId) {
              await attachChannelIdentity(supabase, orgId, contactId, channelProvider, externalId)
            }
          }
        }

        return {
          widget_token: '',
          channel_metadata: {
            sender_jid: senderJid,
            instance_name: instance.instance_name,
          },
          visitor_phone: fromPhone,
          visitor_name: m.pushName ?? null,
          // TODO Phase 110: wrap with resolveLiveContactId
          contact_id: contactId,
          evolution_instance_id: instance.id,
          last_message: lastMessageDisplay,
          last_message_at: now,
          last_inbound_at: now,
        }
      },
      message: {
        role: 'user',
        content: messageText,
        message_type: messageType,
        metadata: {
          channel: 'whatsapp',
          evolution_message_id: evolutionMessageId,
          from: fromPhone,
          instance_name: instance.instance_name,
        },
      },
      idempotencyMetadata: { evolution_message_id: evolutionMessageId },
    })

    if (norm.error) {
      console.error('[evolution/webhook] normalizeInbound failed:', norm.error)
      continue
    }
    if (norm.duplicate) continue

    const conversationId = norm.conversationId

    // --- 3. Bot status gate -----------------------------------------------
    const botStatus = norm.existing?.bot_status ?? 'active'
    if (botStatus !== 'active') continue

    // Cannot auto-reply to media-only messages without text
    if (!messageText) continue

    // --- 4. Resolve channel agent ----------------------------------------
    const { data: defaultRow } = await supabase
      .from('agent_channel_defaults')
      .select('agent_id')
      .eq('organization_id', orgId)
      .eq('channel', 'whatsapp')
      .maybeSingle()

    if (!defaultRow?.agent_id) continue

    // --- 5. Invoke agent + send reply ------------------------------------
    try {
      const historyWindow = await loadHistoryWindow({
        supabase,
        conversationId,
        currentUserMessage: messageText,
      })
      const result = await runAgent({
        orgId,
        agentId: defaultRow.agent_id,
        channel: 'whatsapp',
        userMessage: messageText,
        conversationId,
        historyWindow,
        stream: false,
      })

      if (!result.text) continue

      await sendWhatsappMessage({
        orgId,
        to: fromPhone,
        text: result.text,
        conversationId,
        instanceName: instance.instance_name,
      })
    } catch (err) {
      console.error('[evolution/webhook] runAgent/send error:', err)
    }
  }
}

// ---------------------------------------------------------------------------
// connection.update → instance status row
// ---------------------------------------------------------------------------

async function handleConnectionUpdate(payload: EvolutionWebhookPayload): Promise<void> {
  const instance = await resolveEvolutionInstanceByName(payload.instance)
  if (!instance) return

  const data = payload.data as ConnectionUpdateData
  const rawState = data?.state ?? data?.instance?.state ?? ''
  const supabase = createServiceRoleClient()

  let status: 'disconnected' | 'connecting' | 'connected' | 'qr_pending' = 'disconnected'
  if (rawState === 'open') status = 'connected'
  else if (rawState === 'qr') status = 'qr_pending'
  else if (rawState === 'connecting') status = 'connecting'
  else if (rawState === 'close') status = 'disconnected'

  let phone: string | null = null
  const wuid = data?.instance?.wuid ?? data?.wuid
  if (typeof wuid === 'string' && wuid.length > 0) {
    phone = jidToPhone(wuid)
  }

  const update: Record<string, unknown> = { status }
  if (status === 'connected') {
    update.connected_at = new Date().toISOString()
    update.last_error = null
    if (phone) update.phone_number = phone
  }

  await supabase.from('evolution_instances').update(update).eq('id', instance.id)
}

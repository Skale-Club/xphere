// src/lib/whatsapp/process-message.ts
// Unified inbound pipeline: any provider → upsert conversation → store media →
// insert message → optional agent dispatch + reply. Wrapped in try/catch so
// webhook handlers never see exceptions.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { sendWhatsAppMessage } from './send'
import type {
  NormalizedWhatsAppMessage,
  ResolvedProvider,
  WhatsAppAdapter,
  WhatsAppMediaAttachment,
  WhatsAppMessageType,
} from './types'

function computeMessageType(
  inferred: WhatsAppMessageType,
  hasText: boolean,
  hasMedia: boolean,
): WhatsAppMessageType | 'mixed' {
  if (!hasMedia) return 'text'
  if (hasMedia && hasText) return 'mixed'
  return inferred
}

export async function processWhatsAppMessage(
  msg: NormalizedWhatsAppMessage,
  provider: ResolvedProvider,
  adapter: WhatsAppAdapter,
): Promise<void> {
  try {
    if (msg.isFromMe || msg.isGroup) return

    const supabase = createServiceRoleClient()
    const orgId = msg.orgId
    const fromPhone = msg.fromPhone
    const fromName = msg.fromName

    // --- 1. Upsert conversation ----------------------------------------------
    const { data: existing } = await supabase
      .from('conversations')
      .select('id, bot_status, contact_id')
      .eq('org_id', orgId)
      .eq('channel', 'whatsapp')
      .eq('visitor_phone', fromPhone)
      .limit(1)
      .maybeSingle()

    const now = new Date().toISOString()
    let conversationId: string

    if (existing) {
      conversationId = existing.id
    } else {
      // Find or create contact by phone
      let contactId: string | null = null
      const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('org_id', orgId)
        .eq('phone', fromPhone)
        .limit(1)
        .maybeSingle()

      if (contact?.id) {
        contactId = contact.id
      } else {
        const { data: created } = await supabase
          .from('contacts')
          .insert({
            org_id: orgId,
            name: fromName,
            phone: fromPhone,
            source: 'whatsapp',
          })
          .select('id')
          .single()
        contactId = created?.id ?? null
      }

      const channelMetadata: Record<string, unknown> = {
        sender_jid: msg.fromJid,
        provider: msg.provider,
      }
      if (msg.instanceName) channelMetadata.instance_name = msg.instanceName

      const insertPayload: Record<string, unknown> = {
        org_id: orgId,
        widget_token: '',
        channel: 'whatsapp',
        channel_metadata: channelMetadata,
        visitor_phone: fromPhone,
        visitor_name: fromName,
        contact_id: contactId,
        last_message_at: now,
        last_inbound_at: now,
      }
      // Maintain legacy FK when the active provider is Evolution
      if (msg.provider === 'evolution') {
        insertPayload.evolution_instance_id = provider.id
      }

      const { data: convo, error: convErr } = await supabase
        .from('conversations')
        // SEED-031: channel_metadata accepts arbitrary JSON beyond declared types
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .insert(insertPayload as any)
        .select('id')
        .single()

      if (convErr || !convo) {
        console.error('[whatsapp/process] failed to create conversation:', convErr?.message)
        return
      }
      conversationId = convo.id
    }

    // --- 2. Idempotency check ------------------------------------------------
    const { data: dup } = await supabase
      .from('conversation_messages')
      .select('id')
      .eq('conversation_id', conversationId)
      .eq('role', 'user')
      .contains('metadata', { whatsapp_message_id: msg.messageId })
      .limit(1)
      .maybeSingle()

    if (dup) return

    // --- 3. Fetch media (if any) ---------------------------------------------
    let media: WhatsAppMediaAttachment[] = []
    if (msg.messageType !== 'text') {
      try {
        media = await adapter.fetchMedia(msg, provider, conversationId)
      } catch (err) {
        console.error('[whatsapp/process] fetchMedia error:', err)
      }
    }

    const hasText = msg.text.length > 0
    const hasMedia = media.length > 0
    const effectiveType = computeMessageType(msg.messageType, hasText, hasMedia)

    const metadata: Record<string, unknown> = {
      channel: 'whatsapp',
      provider: msg.provider,
      whatsapp_message_id: msg.messageId,
      from: fromPhone,
    }
    if (msg.instanceName) metadata.instance_name = msg.instanceName
    if (media.length > 0) metadata.media = media
    // Backwards compat | older code looks up by evolution_message_id
    if (msg.provider === 'evolution') metadata.evolution_message_id = msg.messageId

    // --- 4. Insert message ---------------------------------------------------
    const insertMessage: Record<string, unknown> = {
      conversation_id: conversationId,
      org_id: orgId,
      role: 'user',
      content: msg.text,
      message_type: effectiveType,
      metadata,
    }

    const { error: msgErr } = await supabase
      .from('conversation_messages')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .insert(insertMessage as any)
    if (msgErr) {
      console.error('[whatsapp/process] insert message error:', msgErr.message)
    }

    // Bump conversation freshness regardless of bot status
    await supabase
      .from('conversations')
      .update({
        last_message: msg.text || `[${msg.messageType}]`,
        last_message_at: now,
        last_inbound_at: now,
        updated_at: now,
      })
      .eq('id', conversationId)

    // --- 5. Bot gate ---------------------------------------------------------
    const botStatus = existing?.bot_status ?? 'active'
    if (botStatus !== 'active') return

    // --- 6. Resolve channel agent -------------------------------------------
    const { data: defaultRow } = await supabase
      .from('agent_channel_defaults')
      .select('agent_id')
      .eq('organization_id', orgId)
      .eq('channel', 'whatsapp')
      .maybeSingle()

    if (!defaultRow?.agent_id) return

    // --- 7. Run agent + send reply ------------------------------------------
    try {
      const result = await runAgent({
        orgId,
        agentId: defaultRow.agent_id,
        channel: 'whatsapp',
        userMessage: msg.text || '[media message]',
        conversationId,
        stream: false,
      })

      if (!result.text) return

      await sendWhatsAppMessage({
        orgId,
        to: fromPhone,
        text: result.text,
        conversationId,
      })
    } catch (err) {
      console.error('[whatsapp/process] runAgent/send error:', err)
    }
  } catch (err) {
    console.error('[whatsapp/process] outer error:', err)
  }
}

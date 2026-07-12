// src/lib/whatsapp/process-message.ts
// Unified inbound pipeline: any provider → upsert conversation → store media →
// insert message → optional agent dispatch + reply. Wrapped in try/catch so
// webhook handlers never see exceptions.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { normalizeInbound } from '@/lib/messaging/normalize-inbound'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { loadHistoryWindow } from '@/lib/agent-runtime/load-history'
import { findByPhone, findByChannelIdentity, attachChannelIdentity } from '@/lib/contacts/server'
import { normalisePhone } from '@/lib/contacts/zod-schemas'
import { routeWhatsAppReply } from './route-reply'
import { insertNotification } from '@/lib/notifications/insert'
import type { ChannelProvider } from '@/types/database'
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
    const now = new Date().toISOString()

    const channelMetadata: Record<string, unknown> = {
      sender_jid: msg.fromJid,
      provider: msg.provider,
    }
    if (msg.instanceName) channelMetadata.instance_name = msg.instanceName
    if (msg.provider === 'meta_cloud') {
      const cfg = provider.config as Record<string, string> | undefined
      if (cfg?.phone_number_id) channelMetadata.phone_number_id = cfg.phone_number_id
    }

    // Preview text for conversations.last_message | doesn't depend on the media
    // fetch below (only on msg.text / the provider-inferred messageType), so
    // it's safe to compute upfront and apply via the shared normalizer.
    const lastMessageDisplay = msg.text || `[${msg.messageType}]`

    // --- 1. Upsert conversation via the shared inbound normalizer, in
    // upsert-only mode (dedup by org + channel='whatsapp' + visitor_phone).
    // normalizeInbound's monotonic guard now protects last_message/
    // last_inbound_at here (previously hand-rolled with no such protection).
    // The message write stays bespoke below: media must be downloaded against
    // the resolved conversationId BEFORE the insert, and the whatsapp_message_id
    // dedup check + freshness bump need to run in the same relative order as
    // before — same reason src/lib/meta/process-event.ts uses skipMessage.
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
      },
      createPayload: async () => {
        // Phase 108 D-03 lookup-first: channel identity → phone → insert.
        // Identity hit short-circuits phone lookup; phone-match attaches identity
        // (D-03b cross-channel attach); new-insert/23505-recovery also attach.
        let contactId: string | null = null
        const channelProvider: ChannelProvider =
          msg.provider === 'evolution' ? 'evolution' : 'whatsapp'
        const externalId = msg.fromJid

        // D-03 step 2: channel identity lookup FIRST.
        const channelHit = externalId
          ? await findByChannelIdentity(supabase, orgId, channelProvider, externalId)
          : null
        if (channelHit) {
          contactId = channelHit.contact_id
        } else {
          // D-03 step 3: phone lookup (existing Phase 107 logic).
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
            // D-03 step 4: insert new contact + identity row.
            // D-04a (Phase 110-02): WhatsApp payloads do not carry an email
            // field — pure phone+channel provider. No isBlockedEmail wiring
            // needed here. If WhatsApp Business profiles ever surface email
            // metadata, gate with isBlockedEmail before writing to contacts.email.
            const { data: created, error: insErr } = await supabase
              .from('contacts')
              .insert({
                org_id: orgId,
                name: fromName,
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
                  `[whatsapp/process] contact.unique_collision source=whatsapp org_id=${orgId} contact_id=${winner.id} matched_via=phone`,
                )
              }
            } else if (insErr) {
              console.error('[whatsapp/process] insert contact error:', insErr.message)
              contactId = null
            } else {
              contactId = created?.id ?? null
            }
            // Attach identity on new-insert OR 23505-recovery (both branches yield contactId).
            if (contactId && externalId) {
              await attachChannelIdentity(supabase, orgId, contactId, channelProvider, externalId)
            }
          }
        }

        const insertPayload: Record<string, unknown> = {
          widget_token: '',
          channel_metadata: channelMetadata,
          visitor_phone: fromPhone,
          visitor_name: fromName,
          // TODO Phase 110: wrap with resolveLiveContactId
          contact_id: contactId,
          last_message: lastMessageDisplay,
          last_message_at: now,
          last_inbound_at: now,
        }
        // Maintain legacy FK when the active provider is Evolution
        if (msg.provider === 'evolution') {
          insertPayload.evolution_instance_id = provider.id
        }
        return insertPayload
      },
      message: {},
      skipMessage: true,
    })

    if (norm.error) {
      console.error('[whatsapp/process] failed to upsert conversation:', norm.error)
      return
    }

    const conversationId = norm.conversationId
    const existing = norm.existing
    const isNew = norm.isNew

    // --- 1b. WhatsApp Cloud opt-in side effect -------------------------------
    // Meta requires explicit opt-in for MARKETING templates. Any inbound from a
    // contact via the Cloud API implicitly counts as opt-in (the user reached
    // out to us). Stamp it once; subsequent inbounds don't re-set the timestamp.
    if (msg.provider === 'meta_cloud') {
      try {
        const { data: convForContact } = await supabase
          .from('conversations')
          .select('contact_id')
          .eq('id', conversationId)
          .maybeSingle()
        const cid = convForContact?.contact_id
        if (cid) {
          await supabase
            .from('contacts')
            .update({ whatsapp_opt_in: true, whatsapp_opted_at: now })
            .eq('id', cid)
            .eq('whatsapp_opt_in', false)
        }
      } catch (err) {
        console.error('[whatsapp/process] opt-in update error:', err)
      }
    }

    // --- 2. Idempotency check (manual — skipMessage bypasses normalizeInbound's
    // built-in guard here because the message write is bespoke; see step 1). --
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

    // Conversation freshness (last_message/last_message_at/last_inbound_at/
    // updated_at) was already bumped — guarded against out-of-order replays —
    // as part of the normalizeInbound upsert in step 1.

    // Notify org users: new_conversation for first message, new_message for
    // subsequent ones. Manual call (not normalizeInbound's built-in notify,
    // which skipMessage bypasses) — mirrors meta/process-event.ts, which uses
    // the same skipMessage pattern for the same media-before-insert reason.
    void insertNotification(
      orgId,
      isNew ? 'new_conversation' : 'new_message',
      {
        conversation_id: conversationId,
        contact_name: fromName ?? null,
        message_preview: msg.text ?? null,
        channel: 'whatsapp',
      },
    )

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
      const userMessage = msg.text || '[media message]'
      const historyWindow = await loadHistoryWindow({
        supabase,
        conversationId,
        currentUserMessage: userMessage,
      })
      const result = await runAgent({
        orgId,
        agentId: defaultRow.agent_id,
        channel: 'whatsapp',
        userMessage,
        conversationId,
        historyWindow,
        stream: false,
      })

      if (!result.text) return

      await routeWhatsAppReply({
        orgId,
        conversationId,
        to: fromPhone,
        text: result.text,
      })
    } catch (err) {
      console.error('[whatsapp/process] runAgent/send error:', err)
    }
  } catch (err) {
    console.error('[whatsapp/process] outer error:', err)
  }
}

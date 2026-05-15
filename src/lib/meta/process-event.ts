// src/lib/meta/process-event.ts
// Pure async function — no HTTP layer. Processes a validated Meta webhook payload.
// Called from src/app/api/meta/webhook/route.ts via after().

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { executeAction } from '@/lib/action-engine/execute-action'
import { decrypt } from '@/lib/crypto'

export type MetaWebhookPayload = {
  object: string
  entry: Array<{
    id: string
    time?: number
    messaging: Array<{
      sender: { id: string }
      recipient?: { id: string }
      timestamp?: number
      message?: {
        mid?: string
        text?: string
        is_echo?: boolean
      }
    }>
  }>
}

export async function processMetaEvent(payload: MetaWebhookPayload): Promise<void> {
  const supabase = createServiceRoleClient()

  for (const entry of payload.entry) {
    const pageId = entry.id
    const channelType = payload.object === 'instagram' ? 'instagram' : 'messenger'

    for (const event of entry.messaging) {
      try {
        // Skip echo messages (messages sent BY the page itself)
        if (event.message?.is_echo === true) continue

        // Skip events with no text content
        if (!event.message?.text) continue

        const senderId = event.sender.id
        const messageText = event.message.text

        // 1. Resolve org + automation config from meta_channels
        const { data: metaChannel } = await supabase
          .from('meta_channels')
          .select('org_id, automation_id, config')
          .eq('page_id', pageId)
          .eq('channel_type', channelType)
          .eq('is_active', true)
          .maybeSingle()

        if (!metaChannel) {
          console.warn('[meta/webhook] No active meta_channel for page_id:', pageId, 'channel_type:', channelType)
          continue
        }

        const { org_id: orgId, automation_id: automationId, config } = metaChannel

        // 2. De-duplicate conversation: find existing by sender + page + channel
        const senderKey = channelType === 'instagram' ? 'igsid' : 'sender_id'

        const { data: existing } = await supabase
          .from('conversations')
          .select('id, channel_metadata, last_inbound_at')
          .eq('org_id', orgId)
          .eq('channel', channelType)
          .eq(`channel_metadata->>${senderKey}`, senderId)
          .eq('channel_metadata->>page_id', pageId)
          .limit(1)
          .maybeSingle()

        const now = new Date().toISOString()
        let conversationId: string
        let existingChannelMetadata: Record<string, string> = {}

        if (existing) {
          conversationId = existing.id
          existingChannelMetadata = (existing.channel_metadata as Record<string, string>) ?? {}

          // Update conversation with latest message info (will also update last_inbound_at below)
          await supabase
            .from('conversations')
            .update({
              last_message: messageText,
              last_message_at: now,
              updated_at: now,
            })
            .eq('id', conversationId)
        } else {
          // Create new conversation
          const channelMetadata =
            channelType === 'instagram'
              ? { igsid: senderId, page_id: pageId }
              : { sender_id: senderId, page_id: pageId }

          const { data: created, error: insertError } = await supabase
            .from('conversations')
            .insert({
              org_id: orgId,
              widget_token: '',  // NOT NULL column; Meta conversations do not use widget tokens
              channel: channelType,
              channel_metadata: channelMetadata,
              last_message: messageText,
              last_message_at: now,
              last_inbound_at: now,
            })
            .select('id')
            .single()

          if (insertError || !created) {
            console.error('[meta/webhook] Failed to create conversation:', insertError?.message)
            continue
          }

          conversationId = created.id
        }

        // 3. Insert user message
        await supabase.from('conversation_messages').insert({
          conversation_id: conversationId,
          org_id: orgId,
          role: 'user',
          content: messageText,
        })

        // 4. 24h window check — only applies to existing conversations
        const lastInboundAt = existing?.last_inbound_at ? new Date(existing.last_inbound_at) : null
        const windowExpired = lastInboundAt
          ? (Date.now() - lastInboundAt.getTime()) > 24 * 60 * 60 * 1000
          : false

        if (windowExpired) {
          console.log('[meta/webhook] 24h window expired for conversation:', conversationId)
          // Set window_expired flag and update last_inbound_at (reset the clock for future messages)
          await supabase
            .from('conversations')
            .update({
              last_inbound_at: now,
              channel_metadata: { ...existingChannelMetadata, window_expired: 'true' },
            })
            .eq('id', conversationId)
          continue
        }

        // Update last_inbound_at for existing conversations (new conversations already have it set)
        if (existing) {
          await supabase
            .from('conversations')
            .update({ last_inbound_at: now })
            .eq('id', conversationId)
        }

        // 5. Automation dispatch — skip if no automation configured
        if (!automationId) continue

        // 6. Keyword trigger check — case-insensitive substring match
        const keyword = (config as Record<string, string>)?.keyword_trigger ?? null
        if (keyword && !messageText.toLowerCase().includes(keyword.toLowerCase())) continue

        // 7. Resolve tool config and dispatch
        try {
          const { data: toolConfig, error: toolError } = await supabase
            .from('tool_configs')
            .select('*, integrations!inner(*)')
            .eq('id', automationId)
            .single()

          if (toolError || !toolConfig) {
            console.warn('[meta/webhook] No tool_config found for automation_id:', automationId)
            continue
          }

          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const integration = (toolConfig as any).integrations
          const plaintextKey = await decrypt(integration.encrypted_api_key)

          const result = await executeAction(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (toolConfig as any).action_type,
            { message: messageText, conversation_id: conversationId },
            { apiKey: plaintextKey, locationId: integration.location_id ?? '' },
            { organizationId: orgId, supabase, integrationProvider: integration.provider }
          )

          // Persist automation response as assistant message
          await supabase.from('conversation_messages').insert({
            conversation_id: conversationId,
            org_id: orgId,
            role: 'assistant',
            content: result,
          })
        } catch (automationErr) {
          console.error('[meta/webhook] Automation dispatch error:', automationErr)
        }
      } catch (eventErr) {
        console.error('[meta/webhook] Error processing messaging event:', eventErr)
      }
    }
  }
}

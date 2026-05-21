// src/lib/meta/process-event.ts
// Pure async function | no HTTP layer. Processes a validated Meta webhook payload.
// Called from src/app/api/meta/webhook/route.ts via after().
//
// v2.0 agent path (CHAN-05 | Phase 37): when meta_channels.agent_id is non-null,
//   invokes runAgent({ stream: false }) and replies via sendMetaMessage.
// v1.x legacy path: uses automation_id / tool_config_id → executeAction, unchanged.
// SEED-032: inbound attachments downloaded + re-hosted; mid-based de-dup;
//   story-reply context captured in metadata.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { executeAction } from '@/lib/action-engine/execute-action'
import { decrypt } from '@/lib/crypto'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { sendMetaMessage } from './send-message'
import { formatOutbound as formatMeta } from '@/lib/agent-runtime/adapters/meta'
import { insertNotification } from '@/lib/notifications/insert'
import { downloadMetaMedia } from './media'
import { inferMimeFromAttachmentType, type MetaWebhookPayload, type MetaAttachment } from './types'
import type { MediaAttachment } from '@/types/chat'

export type { MetaWebhookPayload } from './types'

function formatLastMessage(text: string, media: MediaAttachment[], attachments: MetaAttachment[]): string {
  if (text) return text
  if (media.length === 0 && attachments.length === 0) return ''
  const firstAtt = attachments[0]
  if (firstAtt?.type === 'sticker') return '💟 Sticker'
  const first = media[0]
  if (!first) return firstAtt?.type === 'image' ? '📷 Foto' : '📎 Anexo'
  if (first.mime_type.startsWith('image/')) return '📷 Foto'
  if (first.mime_type.startsWith('audio/')) return '🎵 Áudio'
  if (first.mime_type.startsWith('video/')) return '🎬 Vídeo'
  return `📎 ${first.filename ?? 'Arquivo'}`
}

function deriveMessageType(text: string, media: MediaAttachment[], attachments: MetaAttachment[]): string {
  if (media.length === 0 && attachments.length === 0) return 'text'
  if (text) return 'mixed'
  if (attachments[0]?.type === 'sticker') return 'sticker'
  const first = media[0]
  if (!first) return attachments[0]?.type ?? 'image'
  if (first.mime_type.startsWith('image/')) return 'image'
  if (first.mime_type.startsWith('audio/')) return 'audio'
  if (first.mime_type.startsWith('video/')) return 'video'
  return 'document'
}

export async function processMetaEvent(payload: MetaWebhookPayload): Promise<void> {
  const supabase = createServiceRoleClient()

  for (const entry of payload.entry) {
    const pageId = entry.id
    const channelType = payload.object === 'instagram' ? 'instagram' : 'messenger'

    for (const event of entry.messaging) {
      try {
        const msg = event.message
        if (!msg) continue
        if (msg.is_echo === true) continue
        if (msg.reaction) continue  // ignore reactions for now

        const senderId = event.sender.id
        const messageText = msg.text ?? ''
        const attachments = msg.attachments ?? []
        const mid = msg.mid

        // Reject events with nothing to process
        if (!messageText && attachments.length === 0) continue

        // 1. Resolve org + automation config + agent_id from meta_channels
        const { data: metaChannel } = await supabase
          .from('meta_channels')
          .select('org_id, automation_id, config, agent_id, encrypted_page_access_token')
          .eq('page_id', pageId)
          .eq('channel_type', channelType)
          .eq('is_active', true)
          .maybeSingle()

        if (!metaChannel) {
          console.warn('[meta/webhook] No active meta_channel for page_id:', pageId, 'channel_type:', channelType)
          continue
        }

        const { org_id: orgId, automation_id: automationId, config, agent_id: agentId } = metaChannel

        // Decrypt page token early | needed for media download
        let pageToken = ''
        try {
          pageToken = await decrypt(metaChannel.encrypted_page_access_token)
        } catch (err) {
          console.error('[meta/webhook] Failed to decrypt page token:', err)
          continue
        }

        // 2. De-duplicate conversation
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

        // Placeholder last_message | will overwrite after media is processed
        const placeholderLast = messageText || '...'

        if (existing) {
          conversationId = existing.id
          existingChannelMetadata = (existing.channel_metadata as Record<string, string>) ?? {}
          await supabase
            .from('conversations')
            .update({
              last_message: placeholderLast,
              last_message_at: now,
              updated_at: now,
            })
            .eq('id', conversationId)
        } else {
          const channelMetadata =
            channelType === 'instagram'
              ? { igsid: senderId, page_id: pageId }
              : { sender_id: senderId, page_id: pageId }

          const { data: created, error: insertError } = await supabase
            .from('conversations')
            .insert({
              org_id: orgId,
              widget_token: '',
              channel: channelType,
              channel_metadata: channelMetadata,
              last_message: placeholderLast,
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
          void insertNotification(orgId, 'new_conversation', { conversation_id: conversationId, channel: channelType })
        }

        // 2b. Idempotency by mid | skip if we've already inserted this message
        if (mid) {
          const { data: dupMid } = await supabase
            .from('conversation_messages')
            .select('id')
            .eq('conversation_id', conversationId)
            .eq('role', 'user')
            .contains('metadata', { meta_mid: mid })
            .limit(1)
            .maybeSingle()
          if (dupMid) {
            console.log('[meta/webhook] Duplicate meta_mid | skipping:', mid)
            continue
          }
        }

        // 3. Download attachments and re-host
        const newMsgId = crypto.randomUUID()
        const mediaItems: MediaAttachment[] = []
        for (let i = 0; i < attachments.length; i++) {
          const att = attachments[i]
          if (!att.payload?.url) continue
          const stored = await downloadMetaMedia({
            url: att.payload.url,
            mimeType: inferMimeFromAttachmentType(att.type),
            pageToken,
            orgId,
            conversationId,
            messageId: newMsgId,
            index: i,
          })
          if (stored) {
            mediaItems.push({
              url: stored.url,
              mime_type: stored.mimeType,
              size: stored.size,
              ...(att.payload.name ? { filename: att.payload.name } : {}),
            })
          }
        }

        const messageType = deriveMessageType(messageText, mediaItems, attachments)
        const lastMessageDisplay = formatLastMessage(messageText, mediaItems, attachments)

        // Refresh last_message if media changed the display
        if (!messageText && lastMessageDisplay) {
          await supabase
            .from('conversations')
            .update({ last_message: lastMessageDisplay })
            .eq('id', conversationId)
        }

        // 4. Insert user message with media + story_reply context
        const messageMetadata: Record<string, unknown> = { channel: channelType }
        if (mid) messageMetadata.meta_mid = mid
        if (mediaItems.length > 0) messageMetadata.media = mediaItems
        if (msg.reply_to?.story) {
          messageMetadata.story_reply = {
            story_id: msg.reply_to.story.id,
            story_url: msg.reply_to.story.url,
          }
        }

        await supabase.from('conversation_messages').insert({
          id: newMsgId,
          conversation_id: conversationId,
          org_id: orgId,
          role: 'user',
          content: messageText,
          message_type: messageType,
          metadata: messageMetadata,
        })

        // 4. 24h window check
        const lastInboundAt = existing?.last_inbound_at ? new Date(existing.last_inbound_at) : null
        const windowExpired = lastInboundAt
          ? (Date.now() - lastInboundAt.getTime()) > 24 * 60 * 60 * 1000
          : false

        if (windowExpired) {
          console.log('[meta/webhook] 24h window expired for conversation:', conversationId)
          await supabase
            .from('conversations')
            .update({
              last_inbound_at: now,
              channel_metadata: { ...existingChannelMetadata, window_expired: 'true' },
            })
            .eq('id', conversationId)
          continue
        }

        if (existing) {
          await supabase
            .from('conversations')
            .update({ last_inbound_at: now })
            .eq('id', conversationId)
        }

        // 5. XOR dispatch: agent_id takes priority over automation_id
        // Skip auto-reply when there's no text (media-only) | agents shouldn't answer "[image]" blindly.
        if (agentId && messageText) {
          // v2.0 agent path (CHAN-05)
          await dispatchAgentReply({
            orgId,
            agentId,
            channel: channelType as 'messenger' | 'instagram',
            userMessage: messageText,
            conversationId,
            pageToken,
            recipientId: senderId,
            supabase,
          })
          continue
        }
        if (agentId) continue  // media-only with agent → just log, no reply

        // 6. Legacy path: automation_id / tool_config_id (requires text)
        if (!automationId || !messageText) continue

        const keyword = (config as Record<string, string>)?.keyword_trigger ?? null
        if (keyword && !messageText.toLowerCase().includes(keyword.toLowerCase())) continue

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

// ---------------------------------------------------------------------------
// Agent reply dispatch (v2.0 | CHAN-05)
// ---------------------------------------------------------------------------

interface AgentReplyInput {
  orgId: string
  agentId: string
  channel: 'messenger' | 'instagram'
  userMessage: string
  conversationId: string
  pageToken: string
  recipientId: string
  supabase: ReturnType<typeof createServiceRoleClient>
}

async function dispatchAgentReply(input: AgentReplyInput): Promise<void> {
  try {
    const result = await runAgent({
      orgId: input.orgId,
      agentId: input.agentId,
      channel: input.channel,
      userMessage: input.userMessage,
      conversationId: input.conversationId,
      stream: false,
    })

    // Format reply with Meta adapter (2000-char splits, markdown stripped)
    const chunks = formatMeta(result.text)

    // Send each chunk as a separate Meta message
    for (const chunk of chunks) {
      if (chunk.type === 'text') {
        await sendMetaMessage(input.pageToken, input.recipientId, chunk.text)
      }
    }

    // Persist agent reply as assistant message
    await input.supabase.from('conversation_messages').insert({
      conversation_id: input.conversationId,
      org_id: input.orgId,
      role: 'assistant',
      content: result.text,
    })
  } catch (err) {
    console.error('[meta/webhook] Agent dispatch error:', err)
    // Non-fatal: webhook already returned 200, this runs in after()
  }
}

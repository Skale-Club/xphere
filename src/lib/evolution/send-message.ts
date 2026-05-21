// src/lib/evolution/send-message.ts
// Outbound WhatsApp dispatcher | single entry point for sending a message via
// Evolution Go. Used by:
//   - Inbox UI when an admin replies in /conversations
//   - process-event after runAgent() produces a reply
//   - executors/send-whatsapp-message.ts when an agent calls the tool
//
// Persists the assistant/admin message back to conversation_messages so it
// appears in the inbox alongside inbound messages.

import { sendText, type EvolutionConfig, type SendResult, type EvolutionResponse } from './client'
import { resolveEvolutionInstance } from './credentials'
import { createServiceRoleClient } from '@/lib/supabase/admin'
import { formatOutbound as formatWhatsapp } from '@/lib/agent-runtime/adapters/whatsapp'

export interface SendWhatsappMessageInput {
  orgId: string
  to: string                       // E.164 (or group JID for groups)
  text: string
  conversationId?: string          // optional | when set, message is persisted
  role?: 'assistant' | 'user'      // role to persist as; defaults to 'assistant'
  instanceName?: string            // optional | picks first active if omitted
  delayMs?: number
  splitIntoChunks?: boolean        // defaults true | uses 1600-char WhatsApp adapter
}

export interface SendWhatsappMessageResult {
  ok: boolean
  error?: string
  /** Vendor message IDs for each chunk sent successfully */
  messageIds: string[]
}

export async function sendWhatsappMessage(
  input: SendWhatsappMessageInput,
): Promise<SendWhatsappMessageResult> {
  const instance = await resolveEvolutionInstance(input.orgId, input.instanceName)
  if (!instance) {
    return { ok: false, error: 'No active Evolution Go instance for this org.', messageIds: [] }
  }
  if (instance.status !== 'connected') {
    return {
      ok: false,
      error: `Evolution instance "${instance.instance_name}" is not connected (status=${instance.status}).`,
      messageIds: [],
    }
  }

  const supabase = createServiceRoleClient()
  const messageIds: string[] = []

  const chunks =
    input.splitIntoChunks === false
      ? [{ type: 'text' as const, text: input.text }]
      : formatWhatsapp(input.text)

  for (const chunk of chunks) {
    if (chunk.type !== 'text') continue

    const res = await sendText(instance.config, instance.instance_name, input.to, chunk.text, {
      delayMs: input.delayMs,
    })

    if (!res.ok) {
      // Record the failure but don't persist | caller can inspect
      return {
        ok: false,
        error: res.error ?? 'Evolution Go send failed',
        messageIds,
      }
    }

    if (res.data?.key?.id) {
      messageIds.push(res.data.key.id)
    }

    if (input.conversationId) {
      await supabase.from('conversation_messages').insert({
        conversation_id: input.conversationId,
        org_id: input.orgId,
        role: input.role ?? 'assistant',
        content: chunk.text,
        metadata: {
          channel: 'whatsapp',
          to: input.to,
          evolution_message_id: res.data?.key?.id ?? null,
          evolution_instance_id: instance.id,
        },
      })
    }
  }

  return { ok: true, messageIds }
}

/**
 * Thin pass-through for callers that already have a resolved instance config |
 * skips DB lookup. Used by executors that pre-resolved the instance.
 */
export async function sendTextWith(
  cfg: EvolutionConfig,
  instanceName: string,
  to: string,
  text: string,
): Promise<EvolutionResponse<SendResult>> {
  return sendText(cfg, instanceName, to, text)
}

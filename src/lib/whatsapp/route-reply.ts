/**
 * Provider-aware reply dispatcher for chat conversations.
 *
 * When an agent (or human) responds to an inbound WhatsApp message, the
 * outbound reply must go through the SAME provider that received the
 * inbound — otherwise we'd try to reply to a Meta-Cloud-originating
 * conversation via Evolution (or vice-versa).
 *
 * We read `conversations.channel_metadata.provider` to know which leg to
 * use. Defaults to the active non-official provider (legacy behavior) when
 * the field is missing.
 */

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { sendWhatsAppMessage } from './send'
import { sendCloudText } from './cloud/send-text'
import { getActiveCloudAccount } from './cloud/resolve-account'

export interface RouteReplyInput {
  orgId: string
  conversationId: string
  to: string
  text: string
  /** Persist as 'assistant' (agent) or 'user' (human handoff). Default assistant. */
  role?: 'assistant' | 'user'
}

export interface RouteReplyResult {
  ok: boolean
  error?: string
  /** Set when the Cloud send failed because the 24h customer service window expired. */
  outsideWindow?: boolean
  messageIds: string[]
}

export async function routeWhatsAppReply(input: RouteReplyInput): Promise<RouteReplyResult> {
  const supabase = createServiceRoleClient()
  const { data: conv } = await supabase
    .from('conversations')
    .select('channel_metadata')
    .eq('id', input.conversationId)
    .maybeSingle()

  const provider = (conv?.channel_metadata as Record<string, unknown> | null)?.provider as
    | string
    | undefined

  if (provider === 'meta_cloud') {
    const account = await getActiveCloudAccount(input.orgId)
    if (!account) {
      return {
        ok: false,
        error: 'No active WhatsApp Cloud account for this org',
        messageIds: [],
      }
    }
    const res = await sendCloudText({ account, to: input.to, body: input.text })
    if (!res.ok) {
      return {
        ok: false,
        error: res.error,
        outsideWindow: res.outsideWindow,
        messageIds: [],
      }
    }
    // Persist as outbound conversation message so the inbox shows it
    try {
      await supabase.from('conversation_messages').insert({
        conversation_id: input.conversationId,
        org_id: input.orgId,
        role: input.role ?? 'assistant',
        content: input.text,
        metadata: {
          channel: 'whatsapp',
          provider: 'meta_cloud',
          source: 'cloud_api',
          wamid: res.wamid,
          to: input.to,
        },
      })
    } catch (err) {
      console.error('[whatsapp/route-reply] persist error:', err)
    }
    return { ok: true, messageIds: [res.wamid] }
  }

  // Legacy non-official providers (Evolution / Z-API / W-API)
  return sendWhatsAppMessage({
    orgId: input.orgId,
    to: input.to,
    text: input.text,
    conversationId: input.conversationId,
    role: input.role,
  })
}

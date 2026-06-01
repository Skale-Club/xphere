// src/lib/zernio/process-event.ts
// Processes a validated Zernio webhook payload (message.received / comment.received).
// Called from src/app/api/zernio/webhook/route.ts via after().
//
// Flow:
//   1. Extract sender, conversation, account info from payload
//   2. Resolve/create contact via contact_channel_identities (provider='zernio')
//   3. normalizeInbound() → find-or-create conversation + insert message
//   4. If bot_status='active': runAgent() → sendZernioDm()

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { normalizeInbound } from '@/lib/messaging/normalize-inbound'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { findByChannelIdentity, attachChannelIdentity } from '@/lib/contacts/server'
import { sendZernioDm } from './send-dm'
import { getProviderKey } from '@/lib/integrations/get-provider-key'

export interface ZernioWebhookPayload {
  id?: string            // dedup event ID
  event: string          // 'message.received' | 'comment.received' | etc.
  message?: {
    _id?: string
    text?: string
    attachments?: unknown[]
    sender?: {
      contactId?: string
      platformContactId?: string
      name?: string
    }
    createdAt?: string
  }
  conversation?: {
    _id?: string
  }
  account?: {
    _id?: string
    platform?: string         // 'instagram' | 'facebook' | 'linkedin' | etc.
    platformAccountId?: string
  }
}

export async function processZernioEvent(
  payload: ZernioWebhookPayload,
  orgId: string,
): Promise<void> {
  // Only handle inbound DMs for now; comments can be added later
  if (payload.event !== 'message.received') return

  const msg = payload.message
  if (!msg) return

  const messageText = msg.text ?? ''
  const zernioMessageId = msg._id ?? ''
  const zernioConversationId = payload.conversation?._id ?? ''
  const senderPlatformId = msg.sender?.platformContactId ?? msg.sender?.contactId ?? ''
  const senderName = msg.sender?.name ?? null
  const platform = payload.account?.platform ?? 'unknown'
  const accountId = payload.account?._id ?? ''

  if (!zernioConversationId) {
    console.warn('[zernio/process] Missing conversation._id — skipping')
    return
  }

  const supabase = createServiceRoleClient()
  const now = new Date().toISOString()

  // 1. Resolve / create contact
  let contactId: string | null = null

  if (senderPlatformId) {
    const channelHit = await findByChannelIdentity(supabase, orgId, 'zernio', senderPlatformId)
    if (channelHit) {
      contactId = channelHit.contact_id
    } else {
      // Create a new contact from what Zernio gives us
      const { data: created, error: insErr } = await supabase
        .from('contacts')
        .insert({
          org_id: orgId,
          name: senderName,
          source: 'manual',
        })
        .select('id')
        .single()

      if (insErr?.code === '23505') {
        // Race condition: another event created the contact first
        const { data: existing } = await supabase
          .from('contacts')
          .select('id')
          .eq('org_id', orgId)
          .limit(1)
          .maybeSingle()
        contactId = existing?.id ?? null
      } else if (insErr) {
        console.error('[zernio/process] insert contact error:', insErr.message)
      } else {
        contactId = created?.id ?? null
      }

      if (contactId) {
        await attachChannelIdentity(supabase, orgId, contactId, 'zernio', senderPlatformId)
      }
    }
  }

  // 2. normalizeInbound — find-or-create conversation + insert message
  const norm = await normalizeInbound({
    supabase,
    orgId,
    channel: 'zernio',
    match: { by: 'metadata', keys: { zernio_conversation_id: zernioConversationId } },
    updatePayload: {
      last_message: messageText || '📎 Attachment',
      last_message_at: now,
      last_inbound_at: now,
      updated_at: now,
    },
    createPayload: {
      widget_token: '',
      channel_metadata: {
        platform,
        account_id: accountId,
        zernio_conversation_id: zernioConversationId,
        sender_platform_id: senderPlatformId,
      },
      visitor_name: senderName,
      contact_id: contactId,
      last_message: messageText || '📎 Attachment',
      last_message_at: now,
      last_inbound_at: now,
    },
    message: {
      role: 'user',
      content: messageText,
      message_type: 'text',
      channel: 'zernio',
      metadata: {
        zernio_message_id: zernioMessageId,
        zernio_conversation_id: zernioConversationId,
        platform,
      },
    },
    idempotencyMetadata: { zernio_message_id: zernioMessageId },
  })

  if (norm.error) {
    console.error('[zernio/process] normalizeInbound failed:', norm.error)
    return
  }
  if (norm.duplicate) return

  const conversationId = norm.conversationId

  // 3. Bot status gate
  const botStatus = norm.existing?.bot_status ?? 'active'
  if (botStatus !== 'active') return
  if (!messageText) return

  // 4. Resolve channel agent
  const { data: defaultRow } = await supabase
    .from('agent_channel_defaults')
    .select('agent_id')
    .eq('organization_id', orgId)
    .eq('channel', 'zernio')
    .maybeSingle()

  if (!defaultRow?.agent_id) return

  // 5. Run agent + send reply
  try {
    const apiKey = await getProviderKey('zernio', orgId, supabase)
    if (!apiKey) {
      console.warn('[zernio/process] No active Zernio integration for org:', orgId)
      return
    }

    const result = await runAgent({
      orgId,
      agentId: defaultRow.agent_id,
      channel: 'zernio',
      userMessage: messageText,
      conversationId,
      stream: false,
    })

    if (!result.text) return

    await sendZernioDm(zernioConversationId, result.text, apiKey)
  } catch (err) {
    console.error('[zernio/process] runAgent/send error:', err)
  }
}

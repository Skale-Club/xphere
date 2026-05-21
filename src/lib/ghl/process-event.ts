// src/lib/ghl/process-event.ts
// Processes a validated inbound GHL webhook payload.
// Called from /api/ghl/webhook via after() | runs after 200 is returned.
// Pattern mirrors src/lib/meta/process-event.ts.

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { decrypt } from '@/lib/crypto'
import { sendGhlMessage, channelToGhlType } from './send-message'
import { executeAction } from '@/lib/action-engine/execute-action'

export type GhlWebhookPayload = {
  type: string          // 'InboundMessage' | 'OutboundMessage' | etc.
  locationId: string
  contactId?: string
  conversationId?: string   // GHL's own conversation ID (external reference)
  messageType?: string      // 'SMS' | 'WhatsApp' | 'IG' | 'FB' | 'Email'
  body?: string
  direction?: string        // 'inbound' | 'outbound'
  phone?: string
  firstName?: string
  lastName?: string
  email?: string
  dateAdded?: string
}

function messageTypeToChannel(messageType: string): 'ghl_sms' | 'ghl_whatsapp' {
  if (messageType === 'WhatsApp') return 'ghl_whatsapp'
  return 'ghl_sms'
}

export async function processGhlEvent(
  payload: GhlWebhookPayload,
  orgId: string
): Promise<void> {
  const supabase = createServiceRoleClient()

  // Only process inbound text messages | skip outbound echoes and non-text events
  if (payload.direction === 'outbound') return
  if (payload.type !== 'InboundMessage') return

  const messageText = payload.body?.trim()
  if (!messageText) return

  const locationId = payload.locationId
  const contactId = payload.contactId ?? ''
  const ghlConversationId = payload.conversationId ?? ''
  const messageType = payload.messageType ?? 'SMS'
  const channel = messageTypeToChannel(messageType)

  // 1. Log the raw event
  await supabase.from('ghl_events').insert({
    org_id: orgId,
    location_id: locationId,
    contact_id: contactId || null,
    conversation_id: ghlConversationId || null,
    message_type: messageType,
    direction: 'inbound',
    body: messageText,
    phone: payload.phone ?? null,
    first_name: payload.firstName ?? null,
    last_name: payload.lastName ?? null,
    email: payload.email ?? null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    raw_payload: payload as any,
  })

  // 2. Resolve ghl_channel config
  const { data: ghlChannel } = await supabase
    .from('ghl_channels')
    .select('encrypted_api_key, automation_id, agent_id')
    .eq('org_id', orgId)
    .eq('location_id', locationId)
    .eq('is_active', true)
    .maybeSingle()

  if (!ghlChannel) {
    console.warn('[ghl/webhook] No active ghl_channel for org:', orgId, 'location:', locationId)
    return
  }

  // 3. De-duplicate conversation by (org + channel + contact_id + location_id)
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, bot_status, last_inbound_at')
    .eq('org_id', orgId)
    .eq('channel', channel)
    .eq('channel_metadata->>contact_id', contactId)
    .eq('channel_metadata->>location_id', locationId)
    .limit(1)
    .maybeSingle()

  const now = new Date().toISOString()
  let conversationId: string

  if (existing) {
    conversationId = existing.id

    await supabase
      .from('conversations')
      .update({
        last_message: messageText,
        last_message_at: now,
        last_inbound_at: now,
        updated_at: now,
        // Update visitor name if we have it
        ...(payload.firstName || payload.lastName
          ? { visitor_name: [payload.firstName, payload.lastName].filter(Boolean).join(' ') }
          : {}),
        ...(payload.phone ? { visitor_phone: payload.phone } : {}),
        ...(payload.email ? { visitor_email: payload.email } : {}),
      })
      .eq('id', conversationId)
  } else {
    const visitorName = [payload.firstName, payload.lastName].filter(Boolean).join(' ') || null

    const { data: created, error: insertError } = await supabase
      .from('conversations')
      .insert({
        org_id: orgId,
        widget_token: '',
        channel,
        channel_metadata: {
          location_id: locationId,
          contact_id: contactId,
          ghl_conversation_id: ghlConversationId,
          phone: payload.phone ?? '',
          message_type: messageType,
        },
        last_message: messageText,
        last_message_at: now,
        last_inbound_at: now,
        visitor_name: visitorName,
        visitor_phone: payload.phone ?? null,
        visitor_email: payload.email ?? null,
      })
      .select('id')
      .single()

    if (insertError || !created) {
      console.error('[ghl/webhook] Failed to create conversation:', insertError?.message)
      return
    }

    conversationId = created.id
  }

  // 4. Insert user message
  await supabase.from('conversation_messages').insert({
    conversation_id: conversationId,
    org_id: orgId,
    role: 'user',
    content: messageText,
  })

  // 5. Check bot_status | skip AI response if human has taken over
  const botStatus = existing?.bot_status ?? 'active'
  if (botStatus !== 'active') {
    console.log('[ghl/webhook] Bot paused for conversation:', conversationId, '| skipping AI response')
    return
  }

  // 6. Dispatch automation if configured (legacy v1.x flow via tool_configs)
  if (!ghlChannel.automation_id) return

  try {
    const { data: toolConfig, error: toolError } = await supabase
      .from('tool_configs')
      .select('*, integrations!inner(*)')
      .eq('id', ghlChannel.automation_id)
      .single()

    if (toolError || !toolConfig) {
      console.warn('[ghl/webhook] No tool_config found:', ghlChannel.automation_id)
      return
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integration = (toolConfig as any).integrations
    const plaintextKey = await decrypt(integration.encrypted_api_key)

    const result = await executeAction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (toolConfig as any).action_type,
      { message: messageText, conversation_id: conversationId, contactId, phone: payload.phone },
      { apiKey: plaintextKey, locationId: integration.location_id ?? locationId },
      { organizationId: orgId, supabase, integrationProvider: integration.provider }
    )

    // 7. Persist AI response as assistant message
    await supabase.from('conversation_messages').insert({
      conversation_id: conversationId,
      org_id: orgId,
      role: 'assistant',
      content: result,
    })

    // 8. Send the AI response back via GHL
    if (contactId) {
      const apiKey = await decrypt(ghlChannel.encrypted_api_key)
      await sendGhlMessage(
        {
          contactId,
          message: result,
          type: channelToGhlType(channel),
          conversationId: ghlConversationId || undefined,
        },
        { apiKey, locationId }
      )
    }
  } catch (err) {
    console.error('[ghl/webhook] Automation dispatch error:', err)
  }
}

// src/lib/twilio/process-sms.ts
// Processes a validated inbound Twilio SMS webhook (SEED-005).
// Called from /api/twilio/sms via after() — runs after 200 TwiML is returned.
//
// Pipeline:
//   1. Upsert conversation by (org_id, channel='sms', visitor_phone=From).
//   2. Insert conversation_message (role='user', content=Body).
//   3. If bot_status='active' and an agent is configured for channel='sms' via
//      agent_channel_defaults, invoke runAgent({channel:'sms', stream:false}).
//   4. Persist the assistant reply as a conversation_message.
//   5. Send the reply via the existing send_sms executor (Twilio Messages REST API).
//
// All errors are caught locally — this function never throws (after() context).

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { sendSms } from './send-sms'
import { formatOutbound as formatSms } from '@/lib/agent-runtime/adapters/sms'
import { insertNotification } from '@/lib/notifications/insert'

export type TwilioSmsPayload = {
  From: string         // sender phone (+E.164)
  To: string           // org's Twilio number (+E.164)
  Body: string
  MessageSid: string
  AccountSid?: string
  NumMedia?: string
}

export async function processTwilioSms(
  payload: TwilioSmsPayload,
  orgId: string
): Promise<void> {
  const supabase = createServiceRoleClient()

  const messageText = (payload.Body ?? '').trim()
  if (!messageText) return

  const fromNumber = payload.From
  const toNumber = payload.To
  const messageSid = payload.MessageSid

  // --- 1. Upsert conversation (de-duplicate by org + channel + From) -----
  const { data: existing } = await supabase
    .from('conversations')
    .select('id, bot_status')
    .eq('org_id', orgId)
    .eq('channel', 'sms')
    .eq('visitor_phone', fromNumber)
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
      })
      .eq('id', conversationId)
  } else {
    const { data: created, error: insertError } = await supabase
      .from('conversations')
      .insert({
        org_id: orgId,
        widget_token: '',
        channel: 'sms',
        channel_metadata: {
          from_number: fromNumber,
          to_number: toNumber,
          last_message_sid: messageSid,
        },
        visitor_phone: fromNumber,
        last_message: messageText,
        last_message_at: now,
        last_inbound_at: now,
      })
      .select('id')
      .single()

    if (insertError || !created) {
      console.error('[twilio/sms] Failed to create conversation:', insertError?.message)
      return
    }
    conversationId = created.id
    void insertNotification(orgId, 'new_conversation', { conversation_id: conversationId, channel: 'sms' })
  }

  // --- 2. Insert inbound user message (idempotent by message_sid in metadata) ---
  // Skip insert if a message with this exact MessageSid was already persisted.
  const { data: dupCheck } = await supabase
    .from('conversation_messages')
    .select('id')
    .eq('conversation_id', conversationId)
    .eq('role', 'user')
    .contains('metadata', { message_sid: messageSid })
    .limit(1)
    .maybeSingle()

  if (dupCheck) {
    console.log('[twilio/sms] Duplicate MessageSid — skipping message insert:', messageSid)
    return
  }

  await supabase.from('conversation_messages').insert({
    conversation_id: conversationId,
    org_id: orgId,
    role: 'user',
    content: messageText,
    metadata: { message_sid: messageSid, from_number: fromNumber },
  })

  // --- 3. Bot status gate — skip AI if a human has taken over -----------
  const botStatus = existing?.bot_status ?? 'active'
  if (botStatus !== 'active') {
    console.log('[twilio/sms] Bot paused for conversation:', conversationId)
    return
  }

  // --- 4. Resolve an agent for channel='sms' via agent_channel_defaults --
  const { data: defaultRow } = await supabase
    .from('agent_channel_defaults')
    .select('agent_id')
    .eq('organization_id', orgId)
    .eq('channel', 'sms')
    .maybeSingle()

  if (!defaultRow?.agent_id) {
    // No agent configured for SMS on this org — inbound logged, no auto-reply.
    return
  }

  // --- 5. Invoke the agent runtime (blocking path) ----------------------
  let replyText = ''
  try {
    const result = await runAgent({
      orgId,
      agentId: defaultRow.agent_id,
      channel: 'sms',
      userMessage: messageText,
      conversationId,
      stream: false,
    })
    replyText = result.text
  } catch (err) {
    console.error('[twilio/sms] runAgent error:', err)
    return
  }

  if (!replyText) return

  // --- 6. Split the reply into SMS-sized chunks ------------------------
  const chunks = formatSms(replyText)

  // --- 7. Send each chunk via the send_sms executor + persist as assistant
  for (const chunk of chunks) {
    if (chunk.type !== 'text') continue

    try {
      await sendSms(
        { to: fromNumber, body: chunk.text },
        { organizationId: orgId, supabase }
      )
    } catch (err) {
      console.error('[twilio/sms] sendSms error:', err)
      // Continue trying remaining chunks — don't bail on a partial failure.
      continue
    }

    await supabase.from('conversation_messages').insert({
      conversation_id: conversationId,
      org_id: orgId,
      role: 'assistant',
      content: chunk.text,
      metadata: { channel: 'sms', from_number: toNumber },
    })
  }
}

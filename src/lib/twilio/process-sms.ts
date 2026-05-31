// src/lib/twilio/process-sms.ts
// Processes a validated inbound Twilio SMS webhook (SEED-005).
// Called from /api/twilio/sms via after() | runs after 200 TwiML is returned.
//
// Pipeline:
//   1. Upsert conversation by (org_id, channel='sms', visitor_phone=From).
//   2. Insert conversation_message (role='user', content=Body).
//   3. If bot_status='active' and an agent is configured for channel='sms' via
//      agent_channel_defaults, invoke runAgent({channel:'sms', stream:false}).
//   4. Persist the assistant reply as a conversation_message.
//   5. Send the reply via the existing send_sms executor (Twilio Messages REST API).
//
// All errors are caught locally | this function never throws (after() context).

import { createServiceRoleClient } from '@/lib/supabase/admin'
import { normalizeInbound } from '@/lib/messaging/normalize-inbound'
import { runAgent } from '@/lib/agent-runtime/run-agent'
import { sendSms } from './send-sms'
import { formatOutbound as formatSms } from '@/lib/agent-runtime/adapters/sms'
import { downloadAndStoreTwilioMedia } from './media'
import { emitInboundPhoneEvent } from './events'
import type { MediaAttachment } from '@/types/chat'

export type TwilioSmsPayload = {
  From: string         // sender phone (+E.164)
  To: string           // org's Twilio number (+E.164)
  Body: string
  MessageSid: string
  AccountSid?: string
  NumMedia?: string
  // MMS media attachments (up to 10)
  MediaUrl0?: string; MediaUrl1?: string; MediaUrl2?: string; MediaUrl3?: string
  MediaUrl4?: string; MediaUrl5?: string; MediaUrl6?: string; MediaUrl7?: string
  MediaUrl8?: string; MediaUrl9?: string
  MediaContentType0?: string; MediaContentType1?: string; MediaContentType2?: string
  MediaContentType3?: string; MediaContentType4?: string; MediaContentType5?: string
  MediaContentType6?: string; MediaContentType7?: string; MediaContentType8?: string
  MediaContentType9?: string
  // Twilio auth token passed internally for media download | never stored
  _authToken?: string
}

export async function processTwilioSms(
  payload: TwilioSmsPayload,
  orgId: string,
  phoneNumberId: string | null = null,
): Promise<void> {
  const supabase = createServiceRoleClient()

  const messageText = (payload.Body ?? '').trim()
  const numMedia = parseInt(payload.NumMedia ?? '0', 10)
  const hasMedia = numMedia > 0
  if (!messageText && !hasMedia) return

  const fromNumber = payload.From
  const toNumber = payload.To
  const messageSid = payload.MessageSid

  // --- 1+2. Upsert conversation + insert inbound message via the shared
  // inbound normalizer (dedup by org + channel='sms' + visitor_phone; idempotent
  // by message_sid). The normalizer owns the find-or-create + last_message bump.
  const now = new Date().toISOString()
  const messageType = hasMedia && !messageText ? 'image' : hasMedia ? 'mixed' : 'text'

  const norm = await normalizeInbound({
    supabase,
    orgId,
    channel: 'sms',
    match: { by: 'visitor_phone', phone: fromNumber },
    updatePayload: {
      last_message: messageText,
      last_message_at: now,
      last_inbound_at: now,
      updated_at: now,
      // Backfill phone_number_id on existing conversations that pre-dated Phase 2.
      ...(phoneNumberId ? { phone_number_id: phoneNumberId } : {}),
    },
    createPayload: {
      widget_token: '',
      channel_metadata: {
        from_number: fromNumber,
        to_number: toNumber,
        last_message_sid: messageSid,
      },
      visitor_phone: fromNumber,
      last_message: messageText,
      last_message_at: now,
      last_inbound_at: now,
      phone_number_id: phoneNumberId,
    },
    message: {
      role: 'user',
      content: messageText,
      message_type: messageType,
      metadata: { message_sid: messageSid, from_number: fromNumber },
    },
    idempotencyMetadata: { message_sid: messageSid },
  })

  if (norm.error) {
    console.error('[twilio/sms] normalizeInbound failed:', norm.error)
    return
  }
  if (norm.duplicate) {
    console.log('[twilio/sms] Duplicate MessageSid | skipping message insert:', messageSid)
    return
  }

  const conversationId = norm.conversationId
  const insertedMsgId = norm.messageId
  if (!insertedMsgId) return

  // Fire inbound_sms_to_number workflow event. Emitter never throws; it runs
  // matched workflows fire-and-forget so the rest of the inbound pipeline
  // (media download, agent invocation, auto-reply) is unaffected.
  await emitInboundPhoneEvent(orgId, 'inbound_sms_to_number', {
    phoneNumberId,
    fromNumber,
    toNumber,
    conversationId,
    externalId: messageSid,
  })

  // --- 2b. Download and store MMS media attachments --------------------
  if (hasMedia && payload.AccountSid && payload._authToken) {
    const mediaItems: MediaAttachment[] = []

    for (let idx = 0; idx < numMedia; idx++) {
      const mediaUrlKey = `MediaUrl${idx}` as keyof TwilioSmsPayload
      const mediaTypeKey = `MediaContentType${idx}` as keyof TwilioSmsPayload
      const mediaUrl = payload[mediaUrlKey] as string | undefined
      const mimeType = (payload[mediaTypeKey] as string | undefined) ?? 'application/octet-stream'

      if (!mediaUrl) continue

      const stored = await downloadAndStoreTwilioMedia({
        mediaUrl,
        mimeType,
        accountSid: payload.AccountSid,
        authToken: payload._authToken,
        orgId,
        conversationId,
        messageId: insertedMsgId,
        idx,
      })

      if (stored) {
        mediaItems.push({
          url: stored.url,
          mime_type: mimeType,
          size: stored.size,
          filename: stored.filename,
        })
      } else {
        // Fallback: include the original Twilio URL so the attachment isn't lost
        mediaItems.push({ url: mediaUrl, mime_type: mimeType })
      }
    }

    if (mediaItems.length > 0) {
      await supabase
        .from('conversation_messages')
        .update({
          metadata: { message_sid: messageSid, from_number: fromNumber, media: mediaItems },
        })
        .eq('id', insertedMsgId)
    }
  }

  // --- 3. Bot status gate | skip AI if a human has taken over -----------
  const botStatus = norm.existing?.bot_status ?? 'active'
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
    // No agent configured for SMS on this org | inbound logged, no auto-reply.
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
      // Continue trying remaining chunks | don't bail on a partial failure.
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

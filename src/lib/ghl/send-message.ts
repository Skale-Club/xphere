// src/lib/ghl/send-message.ts
// Generalized GHL message sender for the push-pull inbox architecture.
// Sends messages via the GHL Conversations API for SMS, WhatsApp, IG DM, etc.
// The contact must already exist in GHL | contactId is required.

import { ghlFetchJson, type GhlCredentials } from './client'

const SEND_TIMEOUT_MS = 3000

type GhlMessageType = 'SMS' | 'WhatsApp' | 'IG' | 'FB' | 'Email' | 'Live_Chat'

interface SendMessageResponse {
  messageId?: string
  conversationId?: string
  msg?: string
}

export interface SendGhlMessageParams {
  contactId: string
  message: string
  type: GhlMessageType
  fromNumber?: string
  conversationId?: string
}

export async function sendGhlMessage(
  params: SendGhlMessageParams,
  credentials: GhlCredentials
): Promise<{ messageId: string }> {
  const body: Record<string, string> = {
    type: params.type,
    contactId: params.contactId,
    message: params.message,
  }

  if (params.fromNumber) body.fromNumber = params.fromNumber
  if (params.conversationId) body.conversationId = params.conversationId

  const sent = await ghlFetchJson<SendMessageResponse>(
    '/conversations/messages',
    'POST',
    body,
    credentials,
    undefined,
    SEND_TIMEOUT_MS
  )

  return { messageId: sent.messageId ?? sent.conversationId ?? 'sent' }
}

export function channelToGhlType(channel: string): GhlMessageType {
  if (channel === 'ghl_whatsapp') return 'WhatsApp'
  return 'SMS'
}

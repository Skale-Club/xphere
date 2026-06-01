// src/lib/zernio/send-dm.ts
// Sends a reply DM via the Zernio Inbox API.
// Endpoint: POST /v1/inbox/conversations/{conversationId}/messages
// Zernio routes the reply through the account that owns the conversation.

import { zernioFetchJson } from './client'

interface SendDmResult {
  messageId: string
}

interface ZernioSendResponse {
  success?: boolean
  data?: {
    messageId?: string
    conversationId?: string | null
    sentAt?: string | null
    message?: string | null
  }
}

export async function sendZernioDm(
  zernioConversationId: string,
  zernioAccountId: string,
  text: string,
  apiKey: string,
): Promise<SendDmResult> {
  const data = await zernioFetchJson<ZernioSendResponse>(
    `/inbox/conversations/${encodeURIComponent(zernioConversationId)}/messages`,
    'POST',
    { accountId: zernioAccountId, message: text },
    apiKey,
  )

  return { messageId: data.data?.messageId ?? '' }
}

// src/lib/zernio/send-dm.ts
// Sends a reply DM via the Zernio Inbox API.
// Endpoint: POST /v1/inbox/messages
// Zernio routes the reply to the correct platform (Instagram, Facebook, etc.)
// based on the conversationId — no platform-specific logic needed here.

import { zernioFetchJson } from './client'

interface SendDmResult {
  messageId: string
}

interface ZernioSendResponse {
  message?: { _id?: string }
  _id?: string
}

export async function sendZernioDm(
  zernioConversationId: string,
  text: string,
  apiKey: string,
): Promise<SendDmResult> {
  const data = await zernioFetchJson<ZernioSendResponse>(
    '/inbox/messages',
    'POST',
    { conversationId: zernioConversationId, text },
    apiKey,
  )

  const messageId = data?.message?._id ?? data?._id ?? ''
  return { messageId }
}

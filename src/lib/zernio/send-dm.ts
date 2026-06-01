// src/lib/zernio/send-dm.ts
// Sends a reply DM via the Zernio Inbox API.
// Endpoint: POST /v1/inbox/conversations/{conversationId}/messages
// Zernio routes the reply through the account that owns the conversation.

import { zernioFetchJson } from './client'

interface SendDmResult {
  messageId: string
}

export interface ZernioDmAttachment {
  url: string
  mime_type: string
  filename?: string
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

function attachmentTypeFromMime(mimeType: string): 'image' | 'video' | 'audio' | 'file' {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.startsWith('audio/')) return 'audio'
  return 'file'
}

export async function sendZernioDm(
  zernioConversationId: string,
  zernioAccountId: string,
  text: string,
  apiKey: string,
  options: { attachment?: ZernioDmAttachment; voiceNote?: boolean } = {},
): Promise<SendDmResult> {
  const body: Record<string, unknown> = { accountId: zernioAccountId }
  if (text) body.message = text
  if (options.attachment) {
    body.attachmentUrl = options.attachment.url
    body.attachmentType = attachmentTypeFromMime(options.attachment.mime_type)
    if (options.voiceNote) body.voiceNote = true
  }

  const data = await zernioFetchJson<ZernioSendResponse>(
    `/inbox/conversations/${encodeURIComponent(zernioConversationId)}/messages`,
    'POST',
    body,
    apiKey,
  )

  return { messageId: data.data?.messageId ?? '' }
}

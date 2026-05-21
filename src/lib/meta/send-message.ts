// src/lib/meta/send-message.ts
// Sole caller of Meta Graph API Send endpoint.
// Import META_GRAPH_VERSION | never hardcode 'v21.0'.
import { META_GRAPH_VERSION } from '@/lib/meta/oauth'
import type { MetaOutboundMedia } from './types'

type SendSuccess = { messageId: string }
type SendError   = { error: string; code?: number }

export async function sendMetaMessage(
  pageToken: string,
  recipientId: string,
  text: string,
  media?: MetaOutboundMedia,
): Promise<SendSuccess | SendError> {
  const url = `https://graph.facebook.com/${META_GRAPH_VERSION}/me/messages`
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 10_000)

  // Build message payload: media attachment takes precedence when provided.
  const messagePayload = media
    ? { attachment: { type: media.type, payload: { url: media.url, is_reusable: true } } }
    : { text }

  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${pageToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        recipient: { id: recipientId },
        message: messagePayload,
        messaging_type: 'RESPONSE',
      }),
    })

    const json = await res.json() as {
      message_id?: string
      error?: { message?: string; code?: number }
    }

    if (!res.ok) {
      return {
        error: json.error?.message ?? 'Meta API error',
        code: json.error?.code,
      }
    }

    return { messageId: json.message_id ?? '' }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { error: 'Meta API timeout', code: undefined }
    }
    return { error: String(err) }
  } finally {
    clearTimeout(timeout)
  }
}

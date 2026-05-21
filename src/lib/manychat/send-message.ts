// src/lib/manychat/send-message.ts
// Endpoint: POST https://api.manychat.com/fb/sending/sendContent
// Body:     { subscriber_id, data: <Dynamic Block v2>, message_tag }
// Dynamic Block schema: https://manychat.github.io/dynamic_block_docs/  (version "v2")
//
// Phase 25 ships text-only convenience: pass `text: 'hi'` and the executor
// builds a minimal v2 dynamic-block. Otherwise pass through `data` unchanged.
//
// message_tag defaults to 'ACCOUNT_UPDATE' | the most permissive transactional tag.
// Operator override via params.message_tag.

import { manychatFetchJson, type ManychatCredentials } from './client'
import { resolveSubscriberId } from './subscriber-id'

interface SendMessageParams {
  subscriber_id?: string | number
  data?: unknown               // dynamic-block v2 object
  message_tag?: string         // FB messaging tag, defaults to ACCOUNT_UPDATE
  text?: string                // convenience: build text-only block when `data` not provided
  [key: string]: unknown
}

export async function sendManychatMessage(
  params: Record<string, unknown>,
  credentials: ManychatCredentials,
): Promise<string> {
  const subscriberId = resolveSubscriberId(params)
  const p = params as SendMessageParams

  // Convenience: build a minimal text block if caller passed `text` instead of `data`
  const data =
    p.data ??
    (typeof p.text === 'string'
      ? { version: 'v2', content: { messages: [{ type: 'text', text: p.text }] } }
      : undefined)
  if (!data) throw new Error('data or text is required for manychat_send_message')

  await manychatFetchJson(
    '/fb/sending/sendContent',
    'POST',
    {
      subscriber_id: subscriberId,
      data,
      message_tag: p.message_tag ?? 'ACCOUNT_UPDATE',
    },
    credentials,
  )

  return `Message sent to subscriber ${subscriberId}.`
}

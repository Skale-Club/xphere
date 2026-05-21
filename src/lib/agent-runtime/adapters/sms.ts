// src/lib/agent-runtime/adapters/sms.ts
// SMS channel adapter (Twilio direct inbound | SEED-005).
//
// SMS is a strict plain-text channel:
//   - Markdown is stripped (no bold/italic/links | recipients see raw chars otherwise).
//   - 1600 chars per outbound message | Twilio caps a single REST API call at 1600
//     chars even though it auto-segments into multiple SMS parts (160 GSM-7 / 70 UCS-2).
//   - Long replies are split at sentence boundaries to keep chunks readable.

import type { ChannelMessage, FormatOptions } from './index'
import { stripMarkdown, splitAtSentenceBoundary } from './index'

// Twilio Messages REST API hard limit per single POST.
const SMS_MAX_CHARS = 1600

export function formatOutbound(text: string, opts?: FormatOptions): ChannelMessage[] {
  const maxLen = opts?.maxChunkLength ?? SMS_MAX_CHARS
  const stripped = stripMarkdown(text)
  const chunks = splitAtSentenceBoundary(stripped, maxLen)
  return chunks.map((chunk) => ({ type: 'text' as const, text: chunk }))
}

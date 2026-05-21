// src/lib/agent-runtime/adapters/telegram.ts
// Telegram channel adapter.
// Hard limit: 4096 characters per message (Telegram Bot API).
// Markdown: stripped (plain text mode | MarkdownV2 escaping is complex and
// deferred; future phases can enable parse_mode: 'MarkdownV2' if needed).
// Returns multiple ChannelMessage chunks when text exceeds 4096 chars.

import type { ChannelMessage, FormatOptions } from './index'
import { stripMarkdown, splitAtSentenceBoundary } from './index'

const TELEGRAM_MAX_CHARS = 4096

export function formatOutbound(text: string, opts?: FormatOptions): ChannelMessage[] {
  const maxLen = opts?.maxChunkLength ?? TELEGRAM_MAX_CHARS
  const stripped = stripMarkdown(text)
  const chunks = splitAtSentenceBoundary(stripped, maxLen)
  return chunks.map((chunk) => ({ type: 'text' as const, text: chunk }))
}

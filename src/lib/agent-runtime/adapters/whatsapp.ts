// src/lib/agent-runtime/adapters/whatsapp.ts
// WhatsApp channel adapter.
// Hard limit: 1600 characters per message (WhatsApp Business API).
// Markdown: converted to WhatsApp's own markup (*bold*, _italic_, ~strike~)
// instead of being stripped, and URLs are kept — a WhatsApp reply without its
// link (order form, booking page) is useless. Standard stripMarkdown() replaces
// bare URLs with "[link]", so it must never be used for this channel.
// Returns multiple ChannelMessage chunks when text exceeds 1600 chars.

import type { ChannelMessage, FormatOptions } from './index'
import { splitAtSentenceBoundary } from './index'

const WHATSAPP_MAX_CHARS = 1600

/** Rewrites model markdown into WhatsApp-native markup. Keeps every URL. */
export function toWhatsAppMarkup(text: string): string {
  return text
    // Headings (# ## ###) → plain line
    .replace(/^#{1,6}\s+/gm, '')
    // Bold+italic / bold: ***x*** / **x** → *x*
    .replace(/\*{3}([^*\n][\s\S]*?)\*{3}/g, '*$1*')
    .replace(/\*{2}([^*\n][\s\S]*?)\*{2}/g, '*$1*')
    // Bold: __x__ → _x_ (WhatsApp has no underline; italic is the closest)
    .replace(/_{2}([^_\n][\s\S]*?)_{2}/g, '_$1_')
    // Strikethrough: ~~x~~ → ~x~
    .replace(/~~([\s\S]+?)~~/g, '~$1~')
    // Links: [label](url) → "label: url" (just the url when they are the same)
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, url: string) =>
      label.trim() === url ? url : `${label}: ${url}`,
    )
    .trim()
}

export function formatOutbound(text: string, opts?: FormatOptions): ChannelMessage[] {
  const maxLen = opts?.maxChunkLength ?? WHATSAPP_MAX_CHARS
  const chunks = splitAtSentenceBoundary(toWhatsAppMarkup(text), maxLen)
  return chunks.map((chunk) => ({ type: 'text' as const, text: chunk }))
}

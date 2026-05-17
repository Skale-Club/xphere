// src/lib/agent-runtime/adapters/index.ts
// Channel adapter public API — import from here, not from individual files.

export type ChannelMessage =
  | { type: 'text'; text: string }
  | { type: 'manychat_block'; data: ManychatDynamicBlock }

export type ManychatDynamicBlock = {
  version: 'v2'
  content: { messages: Array<{ type: 'text'; text: string }> }
}

export type FormatOptions = {
  /** Override the hard character limit. Defaults to channel's native limit. */
  maxChunkLength?: number
}

export { formatOutbound as formatWebWidget } from './web_widget'
export { formatOutbound as formatWhatsapp } from './whatsapp'
export { formatOutbound as formatMeta } from './meta'
export { formatOutbound as formatManychat } from './manychat'
export { formatOutbound as formatTelegram } from './telegram'
export { formatOutbound as formatSms } from './sms'

/**
 * Shared: strip markdown formatting characters from text.
 * Removes: **bold**, *italic*, __underline__, ~~strikethrough~~, `code`, [link](url), # headings.
 * WhatsApp uses its own markup (*bold*, _italic_) — callers that need channel-native
 * markup should handle that conversion after stripMarkdown().
 */
export function stripMarkdown(text: string): string {
  return text
    // Headings (# ## ###)
    .replace(/^#{1,6}\s+/gm, '')
    // Code blocks: ```...``` (must come before inline code to avoid partial matches)
    .replace(/```[\s\S]*?```/g, '')
    // Bold+italic: ***text*** ([\s\S] instead of . with s-flag for ES2017 compat)
    .replace(/\*{3}([\s\S]+?)\*{3}/g, '$1')
    // Bold: **text**
    .replace(/\*{2}([\s\S]+?)\*{2}/g, '$1')
    // Italic: *text*
    .replace(/\*([\s\S]+?)\*/g, '$1')
    // Bold+italic: ___text___
    .replace(/_{3}([\s\S]+?)_{3}/g, '$1')
    // Bold: __text__
    .replace(/_{2}([\s\S]+?)_{2}/g, '$1')
    // Italic: _text_ (word-boundary guard — no lookbehind needed for non-word chars)
    .replace(/(^|[^a-zA-Z0-9])_([\s\S]+?)_(?=[^a-zA-Z0-9]|$)/gm, '$1$2')
    // Strikethrough: ~~text~~
    .replace(/~~([\s\S]+?)?~~/g, '$1')
    // Inline code: `code`
    .replace(/`([\s\S]+?)`/g, '$1')
    // Links: [label](url) → label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Remaining bare URLs (http/https)
    .replace(/https?:\/\/\S+/g, '[link]')
    .trim()
}

/**
 * Shared: split text into chunks of at most maxLen characters, breaking at
 * sentence boundaries (. ! ?) when possible. If no sentence boundary exists
 * within the limit, falls back to word boundary, then hard cut.
 *
 * This is the canonical implementation for CHAN-02. All channel adapters call this.
 */
export function splitAtSentenceBoundary(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > maxLen) {
    // Search for sentence boundary (. ! ?) followed by whitespace or end-of-string
    const slice = remaining.slice(0, maxLen)
    // Find last sentence-ending punctuation in the window
    const sentenceEnd = Math.max(
      slice.lastIndexOf('. '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('? '),
      slice.lastIndexOf('.\n'),
      slice.lastIndexOf('!\n'),
      slice.lastIndexOf('?\n'),
    )

    let cut: number
    if (sentenceEnd > 0) {
      // Include the punctuation character
      cut = sentenceEnd + 1
    } else {
      // Fall back to word boundary
      const wordEnd = slice.lastIndexOf(' ')
      cut = wordEnd > 0 ? wordEnd : maxLen
    }

    chunks.push(remaining.slice(0, cut).trim())
    remaining = remaining.slice(cut).trimStart()
  }

  if (remaining.length > 0) chunks.push(remaining)
  return chunks
}

import { describe, it, expect } from 'vitest'

import {
  stripMarkdown,
  splitAtSentenceBoundary,
} from '@/lib/agent-runtime/adapters/index'
import { formatOutbound as formatWhatsapp } from '@/lib/agent-runtime/adapters/whatsapp'
import { formatOutbound as formatMeta } from '@/lib/agent-runtime/adapters/meta'
import { formatOutbound as formatTelegram } from '@/lib/agent-runtime/adapters/telegram'
import { formatOutbound as formatManychat } from '@/lib/agent-runtime/adapters/manychat'
import { formatOutbound as formatWebWidget } from '@/lib/agent-runtime/adapters/web_widget'

// ---------------------------------------------------------------------------
// stripMarkdown
// ---------------------------------------------------------------------------

describe('stripMarkdown', () => {
  it('strips **bold** markers', () => {
    expect(stripMarkdown('Hello **world**')).toBe('Hello world')
  })

  it('strips *italic* markers', () => {
    expect(stripMarkdown('Hello *world*')).toBe('Hello world')
  })

  it('strips __underline__ markers', () => {
    expect(stripMarkdown('Hello __world__')).toBe('Hello world')
  })

  it('strips ~~strikethrough~~ markers', () => {
    expect(stripMarkdown('Hello ~~world~~')).toBe('Hello world')
  })

  it('strips inline `code` markers', () => {
    expect(stripMarkdown('Use `npm install`')).toBe('Use npm install')
  })

  it('strips [link](url) to label only', () => {
    expect(stripMarkdown('Visit [our site](https://example.com)')).toBe('Visit our site')
  })

  it('strips # heading markers', () => {
    expect(stripMarkdown('# Title\nBody text')).toBe('Title\nBody text')
  })

  it('strips ## and ### headings', () => {
    expect(stripMarkdown('## Section\n### Sub')).toBe('Section\nSub')
  })

  it('leaves plain text unchanged', () => {
    const plain = 'Hello, how can I help you today?'
    expect(stripMarkdown(plain)).toBe(plain)
  })

  it('strips code blocks', () => {
    const input = 'Here is code:\n```\nconst x = 1\n```\nDone.'
    const result = stripMarkdown(input)
    expect(result).not.toContain('```')
    expect(result).toContain('Here is code:')
    expect(result).toContain('Done.')
  })
})

// ---------------------------------------------------------------------------
// splitAtSentenceBoundary
// ---------------------------------------------------------------------------

describe('splitAtSentenceBoundary', () => {
  it('returns single chunk when text is within limit', () => {
    const text = 'Hello world.'
    const chunks = splitAtSentenceBoundary(text, 100)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toBe('Hello world.')
  })

  it('splits at sentence boundary when text exceeds limit', () => {
    // Two sentences totaling more than 20 chars
    const text = 'First sentence here. Second sentence here.'
    const chunks = splitAtSentenceBoundary(text, 25)
    expect(chunks.length).toBeGreaterThan(1)
    // First chunk must end with 'First sentence here.'
    expect(chunks[0]).toBe('First sentence here.')
  })

  it('falls back to word boundary when no sentence boundary in window', () => {
    const text = 'one two three four five six seven eight nine ten'
    const chunks = splitAtSentenceBoundary(text, 20)
    // Each chunk must be <= 20 chars
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(20)
    }
    // All words preserved across chunks
    expect(chunks.join(' ')).toBe(text)
  })

  it('splits ! boundary', () => {
    const text = 'Great news! This is more text that goes on.'
    const chunks = splitAtSentenceBoundary(text, 15)
    expect(chunks[0]).toBe('Great news!')
  })

  it('splits ? boundary', () => {
    const text = 'How are you? I am fine thanks.'
    const chunks = splitAtSentenceBoundary(text, 15)
    expect(chunks[0]).toBe('How are you?')
  })
})

// ---------------------------------------------------------------------------
// WhatsApp adapter — 1600-char limit + markdown stripping
// ---------------------------------------------------------------------------

describe('formatWhatsapp', () => {
  it('returns single chunk for short text', () => {
    const chunks = formatWhatsapp('Hello there')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: 'text', text: 'Hello there' })
  })

  it('strips markdown from output', () => {
    const chunks = formatWhatsapp('**Bold** and *italic* text')
    expect(chunks[0].text).not.toContain('**')
    expect(chunks[0].text).not.toContain('*italic*')
  })

  it('splits 3000-char text into chunks of ≤1600 chars (Success Criterion 5)', () => {
    // Build a 3000-char text with sentence boundaries
    const sentence = 'This is a test sentence that provides content. '
    // ~46 chars per sentence; 65 sentences = ~3000 chars
    const longText = sentence.repeat(65).trimEnd()
    expect(longText.length).toBeGreaterThanOrEqual(2990)

    const chunks = formatWhatsapp(longText)

    // Must produce multiple chunks
    expect(chunks.length).toBeGreaterThan(1)

    // Every chunk must be within the 1600-char limit
    for (const chunk of chunks) {
      expect(chunk.type).toBe('text')
      if (chunk.type === 'text') {
        expect(chunk.text.length).toBeLessThanOrEqual(1600)
      }
    }

    // Total content must be preserved (whitespace may differ after trimming)
    const combined = chunks.map((c) => (c.type === 'text' ? c.text : '')).join(' ')
    // All words from longText appear in combined
    const originalWords = longText.split(/\s+/).filter(Boolean)
    const combinedWords = combined.split(/\s+/).filter(Boolean)
    expect(combinedWords.length).toBeGreaterThanOrEqual(originalWords.length - 5)
  })

  it('respects maxChunkLength override', () => {
    const text = 'One sentence. Two sentence. Three sentence. Four sentence.'
    const chunks = formatWhatsapp(text, { maxChunkLength: 20 })
    for (const chunk of chunks) {
      if (chunk.type === 'text') {
        expect(chunk.text.length).toBeLessThanOrEqual(20)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Meta adapter — 2000-char limit + markdown stripping
// ---------------------------------------------------------------------------

describe('formatMeta', () => {
  it('returns single text chunk for short text', () => {
    const chunks = formatMeta('Hello from Meta')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: 'text', text: 'Hello from Meta' })
  })

  it('strips markdown', () => {
    const chunks = formatMeta('# Title\n**Bold** text')
    expect(chunks[0].text).not.toContain('#')
    expect(chunks[0].text).not.toContain('**')
  })

  it('splits text longer than 2000 chars into ≤2000-char chunks', () => {
    const sentence = 'Meta messenger has a two thousand character limit per message. '
    const longText = sentence.repeat(35).trimEnd()
    expect(longText.length).toBeGreaterThan(2000)

    const chunks = formatMeta(longText)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      if (chunk.type === 'text') {
        expect(chunk.text.length).toBeLessThanOrEqual(2000)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Telegram adapter — 4096-char limit + markdown stripping
// ---------------------------------------------------------------------------

describe('formatTelegram', () => {
  it('returns single chunk for short text', () => {
    const chunks = formatTelegram('Hello Telegram')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: 'text', text: 'Hello Telegram' })
  })

  it('does NOT split text under 4096 chars', () => {
    // 4000-char text should stay as one chunk
    const text = 'a'.repeat(4000)
    const chunks = formatTelegram(text)
    expect(chunks).toHaveLength(1)
  })

  it('splits text over 4096 chars into ≤4096-char chunks', () => {
    const sentence = 'Telegram supports up to four thousand and ninety six characters. '
    const longText = sentence.repeat(70).trimEnd()
    expect(longText.length).toBeGreaterThan(4096)

    const chunks = formatTelegram(longText)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      if (chunk.type === 'text') {
        expect(chunk.text.length).toBeLessThanOrEqual(4096)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// ManyChat adapter — 640-char limit, Dynamic Block v2 format
// ---------------------------------------------------------------------------

describe('formatManychat', () => {
  it('returns single manychat_block for short text', () => {
    const chunks = formatManychat('Hello ManyChat')
    expect(chunks).toHaveLength(1)
    expect(chunks[0].type).toBe('manychat_block')
  })

  it('produces valid Dynamic Block v2 shape', () => {
    const chunks = formatManychat('Hello ManyChat')
    const chunk = chunks[0]
    expect(chunk.type).toBe('manychat_block')
    if (chunk.type === 'manychat_block') {
      expect(chunk.data.version).toBe('v2')
      expect(chunk.data.content.messages).toHaveLength(1)
      expect(chunk.data.content.messages[0].type).toBe('text')
      expect(chunk.data.content.messages[0].text).toBe('Hello ManyChat')
    }
  })

  it('strips markdown from block text', () => {
    const chunks = formatManychat('**Bold** response')
    const chunk = chunks[0]
    if (chunk.type === 'manychat_block') {
      expect(chunk.data.content.messages[0].text).not.toContain('**')
      expect(chunk.data.content.messages[0].text).toBe('Bold response')
    }
  })

  it('splits text over 640 chars into multiple blocks', () => {
    const sentence = 'ManyChat has a six hundred and forty character limit. '
    const longText = sentence.repeat(15).trimEnd()
    expect(longText.length).toBeGreaterThan(640)

    const chunks = formatManychat(longText)
    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.type).toBe('manychat_block')
      if (chunk.type === 'manychat_block') {
        const text = chunk.data.content.messages[0].text
        expect(text.length).toBeLessThanOrEqual(640)
      }
    }
  })
})

// ---------------------------------------------------------------------------
// Web widget adapter — no limit, no markdown stripping
// ---------------------------------------------------------------------------

describe('formatWebWidget', () => {
  it('returns single text chunk for any input', () => {
    const chunks = formatWebWidget('Hello **world** with *markdown*')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toEqual({ type: 'text', text: 'Hello **world** with *markdown*' })
  })

  it('does NOT strip markdown (widget renders it natively)', () => {
    const md = '**Bold** and [link](https://example.com)'
    const chunks = formatWebWidget(md)
    // Markdown is preserved as-is
    expect(chunks[0].text).toBe(md)
  })

  it('does NOT split long text', () => {
    const longText = 'a'.repeat(10000)
    const chunks = formatWebWidget(longText)
    expect(chunks).toHaveLength(1)
    expect(chunks[0].text).toHaveLength(10000)
  })
})

// Heading-aware chunking for Global Knowledge Notion pages.
//
// The generic chunkText() slices every 500 tokens regardless of structure, so
// only the first chunk carries the page title and a chunk cut mid-section has
// no idea what topic it belongs to. Here each chunk is built from whole
// sections and opens with the page title plus the heading path of its first
// section, so every chunk retrieved on its own still says what it is about.
import { encode } from 'gpt-tokenizer'
import { chunkText } from '@/lib/knowledge/chunk-text'

/** Bump when chunk shape changes so unchanged pages re-embed on the next sync. */
export const NOTION_CHUNKER_VERSION = 'heading-v1'

const HEADING = /^(#{1,6})\s+(.*\S)\s*$/
// Notion's markdown renders child pages / databases as their own lines. They
// are navigation, not knowledge — the child pages are indexed on their own.
const CHILD_REFERENCE = /^\s*<(page|database)\b[^>]*>.*<\/\1>\s*$/

export function stripChildReferences(markdown: string): string {
  return markdown
    .split('\n')
    .filter((line) => !CHILD_REFERENCE.test(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

type Section = { path: string[]; lines: string[] }

function tokenCount(text: string): number {
  return encode(text).length
}

function splitSections(markdown: string, title: string): Section[] {
  const sections: Section[] = []
  const stack: Array<{ level: number; text: string }> = []
  let current: Section = { path: [], lines: [] }
  let first = true

  for (const line of markdown.split('\n')) {
    const match = HEADING.exec(line)
    if (!match) {
      current.lines.push(line)
      continue
    }
    const level = match[1].length
    const text = match[2]
    // A leading H1 that repeats the page title adds nothing to the path.
    if (first && level === 1 && text.trim().toLowerCase() === title.trim().toLowerCase()) {
      first = false
      continue
    }
    first = false
    if (current.lines.some((l) => l.trim()) || current.path.length > 0) sections.push(current)
    while (stack.length > 0 && stack[stack.length - 1].level >= level) stack.pop()
    stack.push({ level, text })
    current = { path: stack.map((h) => h.text), lines: [] }
  }
  if (current.lines.some((l) => l.trim()) || current.path.length > 0) sections.push(current)
  return sections.filter((s) => s.lines.some((l) => l.trim()) || s.path.length > 0)
}

function headingLines(path: string[]): string[] {
  return path.map((text, index) => `${'#'.repeat(Math.min(index + 2, 6))} ${text}`)
}

/** Body of one section, split into pieces that fit `budget` tokens, preferring paragraph then line breaks. */
function splitBody(body: string, budget: number): string[] {
  if (tokenCount(body) <= budget) return [body]
  const units = body.split(/\n{2,}/).flatMap((paragraph) =>
    tokenCount(paragraph) <= budget ? [paragraph] : paragraph.split('\n'),
  )
  const pieces: string[] = []
  let buffer = ''
  for (const unit of units) {
    if (tokenCount(unit) > budget) {
      if (buffer) pieces.push(buffer)
      buffer = ''
      pieces.push(...chunkText(unit, budget, 0))
      continue
    }
    const candidate = buffer ? `${buffer}\n\n${unit}` : unit
    if (tokenCount(candidate) <= budget) {
      buffer = candidate
    } else {
      pieces.push(buffer)
      buffer = unit
    }
  }
  if (buffer) pieces.push(buffer)
  return pieces.filter((piece) => piece.trim())
}

/**
 * Chunk a Notion page so every chunk opens with `# <title>` and the heading
 * path of the content it holds. Small consecutive sections share a chunk; a
 * section larger than the budget is split on paragraph boundaries and each
 * piece repeats its heading path.
 */
export function chunkNotionPage(params: {
  title: string
  body: string
  maxTokens?: number
}): string[] {
  const maxTokens = params.maxTokens ?? 500
  const titleLine = `# ${params.title.trim()}`
  const body = params.body.trim()
  if (!body) return []

  const chunks: string[] = []
  let buffer: string[] = []
  // Path already written into the current buffer, so a following sibling
  // section only adds the headings that differ.
  let bufferPath: string[] = []

  const flush = () => {
    if (buffer.length > 0) chunks.push([titleLine, ...buffer].join('\n').trim())
    buffer = []
    bufferPath = []
  }

  for (const section of splitSections(body, params.title)) {
    const text = section.lines.join('\n').trim()
    let shared = 0
    while (
      shared < bufferPath.length &&
      shared < section.path.length &&
      bufferPath[shared] === section.path[shared]
    ) shared += 1
    const newHeadings = headingLines(section.path).slice(shared)
    const unit = [...newHeadings, text].filter(Boolean).join('\n')
    const candidate = [titleLine, ...buffer, unit].join('\n')

    if (buffer.length > 0 && tokenCount(candidate) <= maxTokens) {
      buffer.push(unit)
      bufferPath = section.path
      continue
    }

    flush()
    const fullHeadings = headingLines(section.path)
    const prefix = [titleLine, ...fullHeadings].join('\n')
    const budget = Math.max(maxTokens - tokenCount(prefix) - 1, 50)
    const pieces = text ? splitBody(text, budget) : ['']
    pieces.forEach((piece, index) => {
      const isLast = index === pieces.length - 1
      const block = [...fullHeadings, piece].filter(Boolean).join('\n')
      if (isLast) {
        buffer = [block]
        bufferPath = section.path
      } else {
        chunks.push([titleLine, block].join('\n').trim())
      }
    })
  }
  flush()
  // Never emit a chunk that holds nothing but the page title.
  return chunks.filter((chunk) => chunk !== titleLine)
}

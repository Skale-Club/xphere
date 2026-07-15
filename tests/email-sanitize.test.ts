import { describe, it, expect } from 'vitest'
import {
  sanitizeInlineHtml,
  sanitizeBlockHtml,
  sanitizeUrl,
  sanitizeEmailDocument,
  sanitizeBlocks,
  sanitizeSectionTemplateDoc,
} from '@/lib/email/sanitize'
import {
  validateEmailDocument, validateSectionFragment, validateSectionTemplateDoc,
} from '@/lib/email/schema'
import {
  BLOCK_DEFAULTS,
  makeBlockId,
  normalizeDocument,
  normalizeSectionTemplateDoc,
  type EmailDocument,
  type TextBlock,
  type HeadingBlock,
  type HtmlBlock,
  type ButtonBlock,
  type ImageBlock,
} from '@/lib/email/render-template'

// Phase 1 — Security & data integrity (email-builder-hardening PLAN.md).
// Covers Findings #1 (no HTML sanitization / javascript: hrefs) and #3 (no
// server-side document validation).

describe('sanitizeInlineHtml', () => {
  it('strips <script> tags and their content', () => {
    const out = sanitizeInlineHtml('<p>hi</p><script>alert(1)</script>')
    expect(out).not.toContain('<script')
    expect(out).not.toContain('alert(1)')
  })

  it('strips onerror/onclick event handler attributes', () => {
    const out = sanitizeInlineHtml('<span onclick="alert(1)">click</span><img src=x onerror="alert(2)">')
    expect(out).not.toContain('onclick')
    expect(out).not.toContain('onerror')
  })

  it('empties a javascript: href', () => {
    const out = sanitizeInlineHtml('<a href="javascript:alert(1)">go</a>')
    expect(out).not.toContain('javascript:')
    expect(out).not.toContain('href="javascript')
  })

  it('preserves an https: href and a merge-tag-bearing href', () => {
    const out = sanitizeInlineHtml('<a href="https://xphere.app">link</a>')
    expect(out).toContain('href="https://xphere.app"')

    const merged = sanitizeInlineHtml('<a href="https://xphere.app/u/{{contact.id}}">unsubscribe</a>')
    expect(merged).toContain('{{contact.id}}')
  })

  it('preserves <strong> and <a> in inline content', () => {
    const out = sanitizeInlineHtml('<strong>bold</strong> and <a href="https://x.com">link</a>')
    expect(out).toContain('<strong>bold</strong>')
    expect(out).toContain('<a href="https://x.com"')
  })

  it('drops tags outside the inline allowlist (e.g. div, table) but keeps their text', () => {
    const out = sanitizeInlineHtml('<div><table><tr><td>cell</td></tr></table></div>')
    expect(out).not.toContain('<div')
    expect(out).not.toContain('<table')
    expect(out).toContain('cell')
  })

  it('restricts span style to the allowed property subset', () => {
    const out = sanitizeInlineHtml('<span style="color:#ff0000;position:absolute;left:0">x</span>')
    expect(out).toContain('color:#ff0000')
    expect(out).not.toContain('position')
  })

  it('returns an empty string for empty/nullish input', () => {
    expect(sanitizeInlineHtml('')).toBe('')
    expect(sanitizeInlineHtml(null)).toBe('')
    expect(sanitizeInlineHtml(undefined)).toBe('')
  })
})

describe('sanitizeBlockHtml', () => {
  it('strips <script>, <iframe>, and <form> tags', () => {
    const out = sanitizeBlockHtml(
      '<p>ok</p><script>alert(1)</script><iframe src="https://evil.com"></iframe><form action="/x"><input></form>',
    )
    expect(out).not.toContain('<script')
    expect(out).not.toContain('<iframe')
    expect(out).not.toContain('<form')
    expect(out).toContain('<p>ok</p>')
  })

  it('strips event handler attributes on allowed tags', () => {
    const out = sanitizeBlockHtml('<table onmouseover="alert(1)"><tr><td>cell</td></tr></table>')
    expect(out).not.toContain('onmouseover')
    expect(out).toContain('cell')
  })

  it('empties a javascript: href on an anchor', () => {
    const out = sanitizeBlockHtml('<p><a href="javascript:alert(1)">click</a></p>')
    expect(out).not.toContain('javascript:')
  })

  it('allows table/img/heading markup with inline style', () => {
    const out = sanitizeBlockHtml(
      '<table><tr><td style="padding:8px;color:#333"><img src="https://cdn.example.com/a.png" alt="a" /><h2>Title</h2></td></tr></table>',
    )
    expect(out).toContain('<table')
    expect(out).toContain('<img')
    expect(out).toContain('<h2>Title</h2>')
    expect(out).toContain('padding:8px')
  })

  it('returns an empty string for empty/nullish input', () => {
    expect(sanitizeBlockHtml('')).toBe('')
    expect(sanitizeBlockHtml(null)).toBe('')
  })
})

describe('sanitizeUrl', () => {
  it('empties javascript:/data:/vbscript: values', () => {
    expect(sanitizeUrl('javascript:alert(1)')).toBe('')
    expect(sanitizeUrl('data:text/html,<script>alert(1)</script>')).toBe('')
    expect(sanitizeUrl('vbscript:msgbox(1)')).toBe('')
  })

  it('empties obfuscated dangerous schemes (whitespace/case tricks)', () => {
    expect(sanitizeUrl('  JavaScript:alert(1)')).toBe('')
    expect(sanitizeUrl('java\tscript:alert(1)')).toBe('')
  })

  it('preserves http:/https:/mailto:/tel: values', () => {
    expect(sanitizeUrl('https://xphere.app')).toBe('https://xphere.app')
    expect(sanitizeUrl('http://example.com')).toBe('http://example.com')
    expect(sanitizeUrl('mailto:hi@example.com')).toBe('mailto:hi@example.com')
    expect(sanitizeUrl('tel:+15551234567')).toBe('tel:+15551234567')
  })

  it('preserves values containing {{ merge }} tags', () => {
    expect(sanitizeUrl('{{unsubscribe_url}}')).toBe('{{unsubscribe_url}}')
    expect(sanitizeUrl('{{contact.website}}')).toBe('{{contact.website}}')
    expect(sanitizeUrl('https://xphere.app/u/{{contact.id}}')).toBe('https://xphere.app/u/{{contact.id}}')
    expect(sanitizeUrl('https://x.com?u={{contact.id}}')).toBe('https://x.com?u={{contact.id}}')
  })

  it('rejects a dangerous scheme even when the value contains a merge tag (bypass regression)', () => {
    expect(sanitizeUrl('javascript:alert(1)//{{contact.id}}')).toBe('')
    expect(sanitizeUrl('javascript:alert(document.cookie)//{{contact.id}}')).toBe('')
    expect(sanitizeUrl('data:text/html,{{contact.id}}')).toBe('')
    expect(sanitizeUrl('vbscript:msgbox(1)//{{contact.id}}')).toBe('')
    expect(sanitizeUrl('java\tscript:alert(1)//{{contact.id}}')).toBe('')
  })

  it('passes through relative/schemeless values', () => {
    expect(sanitizeUrl('/foo/bar')).toBe('/foo/bar')
    expect(sanitizeUrl('#anchor')).toBe('#anchor')
  })

  it('default-denies unrecognized schemes', () => {
    expect(sanitizeUrl('ftp://example.com/file')).toBe('')
    expect(sanitizeUrl('file:///etc/passwd')).toBe('')
  })

  it('handles empty/nullish input', () => {
    expect(sanitizeUrl('')).toBe('')
    expect(sanitizeUrl(null)).toBe('')
    expect(sanitizeUrl(undefined)).toBe('')
  })
})

describe('sanitizeEmailDocument', () => {
  function docWith(...columns: EmailDocument['sections'][number]['columns'][number]): EmailDocument {
    return {
      backgroundColor: '#f0f0f0',
      contentWidth: 600,
      fontFamily: 'Arial, sans-serif',
      sections: [{ id: 's1', layout: 1, columns: [columns] }],
    }
  }

  it('sanitizes text/heading content, html block content, and URL fields across the whole tree', () => {
    const doc = docWith(
      { id: 'b1', blockType: 'text', content: '<script>alert(1)</script><b>hi</b>' },
      { id: 'b2', blockType: 'heading', content: '<img src=x onerror=alert(1)>Title' },
      { id: 'b3', blockType: 'html', content: '<iframe src="evil"></iframe><p>ok</p>' },
      { id: 'b4', blockType: 'button', label: 'Go', href: 'javascript:alert(1)' },
      { id: 'b5', blockType: 'image', src: 'javascript:alert(1)', link: 'https://xphere.app' },
    )
    doc.sections[0].backgroundImage = 'javascript:alert(1)'

    const sanitized = sanitizeEmailDocument(doc)
    const [text, heading, html, button, image] = sanitized.sections[0].columns[0] as [
      TextBlock, HeadingBlock, HtmlBlock, ButtonBlock, ImageBlock,
    ]

    expect(text.content).not.toContain('<script')
    expect(text.content).toContain('<b>hi</b>')
    expect(heading.content).not.toContain('onerror')
    expect(html.content).not.toContain('<iframe')
    expect(html.content).toContain('<p>ok</p>')
    expect(button.href).toBe('')
    expect(image.src).toBe('')
    expect(image.link).toBe('https://xphere.app')
    expect(sanitized.sections[0].backgroundImage).toBe('')
  })

  it('does not mutate the input document', () => {
    const doc = docWith({ id: 'b1', blockType: 'text', content: '<script>alert(1)</script>' })
    const before = JSON.stringify(doc)
    sanitizeEmailDocument(doc)
    expect(JSON.stringify(doc)).toBe(before)
  })
})

describe('sanitizeBlocks (section-template fragment shape)', () => {
  it('sanitizes a flat block array the same way as the full document walk', () => {
    const blocks = sanitizeBlocks([
      { id: 'b1', blockType: 'text', content: '<script>alert(1)</script><i>ok</i>' },
      { id: 'b2', blockType: 'button', label: 'Go', href: 'javascript:alert(1)' },
    ])
    expect((blocks[0] as { content: string }).content).not.toContain('<script')
    expect((blocks[1] as { href: string }).href).toBe('')
  })
})

describe('validateEmailDocument', () => {
  it('rejects a non-object', () => {
    expect(validateEmailDocument(null).ok).toBe(false)
    expect(validateEmailDocument('hello').ok).toBe(false)
    expect(validateEmailDocument(42).ok).toBe(false)
    expect(validateEmailDocument([]).ok).toBe(false)
  })

  it('rejects a document with more than 50 sections', () => {
    const sections = Array.from({ length: 51 }, (_, i) => ({
      id: `s${i}`,
      layout: 1 as const,
      columns: [[]],
    }))
    const result = validateEmailDocument({ sections })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.toLowerCase()).toContain('section')
  })

  it('rejects a block with oversized content', () => {
    const oversized = 'a'.repeat(101 * 1024)
    const result = validateEmailDocument({
      sections: [
        {
          id: 's1',
          layout: 1,
          columns: [[{ id: 'b1', blockType: 'text', content: oversized }]],
        },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('rejects more than 3 columns in a section', () => {
    const result = validateEmailDocument({
      sections: [
        {
          id: 's1',
          layout: 1,
          columns: [[], [], [], []],
        },
      ],
    })
    expect(result.ok).toBe(false)
  })

  it('accepts a valid document built from BLOCK_DEFAULTS shapes', () => {
    const doc: EmailDocument = {
      backgroundColor: '#f0f0f0',
      contentWidth: 600,
      fontFamily: 'Arial, sans-serif',
      sections: [
        {
          id: makeBlockId(),
          layout: 1,
          columns: [
            Object.entries(BLOCK_DEFAULTS).map(([, def]) => ({
              ...def,
              id: makeBlockId(),
            })),
          ],
        },
      ],
    }
    const result = validateEmailDocument(doc)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.doc.sections).toHaveLength(1)
  })

  it('allows unknown extra keys to pass through (passthrough)', () => {
    const result = validateEmailDocument({
      sections: [],
      someFutureField: 'kept',
    })
    expect(result.ok).toBe(true)
    if (result.ok) expect((result.doc as Record<string, unknown>).someFutureField).toBe('kept')
  })

  it('accepts a section without layout (legacy tolerance — renderer defaults to 1)', () => {
    const result = validateEmailDocument({
      sections: [
        { id: 's1', columns: [[{ id: 'b1', blockType: 'text', content: 'hi' }]] },
      ],
    })
    expect(result.ok).toBe(true)
  })

  it('legacy document (no section/block ids) passes after normalizeDocument (publish ordering regression)', () => {
    // As stored in the DB before Phase 118: no ids anywhere.
    const legacy = {
      backgroundColor: '#f0f0f0',
      sections: [
        {
          layout: 1,
          columns: [[{ blockType: 'text', content: 'legacy' }]],
        },
      ],
    }
    // Raw legacy shape fails the schema (section id missing)...
    expect(validateEmailDocument(legacy).ok).toBe(false)
    // ...but publishTemplate normalizes first, which backfills ids in memory.
    const normalized = normalizeDocument(legacy)
    const result = validateEmailDocument(normalized)
    expect(result.ok).toBe(true)
  })
})

describe('validateSectionFragment', () => {
  it('rejects a non-object', () => {
    expect(validateSectionFragment(null).ok).toBe(false)
    expect(validateSectionFragment([]).ok).toBe(false)
  })

  it('accepts a valid { blocks } fragment built from BLOCK_DEFAULTS', () => {
    const result = validateSectionFragment({
      blocks: Object.entries(BLOCK_DEFAULTS).map(([, def]) => ({ ...def, id: makeBlockId() })),
    })
    expect(result.ok).toBe(true)
  })
})

// Phase 3 (email-builder-hardening) — the modern section-template doc shape.
// The intended pipeline is normalizeSectionTemplateDoc -> validateSectionTemplateDoc
// -> sanitizeSectionTemplateDoc, mirroring normalizeDocument -> validateEmailDocument
// -> sanitizeEmailDocument for full templates.
describe('validateSectionTemplateDoc + sanitizeSectionTemplateDoc ({ section } shape)', () => {
  it('rejects a non-object', () => {
    expect(validateSectionTemplateDoc(null).ok).toBe(false)
    expect(validateSectionTemplateDoc([]).ok).toBe(false)
  })

  it('accepts a normalized legacy { blocks } row (round-trip through normalizeSectionTemplateDoc)', () => {
    const normalized = normalizeSectionTemplateDoc({
      blocks: Object.entries(BLOCK_DEFAULTS).map(([, def]) => ({ ...def, id: makeBlockId() })),
    })
    const result = validateSectionTemplateDoc(normalized)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.doc.section.layout).toBe(1)
  })

  it('accepts a modern { section } document with full layout/background/padding', () => {
    const normalized = normalizeSectionTemplateDoc({
      section: {
        id: 's1',
        layout: 3,
        backgroundColor: '#eeeeee',
        padding: { top: 10, right: 10, bottom: 10, left: 10 },
        columns: [
          [{ id: 'b1', blockType: 'text', content: 'a' }],
          [{ id: 'b2', blockType: 'text', content: 'b' }],
          [{ id: 'b3', blockType: 'text', content: 'c' }],
        ],
      },
    })
    const result = validateSectionTemplateDoc(normalized)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.doc.section.layout).toBe(3)
      expect(result.doc.section.backgroundColor).toBe('#eeeeee')
    }
  })

  it('sanitizeSectionTemplateDoc strips dangerous content the same way sanitizeEmailDocument does', () => {
    const normalized = normalizeSectionTemplateDoc({
      section: {
        id: 's1',
        layout: 1,
        backgroundImage: 'javascript:alert(1)',
        columns: [[
          { id: 'b1', blockType: 'text', content: '<script>alert(1)</script><b>ok</b>' },
          { id: 'b2', blockType: 'button', label: 'Go', href: 'javascript:alert(1)' },
        ]],
      },
    })
    const validated = validateSectionTemplateDoc(normalized)
    expect(validated.ok).toBe(true)
    if (!validated.ok) return
    const sanitized = sanitizeSectionTemplateDoc(validated.doc)
    expect(sanitized.section.backgroundImage).toBe('')
    const [text, button] = sanitized.section.columns[0] as [TextBlock, ButtonBlock]
    expect(text.content).not.toContain('<script')
    expect(text.content).toContain('<b>ok</b>')
    expect(button.href).toBe('')
  })
})

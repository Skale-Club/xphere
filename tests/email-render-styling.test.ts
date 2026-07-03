import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  emptyDocument,
  BLOCK_DEFAULTS,
  DEFAULT_BLOCK_PADDING,
  type EmailDocument,
} from '@/lib/email/render-template'

// v3.4 Email Editor Overhaul — exercises the extended block style surface
// (per-block padding, alignment, image/button/divider options, section
// vertical-align + background image) and asserts backward compatibility.

function docWith(...columns: EmailDocument['sections'][number]['columns'][number]): EmailDocument {
  const doc = emptyDocument()
  doc.sections.push({ id: 's1', layout: 1, columns: [columns] })
  return doc
}

describe('per-block padding', () => {
  it('wraps a block in a padding div when padding is set', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'text',
      content: 'Padded',
      padding: { top: 8, right: 16, bottom: 24, left: 4 },
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('padding:8px 16px 24px 4px;')
  })

  it('applies the per-type default padding when a block omits padding', () => {
    const doc = docWith({ id: 'b1', blockType: 'text', content: 'Default spacing' })
    const { html } = renderTemplate(doc)
    // text default is { bottom: 12 } → 0 12 padding
    expect(html).toContain('padding:0px 0px 12px 0px;')
  })

  it('emits no wrapper when the resolved padding is all-zero (spacer)', () => {
    const doc = docWith({ id: 'b1', blockType: 'spacer', height: 30 })
    const { html } = renderTemplate(doc)
    expect(html).toContain('height:30px')
  })

  it('respects an explicit all-zero padding (overriding the type default)', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'text',
      content: 'Flush',
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
    })
    const { html } = renderTemplate(doc)
    // No padding wrapper around the text div
    expect(html).not.toContain('padding:0px 0px 12px 0px;')
  })
})

describe('image block', () => {
  it('honors alignment via text-align + margin', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'image',
      src: 'https://cdn.example.com/a.png',
      align: 'right',
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('https://cdn.example.com/a.png')
    expect(html).toContain('text-align:right;')
    expect(html).toContain('margin:0 0 0 auto;')
  })

  it('applies border radius when set', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'image',
      src: 'x.png',
      borderRadius: 12,
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('border-radius:12px;')
  })

  it('wraps the image in a link when link is set', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'image',
      src: 'x.png',
      link: 'https://xphere.app',
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('href="https://xphere.app"')
  })
})

describe('button block', () => {
  it('renders full-width when fullWidth is set', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'button',
      label: 'Buy',
      href: 'https://x',
      fullWidth: true,
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('display:block;')
    expect(html).toContain('width:100%;')
  })

  it('positions the button per alignment', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'button',
      label: 'Buy',
      href: 'https://x',
      align: 'left',
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('align="left"')
  })

  it('honors custom padding on the anchor', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'button',
      label: 'Buy',
      href: 'https://x',
      paddingY: 18,
      paddingX: 40,
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('padding:18px 40px;')
  })
})

describe('divider block', () => {
  it('honors width, style and align', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'divider',
      color: '#000',
      thickness: 2,
      width: 50,
      style: 'dashed',
      align: 'left',
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('border-top:2px dashed #000;')
    expect(html).toContain('width:50%;')
    expect(html).toContain('margin:0;') // left align
  })
})

describe('section styling', () => {
  it('applies vertical alignment to columns', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's1',
      layout: 1,
      verticalAlign: 'middle',
      columns: [[{ id: 'b1', blockType: 'text', content: 'x' }]],
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('valign="middle"')
  })

  it('applies a section background image', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's1',
      layout: 1,
      backgroundImage: 'https://cdn.example.com/bg.jpg',
      columns: [[{ id: 'b1', blockType: 'text', content: 'x' }]],
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain("background-image:url('https://cdn.example.com/bg.jpg')")
    expect(html).toContain('background-size:cover;')
  })

  it('applies section border radius', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's1',
      layout: 1,
      borderRadius: 16,
      columns: [[{ id: 'b1', blockType: 'text', content: 'x' }]],
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('border-radius:16px;')
  })
})

describe('defaults', () => {
  it('every block type has a default and a default padding entry', () => {
    for (const type of Object.keys(BLOCK_DEFAULTS)) {
      expect(BLOCK_DEFAULTS[type as keyof typeof BLOCK_DEFAULTS]).toBeTruthy()
      expect(DEFAULT_BLOCK_PADDING[type as keyof typeof DEFAULT_BLOCK_PADDING]).toBeTruthy()
    }
  })
})

import { describe, it, expect } from 'vitest'
import {
  renderTemplate,
  emptyDocument,
  BLOCK_DEFAULTS,
  DEFAULT_BLOCK_PADDING,
  resolveBlockPadding,
  type EmailDocument,
  type EmailBlock,
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

// Phase 3 (email-builder-hardening) — subject/preview-text are columns on
// email_templates, not document fields, so renderTemplate takes them as a
// separate `meta` argument (see actions.ts callers) rather than reading them
// off `document`.
describe('renderTemplate — subject/preheader meta', () => {
  it('emits the subject as <title> when meta.subject is provided', () => {
    const doc = emptyDocument()
    const { html } = renderTemplate(doc, { subject: 'Welcome aboard' })
    expect(html).toContain('<title>Welcome aboard</title>')
  })

  it('escapes HTML-significant characters in the subject/preview meta', () => {
    const doc = emptyDocument()
    const { html } = renderTemplate(doc, {
      subject: 'Deals <50% off> & more',
      previewText: 'A "special" offer <for you>',
    })
    expect(html).not.toContain('<50%')
    expect(html).toContain('&lt;50%')
    expect(html).toContain('&amp;')
    expect(html).toContain('&quot;special&quot;')
  })

  it('emits the preview text in a hidden preheader div, padded with the zero-width entity pattern', () => {
    const doc = emptyDocument()
    const { html } = renderTemplate(doc, { previewText: 'Your order has shipped' })
    expect(html).toContain('Your order has shipped')
    expect(html).toContain('display:none')
    expect(html).toContain('&nbsp;&zwnj;')
  })

  it('produces a well-formed (empty but present) <title> and preheader when meta is omitted', () => {
    const doc = emptyDocument()
    const { html } = renderTemplate(doc)
    expect(html).toContain('<title></title>')
    expect(html).toContain('display:none')
  })

  it('does not leak subject/preview meta into the plain-text part', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's1',
      layout: 1,
      columns: [[{ id: 'b1', blockType: 'text', content: 'Body copy' }]],
    })
    const { plainText } = renderTemplate(doc, { subject: 'Subject Line', previewText: 'Preview snippet' })
    expect(plainText).not.toContain('Subject Line')
    expect(plainText).not.toContain('Preview snippet')
    expect(plainText).toContain('Body copy')
  })
})

// ─── Phase 4 (email-builder-hardening) — full prop-surface + MSO/VML coverage ──

describe('text block — full prop surface', () => {
  it('renders fontSize, lineHeight, color, and alignment together', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'text',
      content: 'Hello world',
      fontSize: 18,
      lineHeight: 2,
      color: '#ff0000',
      align: 'right',
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('font-size:18px')
    expect(html).toContain('line-height:2')
    expect(html).toContain('color:#ff0000')
    expect(html).toContain('text-align:right')
    expect(html).toContain('Hello world')
  })
})

describe('heading block — full prop surface', () => {
  it('renders level, fontSize, color, and align as an h{level} tag', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'heading',
      content: 'Big Title',
      level: 1,
      fontSize: 40,
      color: '#123456',
      align: 'center',
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('<h1')
    expect(html).toContain('</h1>')
    expect(html).toContain('font-size:40px')
    expect(html).toContain('color:#123456')
    expect(html).toContain('text-align:center')
    expect(html).toContain('Big Title')
  })

  it.each([
    [1, 32],
    [2, 24],
    [3, 20],
  ])('falls back to the level-%i default size (%ipx) when fontSize is omitted', (level, expectedSize) => {
    const doc = docWith({ id: 'b1', blockType: 'heading', content: 'x', level: level as 1 | 2 | 3 })
    const { html } = renderTemplate(doc)
    expect(html).toContain(`<h${level}`)
    expect(html).toContain(`font-size:${expectedSize}px`)
  })
})

describe('image block — full prop surface', () => {
  it('renders width, align, borderRadius, and link together', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'image',
      src: 'https://cdn.example.com/hero.png',
      alt: 'Hero',
      width: 320,
      align: 'left',
      borderRadius: 8,
      link: 'https://xphere.app/go',
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('src="https://cdn.example.com/hero.png"')
    expect(html).toContain('alt="Hero"')
    expect(html).toContain('width="320"')
    expect(html).toContain('text-align:left;')
    expect(html).toContain('border-radius:8px;')
    expect(html).toContain('href="https://xphere.app/go"')
  })
})

describe('button block — full prop surface', () => {
  it('renders backgroundColor, textColor, borderRadius, fontSize, paddingY/X, and align together', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'button',
      label: 'Shop now',
      href: 'https://xphere.app/shop',
      backgroundColor: '#123456',
      textColor: '#fefefe',
      borderRadius: 10,
      fontSize: 20,
      paddingY: 20,
      paddingX: 50,
      align: 'right',
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('background-color:#123456;')
    expect(html).toContain('color:#fefefe;')
    expect(html).toContain('border-radius:10px;')
    expect(html).toContain('font-size:20px;')
    expect(html).toContain('padding:20px 50px;')
    expect(html).toContain('align="right"')
    expect(html).toContain('Shop now')
  })
})

describe('divider block — full prop surface', () => {
  it('renders color, thickness, style, width, and align together', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'divider',
      color: '#ff00ff',
      thickness: 5,
      style: 'dotted',
      width: 30,
      align: 'right',
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('border-top:5px dotted #ff00ff;')
    expect(html).toContain('width:30%;')
    expect(html).toContain('margin:0 0 0 auto;')
  })
})

describe('spacer block — full prop surface', () => {
  it('renders the configured height on both the block height and its line-height', () => {
    const doc = docWith({ id: 'b1', blockType: 'spacer', height: 64 })
    const { html } = renderTemplate(doc)
    expect(html).toContain('height:64px;line-height:64px;')
  })

  it('falls back to the 24px default height when omitted', () => {
    const doc = docWith({ id: 'b1', blockType: 'spacer' })
    const { html } = renderTemplate(doc)
    expect(html).toContain('height:24px;line-height:24px;')
  })
})

describe('html block — passthrough (sanitization is out of scope here, see email-sanitize.test.ts)', () => {
  it('renders the html block content verbatim', () => {
    const doc = docWith({ id: 'b1', blockType: 'html', content: '<p>Custom <strong>markup</strong></p>' })
    const { html } = renderTemplate(doc)
    expect(html).toContain('<p>Custom <strong>markup</strong></p>')
  })
})

describe('DEFAULT_BLOCK_PADDING fallbacks vs explicit padding — full type sweep', () => {
  const cases: [string, EmailBlock, string][] = [
    ['text', { id: 'b1', blockType: 'text', content: 'x' }, 'padding:0px 0px 12px 0px;'],
    ['heading', { id: 'b1', blockType: 'heading', content: 'x' }, 'padding:0px 0px 12px 0px;'],
    ['image', { id: 'b1', blockType: 'image', src: 'x.png' }, 'padding:0px 0px 12px 0px;'],
    ['button', { id: 'b1', blockType: 'button', label: 'x', href: 'https://x' }, 'padding:0px 0px 16px 0px;'],
    ['divider', { id: 'b1', blockType: 'divider' }, 'padding:16px 0px 16px 0px;'],
  ]

  it.each(cases)('%s block falls back to its DEFAULT_BLOCK_PADDING entry when padding is omitted', (_name, block, expectedDefault) => {
    const doc = docWith(block)
    const { html } = renderTemplate(doc)
    expect(html).toContain(expectedDefault)
  })

  it.each(cases)('%s block uses explicit padding instead of the default when provided', (_name, block) => {
    const doc = docWith({ ...block, padding: { top: 3, right: 3, bottom: 3, left: 3 } })
    const { html } = renderTemplate(doc)
    expect(html).toContain('padding:3px 3px 3px 3px;')
  })

  it('spacer and html blocks resolve an all-zero default padding (no wrapper div emitted)', () => {
    const spacerPadding = resolveBlockPadding({ id: 'b1', blockType: 'spacer', height: 10 })
    const htmlPadding = resolveBlockPadding({ id: 'b1', blockType: 'html', content: '<p>x</p>' })
    expect(spacerPadding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
    expect(htmlPadding).toEqual({ top: 0, right: 0, bottom: 0, left: 0 })
  })
})

describe('column layout — stacking classes and width math', () => {
  it('1-column layout still gets the col-block class for the mobile-stack media query', () => {
    const doc = docWith({ id: 'b1', blockType: 'text', content: 'Solo' })
    const { html } = renderTemplate(doc)
    expect(html).toContain('class="col-block"')
  })

  it('2-column layout emits two col-block cells at 50% width each', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's1',
      layout: 2,
      columns: [
        [{ id: 'b1', blockType: 'text', content: 'Left' }],
        [{ id: 'b2', blockType: 'text', content: 'Right' }],
      ],
    })
    const { html } = renderTemplate(doc)
    expect(html.match(/class="col-block"/g)?.length).toBe(2)
    expect(html.match(/width="50%"/g)?.length).toBe(2)
    expect(html).toContain('width:50%;')
  })

  it('3-column layout emits three col-block cells at floor(100/3)=33% width each', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's1',
      layout: 3,
      columns: [
        [{ id: 'b1', blockType: 'text', content: 'A' }],
        [{ id: 'b2', blockType: 'text', content: 'B' }],
        [{ id: 'b3', blockType: 'text', content: 'C' }],
      ],
    })
    const { html } = renderTemplate(doc)
    expect(html.match(/class="col-block"/g)?.length).toBe(3)
    expect(html.match(/width="33%"/g)?.length).toBe(3)
  })

  it('the stylesheet forces col-block to display:block !important under the mobile breakpoint (stacking)', () => {
    const { html } = renderTemplate(emptyDocument())
    expect(html).toContain('.col-block { display: block !important; width: 100% !important; }')
    expect(html).toContain('@media only screen and (max-width: 620px)')
  })
})

describe('columnsGap — half-gap padding distribution', () => {
  it('2-column: splits the gap evenly, outer edges keep only the base padding', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's1',
      layout: 2,
      columnsGap: 20,
      padding: { top: 10, right: 10, bottom: 10, left: 10 },
      columns: [
        [{ id: 'b1', blockType: 'text', content: 'Left' }],
        [{ id: 'b2', blockType: 'text', content: 'Right' }],
      ],
    })
    const { html } = renderTemplate(doc)
    // left column: outer-left stays 10, inner-right gets +halfGap(10) = 20
    expect(html).toContain('padding:10px 20px 10px 10px;')
    // right column: inner-left gets +halfGap(10) = 20, outer-right stays 10
    expect(html).toContain('padding:10px 10px 10px 20px;')
  })

  it('3-column: only interior edges receive the half-gap, outer edges do not', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's1',
      layout: 3,
      columnsGap: 12,
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      columns: [
        [{ id: 'b1', blockType: 'text', content: 'A' }],
        [{ id: 'b2', blockType: 'text', content: 'B' }],
        [{ id: 'b3', blockType: 'text', content: 'C' }],
      ],
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('padding:0px 6px 0px 0px;') // first: only right interior edge
    expect(html).toContain('padding:0px 6px 0px 6px;') // middle: both edges interior
    expect(html).toContain('padding:0px 0px 0px 6px;') // last: only left interior edge
  })

  it('columnsGap of 0 (or omitted) adds no half-gap padding', () => {
    const doc = emptyDocument()
    doc.sections.push({
      id: 's1',
      layout: 2,
      padding: { top: 5, right: 5, bottom: 5, left: 5 },
      columns: [
        [{ id: 'b1', blockType: 'text', content: 'Left' }],
        [{ id: 'b2', blockType: 'text', content: 'Right' }],
      ],
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('padding:5px 5px 5px 5px;')
  })
})

describe('escaping — subject/preview/URLs', () => {
  it('escapes double quotes in a button href to prevent attribute breakout', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'button',
      label: 'Go',
      href: 'https://x.com/?a="><script>alert(1)</script>',
    })
    const { html } = renderTemplate(doc)
    expect(html).not.toContain('"><script>')
    expect(html).toContain('&quot;')
  })

  it('escapes single quotes in an image src', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'image',
      src: "https://x.com/a'onmouseover='alert(1)",
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('&#39;')
  })

  it('escapes double quotes in an image link href', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'image',
      src: 'x.png',
      link: 'https://x.com/?a="quoted"',
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('href="https://x.com/?a=&quot;quoted&quot;"')
  })
})

describe('MSO/Outlook hardening — conditional comments + VML button fallback', () => {
  it('declares the VML and Office XML namespaces on <html>', () => {
    const { html } = renderTemplate(emptyDocument())
    expect(html).toMatch(/<html[^>]*xmlns:v="urn:schemas-microsoft-com:vml"/)
    expect(html).toMatch(/<html[^>]*xmlns:o="urn:schemas-microsoft-com:office:office"/)
  })

  it('emits the MSO OfficeDocumentSettings conditional comment in <head>', () => {
    const { html } = renderTemplate(emptyDocument())
    expect(html).toContain('<!--[if mso]>')
    expect(html).toContain('<o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings>')
    expect(html).toContain('<![endif]-->')
  })

  it('wraps a button in an [if mso] VML v:roundrect and an [if !mso] HTML anchor pair', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'button',
      label: 'Buy now',
      href: 'https://xphere.app/buy',
      backgroundColor: '#2563eb',
      borderRadius: 8,
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('<!--[if mso]>')
    expect(html).toContain('<v:roundrect')
    expect(html).toContain('xmlns:v="urn:schemas-microsoft-com:vml"')
    expect(html).toContain('fillcolor="#2563eb"')
    expect(html).toContain('strokecolor="#2563eb"')
    expect(html).toContain('href="https://xphere.app/buy"')
    expect(html).toContain('<w:anchorlock/>')
    expect(html).toContain('arcsize="')
    expect(html).toContain('</v:roundrect>')
    expect(html).toContain('<!--[if !mso]><!-->')
    expect(html).toContain('<!--<![endif]-->')
    expect(html).toContain('Buy now')
    // The HTML anchor is still present for every non-MSO client.
    expect(html).toContain('<a href="https://xphere.app/buy"')
  })

  it('derives a larger arcsize from a larger borderRadius', () => {
    const smallHtml = renderTemplate(
      docWith({ id: 'b1', blockType: 'button', label: 'X', href: 'https://x', borderRadius: 2 }),
    ).html
    const bigHtml = renderTemplate(
      docWith({ id: 'b1', blockType: 'button', label: 'X', href: 'https://x', borderRadius: 20 }),
    ).html
    const smallArcsize = Number(/arcsize="(\d+)%"/.exec(smallHtml)?.[1])
    const bigArcsize = Number(/arcsize="(\d+)%"/.exec(bigHtml)?.[1])
    expect(bigArcsize).toBeGreaterThan(smallArcsize)
  })

  it('caps arcsize at 50% even for an extreme borderRadius', () => {
    const doc = docWith({ id: 'b1', blockType: 'button', label: 'X', href: 'https://x', borderRadius: 999 })
    const { html } = renderTemplate(doc)
    const arcsize = Number(/arcsize="(\d+)%"/.exec(html)?.[1])
    expect(arcsize).toBeLessThanOrEqual(50)
  })

  it('escapes the button label and href inside the VML branch', () => {
    const doc = docWith({
      id: 'b1',
      blockType: 'button',
      label: '<b>Buy</b> "now"',
      href: 'https://x.com/?a="b',
    })
    const { html } = renderTemplate(doc)
    expect(html).not.toContain('<b>Buy</b>')
    expect(html).toContain('&lt;b&gt;Buy&lt;/b&gt;')
    expect(html).toContain('&quot;now&quot;')
  })

  it('approximates the VML width from the document contentWidth for a fullWidth button', () => {
    const doc = emptyDocument()
    doc.contentWidth = 480
    doc.sections.push({
      id: 's1',
      layout: 1,
      columns: [[{ id: 'b1', blockType: 'button', label: 'Wide', href: 'https://x', fullWidth: true }]],
    })
    const { html } = renderTemplate(doc)
    expect(html).toContain('width:480px;')
  })
})

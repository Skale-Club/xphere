import { describe, it, expect } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { renderTemplate, type EmailDocument } from '@/lib/email/render-template'

// Phase 4 (email-builder-hardening) — kitchen-sink fixture.
//
// Exercises every block type and every documented prop variant in one
// document, including 2/3-column stacking, columnsGap, section background
// color/image, section border radius, dividers, and every button style
// (default, fullWidth, custom radius/colors). This is the same document used
// to drive the manual client QA matrix — see
// .planning/workstreams/email-builder-hardening/QA-MATRIX.md.
//
// The test itself only asserts the renderer doesn't throw and that the
// expected markers show up in the HTML. Writing the rendered HTML to disk
// (for loading into an actual mail client / Litmus-style preview) is gated
// behind WRITE_KITCHEN_SINK so a normal `npx vitest run` / `npm run test`
// pass has no filesystem side effects — see QA-MATRIX.md "How to run" for
// the command that produces the file.

export function buildKitchenSinkDocument(): EmailDocument {
  return {
    backgroundColor: '#f0f0f0',
    contentWidth: 600,
    fontFamily: 'Arial, sans-serif',
    sections: [
      // 1. Heading variants (all 3 levels) + body text with custom style.
      {
        id: 's-headings',
        layout: 1,
        backgroundColor: '#ffffff',
        padding: { top: 24, right: 24, bottom: 8, left: 24 },
        columns: [
          [
            { id: 'b-h1', blockType: 'heading', content: 'Kitchen Sink Heading (H1)', level: 1, align: 'center' },
            { id: 'b-h2', blockType: 'heading', content: 'Section heading (H2)', level: 2, color: '#2563eb' },
            { id: 'b-h3', blockType: 'heading', content: 'Sub-heading (H3)', level: 3, fontSize: 18 },
            {
              id: 'b-text-1',
              blockType: 'text',
              content: 'Body copy with <strong>bold</strong> and <em>italic</em> inline formatting.',
              fontSize: 16,
              lineHeight: 1.5,
              color: '#333333',
              align: 'left',
            },
            {
              id: 'b-text-2',
              blockType: 'text',
              content: 'Right-aligned, larger, custom-colored paragraph.',
              fontSize: 20,
              color: '#dc2626',
              align: 'right',
            },
          ],
        ],
      },
      // 2. Image block: aligned, bordered, linked.
      {
        id: 's-image',
        layout: 1,
        backgroundColor: '#ffffff',
        padding: { top: 8, right: 24, bottom: 8, left: 24 },
        columns: [
          [
            {
              id: 'b-image',
              blockType: 'image',
              src: 'https://placehold.co/600x240/2563eb/ffffff?text=Kitchen+Sink',
              alt: 'Kitchen sink hero image',
              width: 480,
              align: 'center',
              borderRadius: 12,
              link: 'https://xphere.app',
            },
          ],
        ],
      },
      // 3. 2-column layout with columnsGap: text | button.
      {
        id: 's-two-col',
        layout: 2,
        backgroundColor: '#f8fafc',
        columnsGap: 20,
        padding: { top: 24, right: 24, bottom: 24, left: 24 },
        columns: [
          [
            {
              id: 'b-two-col-text',
              blockType: 'text',
              content: 'Two-column layout: left cell has body copy, right cell has a button.',
              fontSize: 15,
            },
          ],
          [
            {
              id: 'b-two-col-button',
              blockType: 'button',
              label: 'Learn more',
              href: 'https://xphere.app/learn-more',
              backgroundColor: '#111827',
              textColor: '#ffffff',
              borderRadius: 6,
              align: 'center',
            },
          ],
        ],
      },
      // 4. 3-column layout with columnsGap: three short stat blocks.
      {
        id: 's-three-col',
        layout: 3,
        backgroundColor: '#ffffff',
        columnsGap: 12,
        verticalAlign: 'middle',
        padding: { top: 16, right: 24, bottom: 16, left: 24 },
        columns: [
          [{ id: 'b-col-a', blockType: 'text', content: 'Column A', align: 'center' }],
          [{ id: 'b-col-b', blockType: 'text', content: 'Column B', align: 'center' }],
          [{ id: 'b-col-c', blockType: 'text', content: 'Column C', align: 'center' }],
        ],
      },
      // 5. Section background color + image + border radius (Outlook desktop
      //    limitation documented in render-template.ts — see renderSection).
      {
        id: 's-bg-image',
        layout: 1,
        backgroundColor: '#1e293b',
        backgroundImage: 'https://placehold.co/1200x400/1e293b/1e293b',
        borderRadius: 16,
        verticalAlign: 'middle',
        padding: { top: 40, right: 32, bottom: 40, left: 32 },
        columns: [
          [
            {
              id: 'b-bg-text',
              blockType: 'heading',
              content: 'Section with background image + radius',
              level: 2,
              color: '#ffffff',
              align: 'center',
            },
          ],
        ],
      },
      // 6. Divider variants: solid / dashed / dotted.
      {
        id: 's-dividers',
        layout: 1,
        backgroundColor: '#ffffff',
        padding: { top: 16, right: 24, bottom: 16, left: 24 },
        columns: [
          [
            { id: 'b-div-solid', blockType: 'divider', style: 'solid', color: '#000000', thickness: 1, width: 100 },
            { id: 'b-spacer-1', blockType: 'spacer', height: 16 },
            { id: 'b-div-dashed', blockType: 'divider', style: 'dashed', color: '#2563eb', thickness: 2, width: 75, align: 'left' },
            { id: 'b-spacer-2', blockType: 'spacer', height: 16 },
            { id: 'b-div-dotted', blockType: 'divider', style: 'dotted', color: '#dc2626', thickness: 3, width: 50, align: 'right' },
          ],
        ],
      },
      // 7. Button variants: default, fullWidth, custom colors/radius/fontSize.
      {
        id: 's-buttons',
        layout: 1,
        backgroundColor: '#ffffff',
        padding: { top: 16, right: 24, bottom: 16, left: 24 },
        columns: [
          [
            { id: 'b-button-default', blockType: 'button', label: 'Default button', href: 'https://xphere.app/a' },
            {
              id: 'b-button-full',
              blockType: 'button',
              label: 'Full width button',
              href: 'https://xphere.app/b',
              fullWidth: true,
              backgroundColor: '#059669',
              borderRadius: 0,
            },
            {
              id: 'b-button-pill',
              blockType: 'button',
              label: 'Pill button (big radius)',
              href: 'https://xphere.app/c',
              backgroundColor: '#7c3aed',
              textColor: '#f5f3ff',
              borderRadius: 24,
              fontSize: 18,
              paddingY: 16,
              paddingX: 32,
            },
          ],
        ],
      },
      // 8. Raw HTML escape-hatch block.
      {
        id: 's-html',
        layout: 1,
        backgroundColor: '#ffffff',
        padding: { top: 16, right: 24, bottom: 40, left: 24 },
        columns: [
          [
            {
              id: 'b-html',
              blockType: 'html',
              content: '<table role="presentation" width="100%"><tr><td style="padding:8px;background-color:#f1f5f9;">Raw HTML passthrough cell</td></tr></table>',
            },
          ],
        ],
      },
    ],
  }
}

describe('kitchen-sink fixture — renders every block type/variant without throwing', () => {
  it('renders successfully with subject/preview meta', () => {
    const doc = buildKitchenSinkDocument()
    expect(() =>
      renderTemplate(doc, {
        subject: 'Kitchen Sink QA — every block, every variant',
        previewText: 'A single template exercising the full block/prop surface for client QA.',
      }),
    ).not.toThrow()
  })

  it('includes every block type marker in the output', () => {
    const doc = buildKitchenSinkDocument()
    const { html } = renderTemplate(doc, { subject: 'QA', previewText: 'QA preview' })
    expect(html).toContain('<h1')
    expect(html).toContain('<h2')
    expect(html).toContain('<h3')
    expect(html).toContain('Kitchen sink hero image')
    expect(html).toContain('Learn more')
    expect(html).toContain('Column A')
    expect(html).toContain('border-top:1px solid #000000;')
    expect(html).toContain('border-top:2px dashed #2563eb;')
    expect(html).toContain('border-top:3px dotted #dc2626;')
    expect(html).toContain('Default button')
    expect(html).toContain('Full width button')
    expect(html).toContain('Pill button (big radius)')
    expect(html).toContain('Raw HTML passthrough cell')
  })

  it('includes MSO/VML markers for every button (three buttons -> three v:roundrect blocks)', () => {
    const doc = buildKitchenSinkDocument()
    const { html } = renderTemplate(doc, { subject: 'QA', previewText: 'QA preview' })
    // 1 two-col button + 3 in the dedicated buttons section = 4 total.
    expect(html.match(/<v:roundrect/g)?.length).toBe(4)
    expect(html.match(/<!--\[if !mso\]><!-->/g)?.length).toBe(4)
  })

  it('includes both 2-column and 3-column stacking classes', () => {
    const doc = buildKitchenSinkDocument()
    const { html } = renderTemplate(doc, { subject: 'QA', previewText: 'QA preview' })
    expect(html).toContain('width="50%"')
    expect(html).toContain('width="33%"')
  })

  it('produces a non-empty plain-text part from the text/heading/button content', () => {
    const doc = buildKitchenSinkDocument()
    const { plainText } = renderTemplate(doc, { subject: 'QA', previewText: 'QA preview' })
    expect(plainText).toContain('Kitchen Sink Heading (H1)')
    expect(plainText).toContain('Learn more (https://xphere.app/learn-more)')
  })

  // Gated write: a normal test run never touches disk. Run with
  // WRITE_KITCHEN_SINK=1 to regenerate the file used for manual client QA —
  // see QA-MATRIX.md "How to run".
  it.runIf(process.env.WRITE_KITCHEN_SINK === '1')('writes the rendered HTML to kitchen-sink.html for manual client QA', () => {
    const doc = buildKitchenSinkDocument()
    const { html } = renderTemplate(doc, {
      subject: 'Kitchen Sink QA — every block, every variant',
      previewText: 'A single template exercising the full block/prop surface for client QA.',
    })
    const outPath = resolve(__dirname, '../.planning/workstreams/email-builder-hardening/kitchen-sink.html')
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, html, 'utf-8')
  })
})

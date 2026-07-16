import { describe, it, expect } from 'vitest'
import {
  renderSignatureFragment,
  emptyDocument,
  type EmailDocument,
} from '@/lib/email/render-template'

// SIG-0 — the signature fragment renderer. A signature is a self-contained
// HTML *fragment* (no document chrome) that survives paste into Gmail/Outlook
// compose and append onto an outbound email body.

function sigDoc(...blocks: EmailDocument['sections'][number]['columns'][number]): EmailDocument {
  const doc = emptyDocument()
  doc.sections = []
  doc.sections.push({ id: 's1', layout: 1, columns: [blocks] })
  return doc
}

describe('renderSignatureFragment', () => {
  it('emits a bare fragment — no document chrome', () => {
    const { html } = renderSignatureFragment(
      sigDoc({ id: 'b1', blockType: 'text', content: 'Jane Doe' }),
    )
    expect(html).not.toContain('<!DOCTYPE')
    expect(html).not.toContain('<html')
    expect(html).not.toContain('<head')
    expect(html).not.toContain('<body')
    // No <style> block — Gmail strips it, so nothing may depend on it.
    expect(html).not.toContain('<style')
    // No hidden preheader div carried over from renderTemplate.
    expect(html).not.toContain('mso-hide:all')
  })

  it('renders the block content inside an inline-CSS table', () => {
    const { html } = renderSignatureFragment(
      sigDoc({ id: 'b1', blockType: 'text', content: 'Jane Doe' }),
    )
    expect(html).toContain('Jane Doe')
    expect(html).toContain('<table')
    expect(html).toContain('role="presentation"')
    // All-inline styling — the font-family lands on the wrapper.
    expect(html).toContain('font-family:')
  })

  it('caps the width to the document contentWidth (default 500)', () => {
    // A bare document with no contentWidth falls back to the signature default.
    const bare = renderSignatureFragment({
      sections: [{ id: 's1', layout: 1, columns: [[{ id: 'b1', blockType: 'text', content: 'x' }]] }],
    })
    expect(bare.html).toContain('max-width:500px')

    const doc = sigDoc({ id: 'b1', blockType: 'text', content: 'x' })
    doc.contentWidth = 420
    expect(renderSignatureFragment(doc).html).toContain('max-width:420px')
  })

  it('extracts a plain-text version alongside the HTML', () => {
    const { plainText } = renderSignatureFragment(
      sigDoc(
        { id: 'b1', blockType: 'heading', content: 'Jane Doe', level: 3 },
        { id: 'b2', blockType: 'text', content: 'Head of Growth' },
      ),
    )
    expect(plainText).toContain('Jane Doe')
    expect(plainText).toContain('Head of Growth')
  })

  it('preserves the per-button Outlook VML fallback', () => {
    const { html } = renderSignatureFragment(
      sigDoc({ id: 'b1', blockType: 'button', label: 'Book a call', href: 'https://example.com' }),
    )
    expect(html).toContain('v:roundrect')
    expect(html).toContain('Book a call')
  })

  it('tolerates an empty document', () => {
    const { html, plainText } = renderSignatureFragment({})
    expect(html).toContain('<table')
    expect(plainText).toBe('')
  })
})

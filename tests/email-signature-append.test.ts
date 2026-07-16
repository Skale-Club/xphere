import { describe, it, expect } from 'vitest'
import { appendSignature } from '@/lib/email/signature'

// SIG-3 — the pure append helper used by dispatch to attach a signature to an
// outbound email body. The fetch/vars helpers hit Supabase and are covered by
// integration; this locks the merge-tag + separator behavior.

describe('appendSignature', () => {
  it('appends the signature after the body with a separator', () => {
    const out = appendSignature('<p>Hi there</p>', '<span>Jane Doe</span>')
    expect(out).toBe('<p>Hi there</p><br><br><span>Jane Doe</span>')
  })

  it('resolves merge tags from the vars bag', () => {
    const out = appendSignature('<p>Body</p>', '<span>{{ contact.first_name }} @ {{ org.name }}</span>', {
      contact: { first_name: 'Ada' },
      org: { name: 'Acme' },
    })
    expect(out).toContain('Ada @ Acme')
    expect(out).not.toContain('{{')
  })

  it('never leaks unresolved tokens — missing paths become empty', () => {
    const out = appendSignature('<p>Body</p>', '<span>Hi {{ contact.first_name }}{{ contact.unknown }}</span>', {
      contact: { first_name: 'Ada' },
    })
    expect(out).toContain('Hi Ada')
    expect(out).not.toContain('{{')
    expect(out).not.toContain('unknown')
  })

  it('leaves the body untouched when the resolved signature is empty', () => {
    const base = '<p>Body</p>'
    // A signature that is nothing but a missing tag resolves to '' → no append.
    expect(appendSignature(base, '{{ contact.first_name }}', {})).toBe(base)
    expect(appendSignature(base, '   ')).toBe(base)
  })

  it('appends verbatim when no vars are provided (tags left intact)', () => {
    const out = appendSignature('<p>Body</p>', '<span>Static signature</span>')
    expect(out).toContain('Static signature')
  })
})

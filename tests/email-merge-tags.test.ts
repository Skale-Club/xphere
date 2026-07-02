import { describe, it, expect } from 'vitest'
import { renderWithVariables } from '@/lib/email/merge-tags'

describe('renderWithVariables — dot-path resolution', () => {
  it('resolves a simple contact field', () => {
    expect(
      renderWithVariables('Hi {{contact.first_name}}', { contact: { first_name: 'Ana' } }),
    ).toBe('Hi Ana')
  })

  it('resolves a nested dot path', () => {
    expect(
      renderWithVariables('{{contact.address.city}}', { contact: { address: { city: 'SP' } } }),
    ).toBe('SP')
  })

  it('resolves multiple tokens in one string', () => {
    expect(
      renderWithVariables('{{a}} and {{b}}', { a: 'x', b: 'y' }),
    ).toBe('x and y')
  })
})

describe('renderWithVariables — missing / malformed tokens', () => {
  it('replaces a missing path with an empty string (no raw {{}} left)', () => {
    const out = renderWithVariables('Hi {{contact.first_name}}', {})
    expect(out).toBe('Hi ')
    expect(out).not.toContain('{{')
  })

  it('replaces a partially-missing nested path with an empty string', () => {
    expect(
      renderWithVariables('Hi {{contact.address.city}}', { contact: {} }),
    ).toBe('Hi ')
  })

  it('leaves a malformed / non-path token intact', () => {
    expect(renderWithVariables('{{ not a path! }}', {})).toBe('{{ not a path! }}')
  })

  it('leaves an empty token intact', () => {
    expect(renderWithVariables('{{}}', {})).toBe('{{}}')
  })
})

describe('renderWithVariables — value coercion', () => {
  it('is whitespace-tolerant inside the token', () => {
    expect(
      renderWithVariables('Hi {{  contact.first_name  }}', { contact: { first_name: 'Ana' } }),
    ).toBe('Hi Ana')
  })

  it('stringifies numbers', () => {
    expect(renderWithVariables('{{count}}', { count: 3 })).toBe('3')
  })

  it('stringifies booleans', () => {
    expect(renderWithVariables('{{flag}}', { flag: true })).toBe('true')
  })

  it('JSON-stringifies object values (never [object Object])', () => {
    const out = renderWithVariables('{{obj}}', { obj: { a: 1 } })
    expect(out).toBe('{"a":1}')
    expect(out).not.toContain('[object Object]')
  })

  it('JSON-stringifies array values', () => {
    expect(renderWithVariables('{{list}}', { list: [1, 2, 3] })).toBe('[1,2,3]')
  })

  it('treats null / undefined values as empty', () => {
    expect(renderWithVariables('a{{x}}b', { x: null })).toBe('ab')
    expect(renderWithVariables('a{{y}}b', { y: undefined })).toBe('ab')
  })
})

describe('renderWithVariables — edge inputs', () => {
  it('returns an empty string unchanged', () => {
    expect(renderWithVariables('', { a: 1 })).toBe('')
  })

  it('returns a token-free string unchanged', () => {
    expect(renderWithVariables('no tokens here', {})).toBe('no tokens here')
  })
})

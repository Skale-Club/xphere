import { describe, expect, it } from 'vitest'
import { slugify } from '@/lib/agents/slug'

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('  Hello World!! ')).toBe('hello-world')
  })
  it('returns empty for empty input', () => {
    expect(slugify('')).toBe('')
  })
  it('truncates to 50 chars', () => {
    expect(slugify('A'.repeat(80))).toHaveLength(50)
  })
  it('passes through valid slug', () => {
    expect(slugify('Already-A-Slug-123')).toBe('already-a-slug-123')
  })
  it('strips leading/trailing hyphens', () => {
    expect(slugify('!!!hello!!!')).toBe('hello')
  })
})

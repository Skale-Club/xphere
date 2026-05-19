/**
 * Phase 72 — CUSTOMFIELDS-LIST-FILTERS-IO
 * Pure function smoke tests for CF-08, CF-09, CF-12, CF-13.
 */

import { describe, it, expect } from 'vitest'

// ─── CSV escaping helper (local mirror of the action's helper) ────────────────
function csvEscape(val: string): string {
  if (val.includes(',') || val.includes('"') || val.includes('\n')) {
    return `"${val.replace(/"/g, '""')}"`
  }
  return val
}

describe('CSV escape helper', () => {
  it('passes plain values through unchanged', () => {
    expect(csvEscape('hello')).toBe('hello')
    expect(csvEscape('123')).toBe('123')
  })

  it('wraps values containing commas in quotes', () => {
    expect(csvEscape('hello, world')).toBe('"hello, world"')
  })

  it('wraps values containing double-quotes and escapes them', () => {
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""')
  })

  it('wraps values containing newlines', () => {
    expect(csvEscape('line1\nline2')).toBe('"line1\nline2"')
  })
})

// ─── CF filter URL param parsing ─────────────────────────────────────────────

function parseCfFilters(sp: Record<string, string | string[] | undefined>): Record<string, string> {
  const cfFilters: Record<string, string> = {}
  for (const [key, val] of Object.entries(sp)) {
    if (key.startsWith('cff_') && typeof val === 'string' && val) {
      cfFilters[key.slice(4)] = val
    }
  }
  return cfFilters
}

describe('CF filter URL param parsing', () => {
  it('extracts cff_ prefixed params', () => {
    const sp = { q: 'test', cff_priority: 'high', cff_region: 'north', page: '1' }
    expect(parseCfFilters(sp)).toEqual({ priority: 'high', region: 'north' })
  })

  it('ignores non-cff_ params', () => {
    const sp = { q: 'hello', source: 'manual' }
    expect(parseCfFilters(sp)).toEqual({})
  })

  it('ignores empty string values', () => {
    const sp = { cff_key: '' }
    expect(parseCfFilters(sp)).toEqual({})
  })

  it('ignores array values', () => {
    const sp = { cff_key: ['a', 'b'] }
    expect(parseCfFilters(sp)).toEqual({})
  })
})

// ─── CF filter value parsing (mirrors getContacts logic) ─────────────────────

function parseCfFilterValue(rawValue: string): unknown {
  if (rawValue === 'true') return true
  if (rawValue === 'false') return false
  if (rawValue !== '' && !isNaN(Number(rawValue))) return Number(rawValue)
  return rawValue
}

describe('CF filter value parsing', () => {
  it('parses "true" as boolean true', () => {
    expect(parseCfFilterValue('true')).toBe(true)
  })

  it('parses "false" as boolean false', () => {
    expect(parseCfFilterValue('false')).toBe(false)
  })

  it('parses numeric strings as numbers', () => {
    expect(parseCfFilterValue('42')).toBe(42)
    expect(parseCfFilterValue('3.14')).toBe(3.14)
  })

  it('keeps non-numeric strings as strings', () => {
    expect(parseCfFilterValue('option_a')).toBe('option_a')
    expect(parseCfFilterValue('hello world')).toBe('hello world')
  })
})

// ─── Import CSV mapping with cf: prefix ──────────────────────────────────────

describe('CSV import cf: mapping prefix', () => {
  it('identifies cf: keys correctly', () => {
    const mapping: Record<string, string | null> = {
      Name: 'name',
      Phone: 'phone',
      Priority: 'cf:priority',
      Region: 'cf:region',
      Notes: 'notes',
      Ignored: null,
    }

    const cfKeys: string[] = []
    const baseFields: string[] = []
    for (const [, field] of Object.entries(mapping)) {
      if (!field) continue
      if (field.startsWith('cf:')) cfKeys.push(field.slice(3))
      else baseFields.push(field)
    }

    expect(cfKeys).toEqual(['priority', 'region'])
    expect(baseFields).toEqual(['name', 'phone', 'notes'])
  })
})

// ─── Dynamic grid template generation ────────────────────────────────────────

describe('Dynamic grid template for custom field columns', () => {
  it('produces base template when no visible defs', () => {
    const visibleDefs: { id: string }[] = []
    const template = `40px 2fr 1.5fr 1.2fr 1fr${visibleDefs.map(() => ' 1fr').join('')} 100px`
    expect(template).toBe('40px 2fr 1.5fr 1.2fr 1fr 100px')
  })

  it('appends one 1fr column per visible def', () => {
    const visibleDefs = [{ id: 'a' }, { id: 'b' }]
    const template = `40px 2fr 1.5fr 1.2fr 1fr${visibleDefs.map(() => ' 1fr').join('')} 100px`
    expect(template).toBe('40px 2fr 1.5fr 1.2fr 1fr 1fr 1fr 100px')
  })
})

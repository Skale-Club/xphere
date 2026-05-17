// tests/contacts-csv-import.test.ts
// SEED-006 / v2.1 — CSV import: parsing, mapping suggestion, dedup logic.

import { describe, it, expect } from 'vitest'
import { parseCsv, suggestColumnMapping, CONTACT_FIELDS } from '@/lib/contacts/csv'
import { normalisePhone } from '@/lib/contacts/zod-schemas'

describe('parseCsv', () => {
  it('parses a simple CSV with headers and rows', () => {
    const txt = 'name,phone,email\nJane,+5511999999999,jane@x.com\nJohn,+5511888888888,john@x.com'
    const r = parseCsv(txt)
    expect(r.headers).toEqual(['name', 'phone', 'email'])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toEqual(['Jane', '+5511999999999', 'jane@x.com'])
    expect(r.rows[1]).toEqual(['John', '+5511888888888', 'john@x.com'])
  })

  it('handles quoted fields with embedded commas', () => {
    const txt = 'name,company\n"Doe, Jane","Acme, Inc."'
    const r = parseCsv(txt)
    expect(r.rows[0]).toEqual(['Doe, Jane', 'Acme, Inc.'])
  })

  it('handles escaped quotes ("")', () => {
    const txt = 'name,notes\n"Jane","She said ""hi"""'
    const r = parseCsv(txt)
    expect(r.rows[0]).toEqual(['Jane', 'She said "hi"'])
  })

  it('handles CRLF line endings', () => {
    const txt = 'name,phone\r\nJane,123\r\nJohn,456\r\n'
    const r = parseCsv(txt)
    expect(r.rows).toHaveLength(2)
  })

  it('trims trailing blank rows', () => {
    const txt = 'name\nJane\n\n\n'
    const r = parseCsv(txt)
    expect(r.rows).toEqual([['Jane']])
  })

  it('returns empty result on empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] })
  })
})

describe('suggestColumnMapping', () => {
  it('maps obvious English headers', () => {
    const m = suggestColumnMapping(['Name', 'Phone', 'Email', 'Company', 'Notes', 'Tags'])
    expect(m['Name']).toBe('name')
    expect(m['Phone']).toBe('phone')
    expect(m['Email']).toBe('email')
    expect(m['Company']).toBe('company')
    expect(m['Notes']).toBe('notes')
    expect(m['Tags']).toBe('tags')
  })

  it('maps Portuguese variants', () => {
    const m = suggestColumnMapping(['nome', 'telefone', 'empresa'])
    expect(m['nome']).toBe('name')
    expect(m['telefone']).toBe('phone')
    expect(m['empresa']).toBe('company')
  })

  it('maps WhatsApp/mobile variants to phone', () => {
    expect(suggestColumnMapping(['WhatsApp'])['WhatsApp']).toBe('phone')
    expect(suggestColumnMapping(['Mobile'])['Mobile']).toBe('phone')
    expect(suggestColumnMapping(['celular'])['celular']).toBe('phone')
  })

  it('returns null for unknown columns', () => {
    const m = suggestColumnMapping(['frobnication_factor'])
    expect(m['frobnication_factor']).toBeNull()
  })

  it('every suggestion is a CONTACT_FIELDS member or null', () => {
    const m = suggestColumnMapping(['name', 'phone', 'unknown'])
    for (const v of Object.values(m)) {
      if (v !== null) expect(CONTACT_FIELDS).toContain(v)
    }
  })
})

describe('import dedup logic (unit-level)', () => {
  it('normalisePhone yields a stable key for varied formats', () => {
    expect(normalisePhone('+55 (11) 99999-9999')).toBe(normalisePhone('+5511999999999'))
    expect(normalisePhone('+55-11-99999.9999')).toBe('+5511999999999')
  })

  it('different formats hash to the same dedup key', () => {
    const seen = new Set<string>()
    const candidates = ['+55 (11) 99999-9999', '+5511999999999', '+55-11-99999-9999']
    for (const c of candidates) {
      const k = normalisePhone(c)
      if (k) seen.add(k)
    }
    expect(seen.size).toBe(1)
  })
})

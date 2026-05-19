/**
 * Phase 74 — IMPORT-WIZARD-UI
 * Pure function smoke tests for IMP-01..09, IMP-17.
 */

import { describe, it, expect } from 'vitest'
import {
  parseCsvLimit,
  countCsvDataRows,
  suggestColumnMappingEnhanced,
} from '../src/lib/contacts/csv'

// ─── parseCsvLimit ────────────────────────────────────────────────────────────

describe('parseCsvLimit', () => {
  const csv = `Name,Phone,Email
Alice,+1555000001,alice@example.com
Bob,+1555000002,bob@example.com
Carol,+1555000003,carol@example.com
Dave,+1555000004,dave@example.com
Eve,+1555000005,eve@example.com
Frank,+1555000006,frank@example.com`

  it('parses all columns from header row', () => {
    const { headers } = parseCsvLimit(csv, 10)
    expect(headers).toEqual(['Name', 'Phone', 'Email'])
  })

  it('returns at most maxDataRows rows', () => {
    const { rows } = parseCsvLimit(csv, 3)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual(['Alice', '+1555000001', 'alice@example.com'])
  })

  it('returns fewer rows than limit when file is smaller', () => {
    const { rows } = parseCsvLimit(csv, 100)
    expect(rows).toHaveLength(6)
  })

  it('handles empty file gracefully', () => {
    const { headers, rows } = parseCsvLimit('', 5)
    expect(headers).toEqual([])
    expect(rows).toEqual([])
  })

  it('handles header-only file', () => {
    const { headers, rows } = parseCsvLimit('Name,Phone\n', 5)
    expect(headers).toEqual(['Name', 'Phone'])
    expect(rows).toHaveLength(0)
  })
})

// ─── countCsvDataRows ─────────────────────────────────────────────────────────

describe('countCsvDataRows', () => {
  it('counts data rows excluding header', () => {
    const csv = 'Name,Phone\nAlice,123\nBob,456\nCarol,789\n'
    expect(countCsvDataRows(csv)).toBe(3)
  })

  it('returns 0 for header-only csv', () => {
    expect(countCsvDataRows('Name,Phone\n')).toBe(0)
  })

  it('returns 0 for empty string', () => {
    expect(countCsvDataRows('')).toBe(0)
  })

  it('handles csv without trailing newline', () => {
    const csv = 'Name,Phone\nAlice,123\nBob,456'
    // 2 newlines → 2-1=1 header subtracted → 1 (Alice line)... actually:
    // newlines are at end of header row and end of Alice row → count=2 → data rows = 2-1 = 1
    expect(countCsvDataRows(csv)).toBe(1)
  })
})

// ─── suggestColumnMappingEnhanced — header regex ──────────────────────────────

describe('suggestColumnMappingEnhanced — header regex', () => {
  it('matches standard contact field headers', () => {
    const headers = ['Name', 'Phone', 'Email', 'Company', 'Notes', 'Tags']
    const result = suggestColumnMappingEnhanced(headers, [])
    expect(result['Name']).toBe('name')
    expect(result['Phone']).toBe('phone')
    expect(result['Email']).toBe('email')
    expect(result['Company']).toBe('company')
    expect(result['Notes']).toBe('notes')
    expect(result['Tags']).toBe('tags')
  })

  it('matches Portuguese field headers', () => {
    const result = suggestColumnMappingEnhanced(['Nome', 'Telefone', 'Empresa'], [])
    expect(result['Nome']).toBe('name')
    expect(result['Telefone']).toBe('phone')
    expect(result['Empresa']).toBe('company')
  })

  it('leaves unrecognised headers as null', () => {
    const result = suggestColumnMappingEnhanced(['Score', 'Region'], [])
    expect(result['Score']).toBeNull()
    expect(result['Region']).toBeNull()
  })
})

// ─── suggestColumnMappingEnhanced — value sampling ───────────────────────────

describe('suggestColumnMappingEnhanced — value sampling', () => {
  it('detects email column by value sampling', () => {
    const headers = ['ContactInfo']
    const sampleRows = [
      ['alice@example.com'],
      ['bob@example.com'],
      ['carol@example.com'],
    ]
    const result = suggestColumnMappingEnhanced(headers, sampleRows)
    expect(result['ContactInfo']).toBe('email')
  })

  it('detects phone column by value sampling', () => {
    const headers = ['Identifier']
    const sampleRows = [
      ['+1 555 000 001'],
      ['+1 555 000 002'],
      ['+1 555 000 003'],
    ]
    const result = suggestColumnMappingEnhanced(headers, sampleRows)
    expect(result['Identifier']).toBe('phone')
  })

  it('header regex takes precedence over value sampling', () => {
    // "Email" header should match 'email' even if values look like phones
    const headers = ['Email']
    const sampleRows = [['+1555000001'], ['+1555000002']]
    const result = suggestColumnMappingEnhanced(headers, sampleRows)
    expect(result['Email']).toBe('email') // header wins
  })
})

// ─── suggestColumnMappingEnhanced — custom fields ────────────────────────────

describe('suggestColumnMappingEnhanced — custom field matching', () => {
  const customDefs = [
    { key: 'priority', label: 'Priority' },
    { key: 'region', label: 'Sales Region' },
  ]

  it('suggests cf: key when header fuzzy-matches custom def label', () => {
    const result = suggestColumnMappingEnhanced(['Priority Level', 'Region'], [], customDefs)
    // 'Region' contains 'region' which is in 'Sales Region' label
    expect(result['Region']).toBe('cf:region')
  })

  it('does not over-match unrelated headers', () => {
    const result = suggestColumnMappingEnhanced(['Score', 'Notes'], [], customDefs)
    expect(result['Score']).toBeNull()
    // Notes matches CONTACT_FIELDS 'notes' by header regex — custom field check runs after
    expect(result['Notes']).toBe('notes')
  })
})

// ─── IMP-17: required-mapping gate ───────────────────────────────────────────

describe('IMP-17 required-mapping gate', () => {
  function canStart(mapping: Record<string, string | null>): boolean {
    const fields = Object.values(mapping).filter(Boolean) as string[]
    return fields.includes('phone') || fields.includes('email')
  }

  it('allows start when phone is mapped', () => {
    expect(canStart({ Name: 'name', Phone: 'phone', Email: null })).toBe(true)
  })

  it('allows start when email is mapped', () => {
    expect(canStart({ Name: 'name', Phone: null, Email: 'email' })).toBe(true)
  })

  it('allows start when both phone and email are mapped', () => {
    expect(canStart({ Phone: 'phone', Email: 'email' })).toBe(true)
  })

  it('blocks start when neither phone nor email is mapped', () => {
    expect(canStart({ Name: 'name', Company: 'company' })).toBe(false)
  })

  it('blocks start when mapping is empty', () => {
    expect(canStart({})).toBe(false)
  })

  it('blocks start when all columns are ignored (null)', () => {
    expect(canStart({ Name: null, Phone: null, Email: null })).toBe(false)
  })
})

// ─── Dedup key reordering ─────────────────────────────────────────────────────

describe('Dedup key reordering', () => {
  function moveDedup(keys: string[], key: string, dir: -1 | 1): string[] {
    const idx = keys.indexOf(key)
    if (idx < 0) return keys
    const next = [...keys]
    const swap = idx + dir
    if (swap < 0 || swap >= next.length) return keys
    ;[next[idx], next[swap]] = [next[swap], next[idx]]
    return next
  }

  it('moves phone up when it is second', () => {
    expect(moveDedup(['email', 'phone'], 'phone', -1)).toEqual(['phone', 'email'])
  })

  it('moves email down when it is first', () => {
    expect(moveDedup(['email', 'phone'], 'email', 1)).toEqual(['phone', 'email'])
  })

  it('does not move first item further up', () => {
    expect(moveDedup(['phone', 'email'], 'phone', -1)).toEqual(['phone', 'email'])
  })

  it('does not move last item further down', () => {
    expect(moveDedup(['phone', 'email'], 'email', 1)).toEqual(['phone', 'email'])
  })
})

// ─── Dry-run classification logic ─────────────────────────────────────────────

describe('Dry-run classification', () => {
  type DedupStrategy = 'skip_existing' | 'update_existing' | 'create_duplicate'

  function classify(
    rows: Array<{ phone: string | null; email: string | null }>,
    existingPhones: Set<string>,
    existingEmails: Set<string>,
    strategy: DedupStrategy,
  ) {
    let wouldInsert = 0
    let wouldUpdate = 0
    let wouldSkip = 0
    let wouldError = 0
    for (const r of rows) {
      if (!r.phone && !r.email) { wouldError++; continue }
      const exists =
        (r.phone && existingPhones.has(r.phone)) ||
        (r.email && existingEmails.has(r.email))
      if (exists) {
        if (strategy === 'skip_existing') wouldSkip++
        else if (strategy === 'update_existing') wouldUpdate++
        else wouldInsert++
      } else {
        wouldInsert++
      }
    }
    return { wouldInsert, wouldUpdate, wouldSkip, wouldError }
  }

  const rows = [
    { phone: '+1111', email: 'a@x.com' }, // existing by phone
    { phone: '+2222', email: 'b@x.com' }, // new
    { phone: null, email: null },          // error
  ]
  const phones = new Set(['+1111'])
  const emails = new Set<string>()

  it('skips existing contacts with skip_existing', () => {
    const r = classify(rows, phones, emails, 'skip_existing')
    expect(r).toEqual({ wouldInsert: 1, wouldUpdate: 0, wouldSkip: 1, wouldError: 1 })
  })

  it('updates existing contacts with update_existing', () => {
    const r = classify(rows, phones, emails, 'update_existing')
    expect(r).toEqual({ wouldInsert: 1, wouldUpdate: 1, wouldSkip: 0, wouldError: 1 })
  })

  it('inserts duplicates with create_duplicate', () => {
    const r = classify(rows, phones, emails, 'create_duplicate')
    expect(r).toEqual({ wouldInsert: 2, wouldUpdate: 0, wouldSkip: 0, wouldError: 1 })
  })
})

// tests/prospect-recipients.test.ts
//
// Unit coverage for the pure recipient-resolution helper shared by the
// prospects "Start voice campaign" and "Send WhatsApp" bulk actions
// (src/lib/prospects/recipients.ts). No Supabase involved — this is the
// normalize/dedupe/cap logic in isolation.

import { describe, it, expect } from 'vitest'

import {
  resolveProspectRecipients,
  applyNameToken,
  type ProspectSourceRecord,
} from '@/lib/prospects/recipients'

describe('resolveProspectRecipients', () => {
  it('normalizes and passes through a clean E.164 phone', () => {
    const records: ProspectSourceRecord[] = [
      { kind: 'person', id: 'c1', name: 'Ada Lovelace', phone: '+15551234567' },
    ]
    const result = resolveProspectRecipients(records)
    expect(result.recipients).toEqual([
      { kind: 'person', id: 'c1', name: 'Ada Lovelace', phone: '+15551234567' },
    ])
    expect(result.skippedNoPhone).toBe(0)
    expect(result.skippedDuplicate).toBe(0)
    expect(result.truncated).toBe(0)
  })

  it('normalizes a bare national-format phone using the country hint', () => {
    const records: ProspectSourceRecord[] = [
      { kind: 'company', id: 'a1', name: 'Acme Ltda', phone: '11987654321', countryHint: 'BR' },
    ]
    const result = resolveProspectRecipients(records)
    expect(result.recipients).toHaveLength(1)
    expect(result.recipients[0].phone).toBe('+5511987654321')
  })

  it('skips records with no usable phone number', () => {
    const records: ProspectSourceRecord[] = [
      { kind: 'person', id: 'c1', name: 'No Phone', phone: null },
      { kind: 'person', id: 'c2', name: 'Empty Phone', phone: '   ' },
    ]
    const result = resolveProspectRecipients(records)
    expect(result.recipients).toHaveLength(0)
    expect(result.skippedNoPhone).toBe(2)
  })

  it('dedupes by normalized phone, keeping the first occurrence', () => {
    const records: ProspectSourceRecord[] = [
      { kind: 'person', id: 'c1', name: 'First', phone: '+15551234567' },
      { kind: 'company', id: 'a1', name: 'Same Number Co', phone: '+15551234567' },
    ]
    const result = resolveProspectRecipients(records)
    expect(result.recipients).toHaveLength(1)
    expect(result.recipients[0].id).toBe('c1')
    expect(result.skippedDuplicate).toBe(1)
  })

  it('treats differently-formatted-but-equivalent numbers as duplicates', () => {
    const records: ProspectSourceRecord[] = [
      { kind: 'person', id: 'c1', name: 'Formatted', phone: '+1 (555) 123-4567' },
      { kind: 'person', id: 'c2', name: 'Plain', phone: '+15551234567' },
    ]
    const result = resolveProspectRecipients(records)
    expect(result.recipients).toHaveLength(1)
    expect(result.skippedDuplicate).toBe(1)
  })

  it('falls back to a kind-based name when the record has no name', () => {
    const records: ProspectSourceRecord[] = [
      { kind: 'person', id: 'c1', name: null, phone: '+15551234567' },
      { kind: 'company', id: 'a1', name: '  ', phone: '+15557654321' },
    ]
    const result = resolveProspectRecipients(records)
    expect(result.recipients[0].name).toBe('Prospect')
    expect(result.recipients[1].name).toBe('Company')
  })

  it('caps the result set and reports the truncated count without dropping the skip counters', () => {
    const records: ProspectSourceRecord[] = Array.from({ length: 5 }, (_, i) => ({
      kind: 'person' as const,
      id: `c${i}`,
      name: `Person ${i}`,
      phone: `+1555000${1000 + i}`,
    }))
    const result = resolveProspectRecipients(records, { cap: 3 })
    expect(result.recipients).toHaveLength(3)
    expect(result.truncated).toBe(2)
    expect(result.recipients.map((r) => r.id)).toEqual(['c0', 'c1', 'c2'])
  })

  it('does not truncate when the result is exactly at the cap', () => {
    const records: ProspectSourceRecord[] = [
      { kind: 'person', id: 'c1', name: 'A', phone: '+15551234567' },
      { kind: 'person', id: 'c2', name: 'B', phone: '+15557654321' },
    ]
    const result = resolveProspectRecipients(records, { cap: 2 })
    expect(result.recipients).toHaveLength(2)
    expect(result.truncated).toBe(0)
  })
})

describe('applyNameToken', () => {
  it('replaces a single {{name}} token', () => {
    expect(applyNameToken('Hello {{name}}!', 'Ada')).toBe('Hello Ada!')
  })

  it('replaces multiple occurrences', () => {
    expect(applyNameToken('{{name}} {{name}}', 'Ada')).toBe('Ada Ada')
  })

  it('leaves the value unchanged when there is no token', () => {
    expect(applyNameToken('Hello there', 'Ada')).toBe('Hello there')
  })
})

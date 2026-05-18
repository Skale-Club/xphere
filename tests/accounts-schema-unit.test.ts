// tests/accounts-schema-unit.test.ts
// Phase 65 Plan 05 — pure-function unit tests for @/lib/accounts.
//
// No DB. Tests zod schemas, normalisers, and CSV heuristics from Plan 65-01
// and Plan 65-04 Task 1. Soft-skip semantics are unnecessary here — these
// run in every environment.

import { describe, it, expect } from 'vitest'
import {
  accountSchema,
  accountListFiltersSchema,
  mergeAccountsSchema,
  linkContactToAccountSchema,
  normaliseDomain,
  normaliseAccountInput,
  ACCOUNT_SIZES,
  ACCOUNT_SOURCES,
} from '@/lib/accounts'
import {
  parseCsv,
  suggestAccountColumnMapping,
  ACCOUNT_CSV_FIELDS,
} from '@/lib/accounts/csv'

describe('accountSchema', () => {
  it('rejects empty payload', () => {
    expect(accountSchema.safeParse({}).success).toBe(false)
  })
  it("rejects empty name ('')", () => {
    expect(accountSchema.safeParse({ name: '' }).success).toBe(false)
  })
  it('rejects whitespace-only name', () => {
    expect(accountSchema.safeParse({ name: '   ' }).success).toBe(false)
  })
  it("accepts { name: 'Acme' } with defaults applied", () => {
    const r = accountSchema.safeParse({ name: 'Acme' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.name).toBe('Acme')
      expect(r.data.tags).toEqual([])
      expect(r.data.source).toBe('manual')
      expect(r.data.custom_fields).toEqual({})
    }
  })
  it('accepts a full payload with all attributes', () => {
    const full = {
      name: 'Acme Inc',
      domain: 'acme.com',
      website: 'https://acme.com',
      industry: 'SaaS',
      size: '51-200',
      phone: '+1 555-0100',
      address: '1 Market St',
      notes: 'enterprise',
      tags: ['vip', 'q4-target'],
      custom_fields: { tier: 'gold' },
      external_id: 'ghl-123',
      source: 'manual' as const,
      assigned_to: '00000000-0000-0000-0000-000000000001',
    }
    expect(accountSchema.safeParse(full).success).toBe(true)
  })
  it('rejects 51+ tags', () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `tag${i}`)
    expect(accountSchema.safeParse({ name: 'A', tags: tooMany }).success).toBe(false)
  })
})

describe('accountListFiltersSchema', () => {
  it('applies defaults', () => {
    const r = accountListFiltersSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.page).toBe(1)
      expect(r.data.pageSize).toBe(25)
      expect(r.data.sort).toBe('name')
    }
  })
  it('rejects pageSize > 100', () => {
    expect(accountListFiltersSchema.safeParse({ pageSize: 101 }).success).toBe(false)
  })
  it('accepts all optional filters together', () => {
    const r = accountListFiltersSchema.safeParse({
      q: 'acme',
      industry: 'SaaS',
      size: '51-200',
      tag: 'vip',
      assignedTo: '00000000-0000-0000-0000-000000000001',
      source: 'csv_import',
      sort: 'recent',
      page: 2,
      pageSize: 50,
    })
    expect(r.success).toBe(true)
  })
})

describe('mergeAccountsSchema', () => {
  const ID1 = '00000000-0000-0000-0000-000000000001'
  const ID2 = '00000000-0000-0000-0000-000000000002'
  const ID3 = '00000000-0000-0000-0000-000000000003'
  it('rejects empty secondaryIds', () => {
    expect(
      mergeAccountsSchema.safeParse({ primaryId: ID1, secondaryIds: [] }).success,
    ).toBe(false)
  })
  it('rejects when primaryId appears in secondaryIds', () => {
    expect(
      mergeAccountsSchema.safeParse({ primaryId: ID1, secondaryIds: [ID2, ID1] })
        .success,
    ).toBe(false)
  })
  it('accepts a valid merge input', () => {
    expect(
      mergeAccountsSchema.safeParse({ primaryId: ID1, secondaryIds: [ID2, ID3] })
        .success,
    ).toBe(true)
  })
})

describe('linkContactToAccountSchema', () => {
  it('requires valid uuids for both fields', () => {
    expect(
      linkContactToAccountSchema.safeParse({
        contactId: 'not-a-uuid',
        accountId: '00000000-0000-0000-0000-000000000001',
      }).success,
    ).toBe(false)
  })
})

describe('normaliseDomain', () => {
  it.each([
    ['https://Acme.COM/', 'acme.com'],
    ['http://www.acme.com', 'www.acme.com'], // intentional: do NOT strip www in v1
    ['Acme.COM', 'acme.com'],
    ['acme.com/', 'acme.com'],
    ['acme.com', 'acme.com'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normaliseDomain(input)).toBe(expected)
  })
  it('returns null for empty/blank input', () => {
    expect(normaliseDomain(null)).toBeNull()
    expect(normaliseDomain(undefined)).toBeNull()
    expect(normaliseDomain('')).toBeNull()
    expect(normaliseDomain('   ')).toBeNull()
  })
})

describe('normaliseAccountInput', () => {
  it('blank strings become null, defaults applied', () => {
    const out = normaliseAccountInput({
      name: '  Acme  ',
      domain: '  https://Acme.COM/  ',
      website: '',
      industry: '   ',
      // size, phone, address, notes intentionally omitted
    })
    expect(out.name).toBe('Acme')
    expect(out.domain).toBe('acme.com')
    expect(out.website).toBeNull()
    expect(out.industry).toBeNull()
    expect(out.tags).toEqual([])
    expect(out.custom_fields).toEqual({})
    expect(out.source).toBe('manual')
    expect(out.assigned_to).toBeNull()
  })
})

describe('ACCOUNT_SIZES + ACCOUNT_SOURCES exports', () => {
  it('ACCOUNT_SIZES tuple is the 5 documented buckets', () => {
    expect([...ACCOUNT_SIZES]).toEqual(['1-10', '11-50', '51-200', '201-1000', '1000+'])
  })
  it('ACCOUNT_SOURCES matches the DB CHECK list', () => {
    expect([...ACCOUNT_SOURCES]).toEqual([
      'manual',
      'auto_from_contact_company',
      'csv_import',
      'ghl_sync',
    ])
  })
})

describe('suggestAccountColumnMapping', () => {
  it('maps obvious English headers', () => {
    const m = suggestAccountColumnMapping([
      'Name',
      'Domain',
      'Website',
      'Industry',
      'Size',
      'Phone',
      'Address',
      'Notes',
      'Tags',
    ])
    expect(m['Name']).toBe('name')
    expect(m['Domain']).toBe('domain')
    expect(m['Website']).toBe('website')
    expect(m['Industry']).toBe('industry')
    expect(m['Size']).toBe('size')
    expect(m['Phone']).toBe('phone')
    expect(m['Address']).toBe('address')
    expect(m['Notes']).toBe('notes')
    expect(m['Tags']).toBe('tags')
  })
  it('maps PT-BR variants', () => {
    const m = suggestAccountColumnMapping(['empresa', 'dominio', 'setor', 'telefone'])
    expect(m['empresa']).toBe('name')
    expect(m['dominio']).toBe('domain')
    expect(m['setor']).toBe('industry')
    expect(m['telefone']).toBe('phone')
  })
  it('maps Company / Company Name / Account Name to name', () => {
    expect(suggestAccountColumnMapping(['Company'])['Company']).toBe('name')
    expect(suggestAccountColumnMapping(['Company Name'])['Company Name']).toBe('name')
    expect(suggestAccountColumnMapping(['Account Name'])['Account Name']).toBe('name')
  })
  it('returns null for unknown headers', () => {
    expect(
      suggestAccountColumnMapping(['frobnication_factor'])['frobnication_factor'],
    ).toBeNull()
  })
  it('every suggestion is an ACCOUNT_CSV_FIELDS member or null', () => {
    const m = suggestAccountColumnMapping(['Name', 'Phone', 'Unknown'])
    for (const v of Object.values(m)) {
      if (v !== null) expect(ACCOUNT_CSV_FIELDS).toContain(v)
    }
  })
})

describe('parseCsv re-export from @/lib/accounts/csv', () => {
  it('round-trips a simple CSV', () => {
    const txt = 'name,domain\nAcme,acme.com\nBeta Co,beta.io'
    const r = parseCsv(txt)
    expect(r.headers).toEqual(['name', 'domain'])
    expect(r.rows).toHaveLength(2)
    expect(r.rows[0]).toEqual(['Acme', 'acme.com'])
  })
})

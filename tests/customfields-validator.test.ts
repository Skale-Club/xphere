// tests/customfields-validator.test.ts
// Phase 69 Plan 03 — unit tests for validate.ts and serialize.ts
//
// Covers six behavioral axes (CF-07 + CF-15):
//   1. Unknown key rejection
//   2. Required enforcement
//   3. Type validation (number, boolean, date, currency)
//   4. Currency round-trip via parseCurrencyValue (CF-15)
//   5. unique_per_org — mocked DB returns existing row
//   6. normalizeCustomFieldValues — pure serializer behavior
//
// No live DB required: Supabase client is mocked via vi.mock.

// ─── Mock declarations (hoisted by Vitest — must come before imports) ─────────

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

// ─── Imports ──────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createClient } from '@/lib/supabase/server'
import { validateCustomFields } from '@/lib/custom-fields/validate'
import { parseCurrencyValue, normalizeCustomFieldValues } from '@/lib/custom-fields/serialize'
import { FIELD_RENDER_CONFIG } from '@/lib/custom-fields/render-config'

// ─── Types ───────────────────────────────────────────────────────────────────

interface DefinitionRow {
  id: string
  org_id: string
  entity: 'contact' | 'opportunity' | 'account'
  key: string
  label: string
  type: string
  required: boolean
  unique_per_org: boolean
  archived: boolean
  options: unknown
  validation: unknown
}

// ─── Fixtures ────────────────────────────────────────────────────────────────

function makeDefinition(overrides: Partial<DefinitionRow> = {}): DefinitionRow {
  return {
    id: 'def-1',
    org_id: 'org-1',
    entity: 'contact',
    key: 'score',
    label: 'Score',
    type: 'number',
    required: false,
    unique_per_org: false,
    archived: false,
    options: null,
    validation: null,
    ...overrides,
  }
}

// ─── Mock builder ────────────────────────────────────────────────────────────
//
// buildMockSupabase creates a chainable Supabase-like client mock.
// It intercepts two query chains used by validateCustomFields:
//
//   1. .from('custom_field_definitions').select(...).eq(...).eq(...).eq(...)
//      → { data: definitions, error: null }
//
//   2. .from('contacts' | 'opportunities' | 'accounts').select('id').filter(...).limit(1)
//      → { data: uniqueCheckResult, error: null }

function buildMockSupabase(
  definitions: DefinitionRow[],
  uniqueCheckResult: unknown[] = [],
) {
  const entityTables = new Set(['contacts', 'opportunities', 'accounts'])

  const makeChain = (resolveWith: unknown) => {
    const chain: Record<string, unknown> = {}
    const methods = ['select', 'eq', 'filter', 'limit', 'order', 'single', 'maybeSingle', 'insert', 'update', 'delete', 'in', 'or', 'ilike', 'contains', 'range']
    for (const m of methods) {
      chain[m] = vi.fn(() => chain)
    }
    // Make it thenable so `await supabase.from(...).select(...).eq(...)` resolves
    chain['then'] = (resolve: (v: unknown) => void) =>
      Promise.resolve(resolveWith).then(resolve)
    return chain
  }

  return {
    from: vi.fn((table: string) => {
      if (table === 'custom_field_definitions') {
        return makeChain({ data: definitions, error: null })
      }
      if (entityTables.has(table)) {
        return makeChain({ data: uniqueCheckResult, error: null })
      }
      return makeChain({ data: null, error: null })
    }),
  }
}

// ─── Test suites ─────────────────────────────────────────────────────────────

describe('validateCustomFields — unknown key rejection', () => {
  beforeEach(() => {
    vi.mocked(createClient).mockResolvedValue(
      buildMockSupabase([]) as any,
    )
  })

  it('rejects a single unknown key when definitions are empty', async () => {
    const result = await validateCustomFields('org-1', 'contact', { unknown_key: 'x' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toEqual({ field: 'unknown_key', message: 'unknown_custom_field' })
    }
  })

  it('rejects only the unknown key when payload has a mix of known and unknown keys', async () => {
    const defs = [makeDefinition({ key: 'known', type: 'text', required: false })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', {
      known: 'hi',
      unknown_key: 'x',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      const unknownErrors = result.errors.filter((e) => e.message === 'unknown_custom_field')
      expect(unknownErrors).toHaveLength(1)
      expect(unknownErrors[0].field).toBe('unknown_key')
      // 'known' should not produce an unknown error
      expect(result.errors.some((e) => e.field === 'known')).toBe(false)
    }
  })

  it('accepts an empty payload with no definitions — { ok: true }', async () => {
    const result = await validateCustomFields('org-1', 'contact', {})
    expect(result.ok).toBe(true)
  })
})

describe('validateCustomFields — required enforcement', () => {
  it('returns required error when required field is absent from payload', async () => {
    const defs = [makeDefinition({ key: 'nps_score', type: 'number', required: true })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toEqual({ field: 'nps_score', message: 'required' })
    }
  })

  it('returns { ok: true } when required field is present with a value', async () => {
    const defs = [makeDefinition({ key: 'nps_score', type: 'number', required: true })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', { nps_score: 42 })
    expect(result.ok).toBe(true)
  })

  it('returns { ok: true } when optional field is absent — no required error', async () => {
    const defs = [makeDefinition({ key: 'nps_score', type: 'number', required: false })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', {})
    expect(result.ok).toBe(true)
  })

  it('collects multiple errors when multiple required fields are absent', async () => {
    const defs = [
      makeDefinition({ id: 'def-1', key: 'field_a', type: 'text', required: true }),
      makeDefinition({ id: 'def-2', key: 'field_b', type: 'number', required: true }),
    ]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', {})
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThanOrEqual(2)
      const fields = result.errors.map((e) => e.field)
      expect(fields).toContain('field_a')
      expect(fields).toContain('field_b')
    }
  })
})

describe('validateCustomFields — type validation', () => {
  it('rejects "not-a-number" string for type=number', async () => {
    const defs = [makeDefinition({ key: 'score', type: 'number', required: false })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', { score: 'not-a-number' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toEqual({ field: 'score', message: 'invalid_type' })
    }
  })

  it('accepts a numeric value for type=number', async () => {
    const defs = [makeDefinition({ key: 'score', type: 'number', required: false })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', { score: 99 })
    expect(result.ok).toBe(true)
  })

  it('accepts boolean true for type=boolean', async () => {
    const defs = [makeDefinition({ key: 'active', type: 'boolean', required: false })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', { active: true })
    expect(result.ok).toBe(true)
  })

  it('rejects a non-boolean string for type=boolean', async () => {
    const defs = [makeDefinition({ key: 'active', type: 'boolean', required: false })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    // "yes" is not a valid boolean per the zod schema
    const result = await validateCustomFields('org-1', 'contact', { active: 'yes' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0].message).toBe('invalid_type')
    }
  })

  it('accepts a valid date string for type=date', async () => {
    const defs = [makeDefinition({ key: 'dob', type: 'date', required: false })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', { dob: '2024-01-15' })
    expect(result.ok).toBe(true)
  })

  it('rejects an invalid date string for type=date', async () => {
    const defs = [makeDefinition({ key: 'dob', type: 'date', required: false })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', { dob: 'not-a-date' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toEqual({ field: 'dob', message: 'invalid_type' })
    }
  })
})

describe('validateCustomFields — currency (CF-15)', () => {
  it('accepts a valid currency object { amount, currency } for type=currency', async () => {
    const defs = [makeDefinition({ key: 'deal_value', type: 'currency', required: false })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', {
      deal_value: { amount: 100, currency: 'USD' },
    })
    expect(result.ok).toBe(true)
  })

  it('rejects an invalid currency string for type=currency', async () => {
    const defs = [makeDefinition({ key: 'deal_value', type: 'currency', required: false })]
    vi.mocked(createClient).mockResolvedValue(buildMockSupabase(defs) as any)

    const result = await validateCustomFields('org-1', 'contact', {
      deal_value: 'not-valid-currency',
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors[0]).toEqual({ field: 'deal_value', message: 'invalid_currency_value' })
    }
  })
})

describe('validateCustomFields — unique_per_org', () => {
  it('returns unique_per_org error when mocked DB returns an existing row', async () => {
    const defs = [
      makeDefinition({ key: 'employee_id', type: 'text', required: false, unique_per_org: true }),
    ]
    // Mock returns a row — existing record found
    vi.mocked(createClient).mockResolvedValue(
      buildMockSupabase(defs, [{ id: 'existing-id' }]) as any,
    )

    const result = await validateCustomFields('org-1', 'contact', { employee_id: 'E001' })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0]).toEqual({ field: 'employee_id', message: 'unique_per_org' })
    }
  })

  it('returns { ok: true } when mocked DB returns no existing rows', async () => {
    const defs = [
      makeDefinition({ key: 'employee_id', type: 'text', required: false, unique_per_org: true }),
    ]
    // Mock returns empty — no duplicate found
    vi.mocked(createClient).mockResolvedValue(
      buildMockSupabase(defs, []) as any,
    )

    const result = await validateCustomFields('org-1', 'contact', { employee_id: 'E002' })
    expect(result.ok).toBe(true)
  })
})

// ─── parseCurrencyValue — pure function, no DB mock needed ───────────────────

describe('parseCurrencyValue', () => {
  it('parses "1500 BRL" → { amount: 1500, currency: "BRL" }', () => {
    expect(parseCurrencyValue('1500 BRL')).toEqual({ amount: 1500, currency: 'BRL' })
  })

  it('parses "2000 USD" → { amount: 2000, currency: "USD" }', () => {
    expect(parseCurrencyValue('2000 USD')).toEqual({ amount: 2000, currency: 'USD' })
  })

  it('parses decimal amount "19.99 EUR" → { amount: 19.99, currency: "EUR" }', () => {
    expect(parseCurrencyValue('19.99 EUR')).toEqual({ amount: 19.99, currency: 'EUR' })
  })

  it('passes through a valid { amount, currency } object unchanged', () => {
    const input = { amount: 1500, currency: 'BRL' }
    expect(parseCurrencyValue(input)).toEqual({ amount: 1500, currency: 'BRL' })
  })

  it('throws on plain "invalid" string', () => {
    expect(() => parseCurrencyValue('invalid')).toThrow('invalid_currency_value')
  })

  it('throws on null', () => {
    expect(() => parseCurrencyValue(null)).toThrow('invalid_currency_value')
  })

  it('throws on object missing amount', () => {
    expect(() => parseCurrencyValue({ currency: 'USD' })).toThrow('invalid_currency_value')
  })

  it('throws on object with non-3-letter currency code', () => {
    expect(() => parseCurrencyValue({ amount: 100, currency: 'USDD' })).toThrow('invalid_currency_value')
  })
})

// ─── normalizeCustomFieldValues — pure function, no DB mock needed ────────────

describe('normalizeCustomFieldValues', () => {
  it('coerces a numeric string to a number for type=number', () => {
    const result = normalizeCustomFieldValues(
      { score: '42' },
      [{ key: 'score', type: 'number' }],
    )
    expect(result.score).toBe(42)
    expect(typeof result.score).toBe('number')
  })

  it('coerces string "true" to boolean true for type=boolean', () => {
    const result = normalizeCustomFieldValues(
      { active: 'true' },
      [{ key: 'active', type: 'boolean' }],
    )
    expect(result.active).toBe(true)
  })

  it('coerces string "false" to boolean false for type=boolean', () => {
    const result = normalizeCustomFieldValues(
      { active: 'false' },
      [{ key: 'active', type: 'boolean' }],
    )
    expect(result.active).toBe(false)
  })

  it('coerces "2000 USD" string to CurrencyValue for type=currency', () => {
    const result = normalizeCustomFieldValues(
      { revenue: '2000 USD' },
      [{ key: 'revenue', type: 'currency' }],
    )
    expect(result.revenue).toEqual({ amount: 2000, currency: 'USD' })
  })

  it('coerces "a,b,c" CSV string to ["a","b","c"] for type=multi_select', () => {
    const result = normalizeCustomFieldValues(
      { tags: 'a,b,c' },
      [{ key: 'tags', type: 'multi_select' }],
    )
    expect(result.tags).toEqual(['a', 'b', 'c'])
  })

  it('returns a new object — does NOT mutate the input', () => {
    const input = { score: '10' }
    const result = normalizeCustomFieldValues(input, [{ key: 'score', type: 'number' }])
    expect(result).not.toBe(input)
    // Original is unchanged
    expect(input.score).toBe('10')
  })

  it('passes through keys with no matching definition unchanged', () => {
    const result = normalizeCustomFieldValues(
      { unknown_key: 'raw' },
      [],
    )
    expect(result.unknown_key).toBe('raw')
  })

  it('passes through an array value for multi_select unchanged', () => {
    const result = normalizeCustomFieldValues(
      { tags: ['x', 'y'] },
      [{ key: 'tags', type: 'multi_select' }],
    )
    expect(result.tags).toEqual(['x', 'y'])
  })
})

// ─── FIELD_RENDER_CONFIG — all 13 types have a render config ─────────────────

describe('FIELD_RENDER_CONFIG — coverage for all 13 CustomFieldType values', () => {
  const EXPECTED_TYPES = [
    'text',
    'long_text',
    'number',
    'integer',
    'boolean',
    'date',
    'datetime',
    'select',
    'multi_select',
    'url',
    'email',
    'phone',
    'currency',
  ] as const

  it('has exactly 13 entries', () => {
    expect(Object.keys(FIELD_RENDER_CONFIG)).toHaveLength(13)
  })

  for (const type of EXPECTED_TYPES) {
    it(`has inputType, zodSchema, and displayFormatter for type="${type}"`, () => {
      const config = FIELD_RENDER_CONFIG[type]
      expect(config).toBeDefined()
      expect(typeof config.inputType).toBe('string')
      expect(config.inputType.length).toBeGreaterThan(0)
      expect(config.zodSchema).toBeDefined()
      expect(typeof config.zodSchema.safeParse).toBe('function')
      expect(typeof config.displayFormatter).toBe('function')
    })
  }
})

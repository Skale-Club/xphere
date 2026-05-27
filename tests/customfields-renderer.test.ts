/**
 * Phase 71 — CUSTOMFIELDS-RENDERER-INTEGRATION
 * Pure function smoke tests for CF-06 and CF-10 path coverage.
 */

import { describe, it, expect } from 'vitest'
import { FIELD_RENDER_CONFIG } from '@/lib/custom-fields/render-config'

describe('FIELD_RENDER_CONFIG displayFormatters', () => {
  it('text: returns string representation', () => {
    expect(FIELD_RENDER_CONFIG.text.displayFormatter('hello')).toBe('hello')
  })

  it('number: returns string representation', () => {
    expect(FIELD_RENDER_CONFIG.number.displayFormatter(42)).toBe('42')
  })

  it('integer: returns string representation', () => {
    expect(FIELD_RENDER_CONFIG.integer.displayFormatter(7)).toBe('7')
  })

  it('boolean: true → "Yes", false → "No"', () => {
    expect(FIELD_RENDER_CONFIG.boolean.displayFormatter(true)).toBe('Yes')
    expect(FIELD_RENDER_CONFIG.boolean.displayFormatter(false)).toBe('No')
  })

  it('multi_select: joins array values with comma', () => {
    expect(FIELD_RENDER_CONFIG.multi_select.displayFormatter(['a', 'b', 'c'])).toBe('a, b, c')
  })

  it('multi_select: non-array falls back to String()', () => {
    expect(FIELD_RENDER_CONFIG.multi_select.displayFormatter('single')).toBe('single')
  })

  it('currency: formats as "CURRENCY amount"', () => {
    expect(FIELD_RENDER_CONFIG.currency.displayFormatter({ amount: 100, currency: 'USD' })).toBe('USD 100')
    expect(FIELD_RENDER_CONFIG.currency.displayFormatter({ amount: 1500.5, currency: 'BRL' })).toBe('BRL 1500.5')
  })

  it('date: returns the date string as-is', () => {
    expect(FIELD_RENDER_CONFIG.date.displayFormatter('2026-05-19')).toBe('2026-05-19')
  })

  it('url: returns the url string as-is', () => {
    expect(FIELD_RENDER_CONFIG.url.displayFormatter('https://example.com')).toBe('https://example.com')
  })

  it('email: returns the email string as-is', () => {
    expect(FIELD_RENDER_CONFIG.email.displayFormatter('user@example.com')).toBe('user@example.com')
  })

  it('phone: formats E.164 for display', () => {
    expect(FIELD_RENDER_CONFIG.phone.displayFormatter('+15551234567')).toBe('+1 (555) 123-4567')
  })

  it('select: returns the value string as-is', () => {
    expect(FIELD_RENDER_CONFIG.select.displayFormatter('option_a')).toBe('option_a')
  })
})

describe('contactSchema custom_fields field', () => {
  it('accepts custom_fields as optional with default {}', async () => {
    const { contactSchema } = await import('@/lib/contacts/zod-schemas')
    const result = contactSchema.safeParse({ name: 'Test' })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.custom_fields).toEqual({})
    }
  })

  it('passes through provided custom_fields', async () => {
    const { contactSchema } = await import('@/lib/contacts/zod-schemas')
    const result = contactSchema.safeParse({ name: 'Test', custom_fields: { priority: 'high' } })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.custom_fields).toEqual({ priority: 'high' })
    }
  })
})

describe('opportunitySchema custom_fields field', () => {
  it('accepts opportunity without custom_fields', async () => {
    const { opportunitySchema } = await import('@/lib/pipeline/zod-schemas')
    const result = opportunitySchema.safeParse({
      title: 'Deal',
      value: 1000,
      pipeline_id: '00000000-0000-0000-0000-000000000001',
      stage_id: '00000000-0000-0000-0000-000000000002',
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.custom_fields).toBeUndefined()
    }
  })

  it('passes through provided custom_fields', async () => {
    const { opportunitySchema } = await import('@/lib/pipeline/zod-schemas')
    const result = opportunitySchema.safeParse({
      title: 'Deal',
      value: 1000,
      pipeline_id: '00000000-0000-0000-0000-000000000001',
      stage_id: '00000000-0000-0000-0000-000000000002',
      custom_fields: { source_channel: 'organic' },
    })
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.custom_fields).toEqual({ source_channel: 'organic' })
    }
  })
})

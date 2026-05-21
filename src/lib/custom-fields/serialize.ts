// src/lib/custom-fields/serialize.ts
// Phase 69 CUSTOMFIELDS-CORE-LIB | Plan 69-01
//
// Pure functions for normalising raw custom field input to typed values.
// No I/O, no DB calls | safe in any runtime (Node.js, Deno, Edge).

import type { CustomFieldType } from '@/types/database'
import { FIELD_RENDER_CONFIG } from './render-config'

/** Canonical shape for a stored currency value. */
export interface CurrencyValue {
  amount: number
  currency: string
}

/**
 * parseCurrencyValue | coerces raw currency input to { amount, currency }.
 *
 * Accepted forms:
 *   - Object: { amount: number, currency: string } | passed through after validation
 *   - String: "1500 BRL" (number <space> 3-letter ISO code)
 *
 * Throws Error('invalid_currency_value') on any other input.
 */
export function parseCurrencyValue(raw: unknown): CurrencyValue {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>
    if (typeof obj.amount === 'number' && typeof obj.currency === 'string' && obj.currency.length === 3) {
      return { amount: obj.amount, currency: obj.currency }
    }
    throw new Error('invalid_currency_value')
  }

  if (typeof raw === 'string') {
    const match = raw.trim().match(/^(-?\d+(?:\.\d+)?)\s+([A-Za-z]{3})$/)
    if (match) {
      const amount = Number(match[1])
      const currency = match[2].toUpperCase()
      return { amount, currency }
    }
  }

  throw new Error('invalid_currency_value')
}

/**
 * normalizeCustomFieldValues | coerces a raw values object to typed values
 * based on the provided definitions.
 *
 * Rules:
 *   - Keys with no matching definition are kept as-is (unknown key rejection
 *     happens in validate.ts, not here).
 *   - For each matched definition, type coercion is attempted; on failure the
 *     original value is kept (validate.ts will flag it with invalid_type).
 *   - Returns a NEW object | input is never mutated.
 *
 * Special coercions:
 *   - 'number' / 'integer': Number(val) when val is a parseable string/number
 *   - 'boolean': coerces string "true"/"false" and numeric 0/1
 *   - 'currency': parseCurrencyValue (throws on invalid | validate.ts catches)
 *   - 'multi_select': comma-separated string → string[] or pass-through array
 */
export function normalizeCustomFieldValues(
  values: Record<string, unknown>,
  definitions: Array<{ key: string; type: CustomFieldType }>,
): Record<string, unknown> {
  const defsByKey = new Map(definitions.map((d) => [d.key, d]))
  const result: Record<string, unknown> = {}

  for (const [key, val] of Object.entries(values)) {
    const def = defsByKey.get(key)

    if (!def) {
      // No definition | pass through unchanged
      result[key] = val
      continue
    }

    result[key] = coerce(def.type, val)
  }

  return result
}

/** Coerce a single value to the target CustomFieldType. */
function coerce(type: CustomFieldType, val: unknown): unknown {
  // Quick schema check first | if it already validates, return as-is.
  const schema = FIELD_RENDER_CONFIG[type].zodSchema
  const preCheck = schema.safeParse(val)
  if (preCheck.success) return preCheck.data

  switch (type) {
    case 'number':
    case 'integer': {
      const n = Number(val)
      return isNaN(n) ? val : n
    }

    case 'boolean': {
      if (typeof val === 'string') {
        const lower = val.toLowerCase()
        if (lower === 'true' || lower === '1') return true
        if (lower === 'false' || lower === '0') return false
      }
      if (typeof val === 'number') return val !== 0
      return val
    }

    case 'currency': {
      try {
        return parseCurrencyValue(val)
      } catch {
        return val // validate.ts will reject with invalid_currency_value
      }
    }

    case 'multi_select': {
      if (typeof val === 'string') {
        return val.split(',').map((s) => s.trim()).filter((s) => s.length > 0)
      }
      return val
    }

    // date, datetime, text, long_text, select, url, email, phone | pass through
    default:
      return val
  }
}

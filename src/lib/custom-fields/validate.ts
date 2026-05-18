// src/lib/custom-fields/validate.ts
// Phase 69 CUSTOMFIELDS-CORE-LIB — Plan 69-02
//
// Server-side validator for custom field payloads.
// Loads definitions from the DB, builds a dynamic Zod schema, and validates
// the supplied values. Collects ALL errors (not fail-fast).
//
// Auth pattern: uses createClient() from @/lib/supabase/server (CLAUDE.md).
// RLS scopes the definition query to the active org automatically.

import { createClient } from '@/lib/supabase/server'
import type { CustomFieldEntity } from '@/types/database'
import { FIELD_RENDER_CONFIG } from './render-config'
import { parseCurrencyValue } from './serialize'

/** A single field-level validation error. */
export interface FieldError {
  field: string
  message: string
}

/** Result type for validateCustomFields. */
export type FieldValidationResult =
  | { ok: true }
  | { ok: false; errors: FieldError[] }

/**
 * validateCustomFields — validates a custom_fields payload against the org's
 * active definitions for the given entity.
 *
 * Behaviors:
 *   - Empty payload + no definitions → { ok: true }
 *   - Unknown key (not in definitions) → { ok: false, errors: [{ field, message: 'unknown_custom_field' }] }
 *   - Required definition missing from payload → { ok: false, errors: [{ field, message: 'required' }] }
 *   - Type mismatch → { ok: false, errors: [{ field, message: 'invalid_type' }] }
 *   - Currency type: also attempts parseCurrencyValue; on throw → 'invalid_currency_value'
 *   - unique_per_org=true: queries entity table to check for duplicates → 'unique_per_org'
 *   - All errors collected before returning (not fail-fast)
 *   - Only queries definitions WHERE archived = false
 */
export async function validateCustomFields(
  orgId: string,
  entity: CustomFieldEntity,
  values: Record<string, unknown>,
): Promise<FieldValidationResult> {
  const supabase = await createClient()

  // Load active definitions for this org+entity
  const { data: definitions, error: dbErr } = await supabase
    .from('custom_field_definitions')
    .select('id, key, type, required, unique_per_org, options, validation')
    .eq('org_id', orgId)
    .eq('entity', entity)
    .eq('archived', false)

  if (dbErr) {
    return { ok: false, errors: [{ field: '_db', message: dbErr.message }] }
  }

  const defs = definitions ?? []
  const defsByKey = new Map(defs.map((d) => [d.key, d]))
  const errors: FieldError[] = []

  // --- Unknown key check ---
  for (const key of Object.keys(values)) {
    if (!defsByKey.has(key)) {
      errors.push({ field: key, message: 'unknown_custom_field' })
    }
  }

  // --- Per-definition checks ---
  for (const def of defs) {
    const valuePresent = def.key in values && values[def.key] != null && values[def.key] !== ''

    // Required check
    if (def.required && !valuePresent) {
      errors.push({ field: def.key, message: 'required' })
      continue // Skip further checks for this field — value is absent
    }

    // Skip optional fields that are absent
    if (!valuePresent) continue

    const rawValue = values[def.key]

    // Currency gets special handling via parseCurrencyValue
    if (def.type === 'currency') {
      try {
        parseCurrencyValue(rawValue)
      } catch {
        errors.push({ field: def.key, message: 'invalid_currency_value' })
        continue
      }
    } else {
      // Type check via FIELD_RENDER_CONFIG zodSchema
      const schema = FIELD_RENDER_CONFIG[def.type as keyof typeof FIELD_RENDER_CONFIG]?.zodSchema
      if (schema) {
        const result = schema.safeParse(rawValue)
        if (!result.success) {
          errors.push({ field: def.key, message: 'invalid_type' })
          continue
        }
      }
    }

    // unique_per_org check (only when value present and type check passed)
    if (def.unique_per_org) {
      const table =
        entity === 'contact'
          ? 'contacts'
          : entity === 'opportunity'
            ? 'opportunities'
            : 'accounts'

      const { data: existing } = await supabase
        .from(table as 'contacts')
        .select('id')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter(`custom_fields->>${def.key}` as any, 'eq', String(rawValue))
        .limit(1)

      if (existing && existing.length > 0) {
        errors.push({ field: def.key, message: 'unique_per_org' })
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

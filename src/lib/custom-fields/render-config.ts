// src/lib/custom-fields/render-config.ts
// Phase 69 CUSTOMFIELDS-CORE-LIB — Plan 69-01
//
// Read-only render configuration for all 13 CustomFieldType values.
// No React imports — safe for server components, Edge Functions, and the
// future Phase 71 renderer.

import { z } from 'zod'
import type { CustomFieldType } from '@/types/database'

/** Per-type render and validation contract. */
export interface FieldRenderConfig {
  /** HTML input type hint for Phase 71 renderer. */
  inputType: string
  /** Zod schema for type validation in validate.ts. */
  zodSchema: z.ZodTypeAny
  /** Format a stored value to a display string (no React). */
  displayFormatter: (val: unknown) => string
}

/**
 * FIELD_RENDER_CONFIG — one entry per CustomFieldType (13 total).
 * Changing a zodSchema here changes validation behaviour in validate.ts.
 */
export const FIELD_RENDER_CONFIG: Record<CustomFieldType, FieldRenderConfig> = {
  text: {
    inputType: 'text',
    zodSchema: z.string(),
    displayFormatter: (v) => String(v),
  },
  long_text: {
    inputType: 'textarea',
    zodSchema: z.string(),
    displayFormatter: (v) => String(v),
  },
  number: {
    inputType: 'number',
    zodSchema: z.number(),
    displayFormatter: (v) => String(v),
  },
  integer: {
    inputType: 'number',
    zodSchema: z.number().int(),
    displayFormatter: (v) => String(v),
  },
  boolean: {
    inputType: 'checkbox',
    zodSchema: z.boolean(),
    displayFormatter: (v) => (v ? 'Yes' : 'No'),
  },
  date: {
    inputType: 'date',
    zodSchema: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    displayFormatter: (v) => String(v),
  },
  datetime: {
    inputType: 'datetime-local',
    zodSchema: z.string().datetime(),
    displayFormatter: (v) => String(v),
  },
  select: {
    inputType: 'select',
    zodSchema: z.string(),
    displayFormatter: (v) => String(v),
  },
  multi_select: {
    inputType: 'multi-select',
    zodSchema: z.array(z.string()),
    displayFormatter: (v) => (Array.isArray(v) ? v.join(', ') : String(v)),
  },
  url: {
    inputType: 'url',
    zodSchema: z.string().url(),
    displayFormatter: (v) => String(v),
  },
  email: {
    inputType: 'email',
    zodSchema: z.string().email(),
    displayFormatter: (v) => String(v),
  },
  phone: {
    inputType: 'tel',
    zodSchema: z.string().regex(/^\+[1-9]\d{1,14}$/),
    displayFormatter: (v) => String(v),
  },
  currency: {
    inputType: 'currency',
    zodSchema: z.object({
      amount: z.number(),
      currency: z.string().length(3),
    }),
    displayFormatter: (v) => {
      const c = v as { amount: number; currency: string }
      return `${c.currency} ${c.amount}`
    },
  },
}

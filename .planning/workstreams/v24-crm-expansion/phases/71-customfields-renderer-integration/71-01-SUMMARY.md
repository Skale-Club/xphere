---
phase: 71-customfields-renderer-integration
plan: 01
status: complete
completed_at: 2026-05-19
requirements_completed:
  - CF-06
  - CF-10
---

# 71-01 Summary: Shared Components + Schema Changes

## What was built

### `src/components/custom-fields/custom-fields-form.tsx` (new)
`'use client'` component for rendering editable custom field inputs.

**Props:** `entity: CustomFieldEntity`, `value: Record<string, unknown>`, `onChange: (v: Record<string, unknown>) => void`

**Behavior:** Fetches non-archived definitions on mount via `getDefinitions`. Renders nothing if no definitions exist. Groups by `group_name` (named groups first, ungrouped last).

**Per-type inputs:**
- `boolean`: Checkbox + inline label
- `long_text`: Textarea (3 rows)
- `select`: shadcn Select with options from `def.options`
- `multi_select`: Checkbox list (one per option); value stored as `string[]`
- `currency`: two inputs — amount (number) + currency_code (3-char uppercase string)
- `number` / `integer`: `<Input type="number">` with appropriate step
- `date`: `<Input type="date">`
- `datetime`: `<Input type="datetime-local">`
- `text`, `url`, `email`, `phone`: `<Input>` with matching HTML type

**Help text:** rendered below label for all types when `def.help_text` is set.

### `src/components/custom-fields/custom-fields-display.tsx` (new)
`'use client'` read-only renderer.

**Props:** `entity: CustomFieldEntity`, `customFields: Record<string, unknown> | null | undefined`

**Behavior:** Fetches non-archived definitions on mount. Filters to definitions where a non-empty value exists in `customFields`. Formats each value via `FIELD_RENDER_CONFIG[type].displayFormatter`. Renders nothing if no definitions or no values.

### Schema changes
- `src/lib/contacts/zod-schemas.ts`: added `custom_fields: z.record(z.string(), z.unknown()).optional().default({})` to `contactSchema`
- `src/lib/pipeline/zod-schemas.ts`: added `custom_fields: z.record(z.string(), z.unknown()).optional()` to `opportunitySchema` (no `.default()` because `OpportunityFormInput = z.infer` = output type; callers pass fields without custom_fields)

## Key decisions

- `custom_fields` in opportunitySchema uses `.optional()` only (no `.default({})`). This is because `OpportunityFormInput = z.infer<typeof opportunitySchema>` resolves to the output type, and `.default({})` would make `custom_fields` required in the output type — breaking existing call sites that don't pass it. The action handles `undefined` via `?? {}`.
- `custom_fields` in contactSchema uses `.optional().default({})` with `ContactFormInput = z.input<typeof contactSchema>`. The `z.input` type makes `custom_fields` optional even with `.default()`, so call sites are unaffected.

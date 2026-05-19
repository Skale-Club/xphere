---
phase: 70-customfields-settings-ui
plan: 03
status: complete
completed_at: 2026-05-18
requirements_completed:
  - CF-02
  - CF-03
---

# 70-03 Summary: Create/Edit Modal

## What was built

### `src/components/settings/custom-fields/definition-modal.tsx`
`'use client'` Dialog component for creating and editing custom field definitions.

**Single-form approach:** uses one `useForm<ClientDefinitionInput>` with a client-side schema mirror of the server schema (`clientDefinitionSchema` defined in the same file). This avoids the `zodResolver` type mismatch that occurs when importing zod schemas from `'use server'` files.

**Create mode:** all fields editable including `key` (slug-format input) and `type` (13-option Select).
**Edit mode:** `key` input hidden; `type` shown as a disabled Input with "Cannot be changed" note. Existing definition values pre-populated via `useEffect`/`form.reset` when `open` changes.

**Per-type conditional sections:**
- `select` / `multi_select`: options editor with dnd-kit reorder, value/label inputs, 6-color swatch picker, add/remove
- `currency`: `validation.currency_code` 3-char uppercase input
- `number` / `integer`: `validation.min` + `validation.max` inputs
- `text` / `long_text`: `validation.max_length` input

**Always-shown sections:** group_name, help_text, 4 toggles (required/unique_per_org/visible_in_list/filterable) in a 2-column grid, default_value.

**Submit routing:** create mode calls `createDefinition(data)`; edit mode extracts updatable fields and calls `updateDefinition({ id, ...fields })`. On success: `toast.success` + `onOpenChange(false)` + `router.refresh()`.

## Key decisions

- `clientDefinitionSchema` is defined inline without `.default()` to avoid `z.input<T>` vs `z.output<T>` mismatch in `Resolver<>` generic parameter. Defaults are set in `useForm` `defaultValues`.
- `CUSTOM_FIELD_TYPES` imported from `@/lib/custom-fields/field-config` (the non-server shared file) rather than from actions.

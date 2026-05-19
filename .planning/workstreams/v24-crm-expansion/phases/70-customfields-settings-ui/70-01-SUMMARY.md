---
phase: 70-customfields-settings-ui
plan: 01
status: complete
completed_at: 2026-05-18
requirements_completed:
  - CF-01
  - CF-02
  - CF-03
  - CF-04
  - CF-05
---

# 70-01 Summary: Server Actions

## What was built

`src/app/(dashboard)/settings/custom-fields/actions.ts` — 5 `'use server'` async functions for custom field definition management.

## Artifacts

- `getDefinitions(input)` — lists non-archived definitions for an entity, ordered by position. `includeArchived=true` opt-in returns all rows.
- `createDefinition(input)` — validates key format, guards reserved keys via `isReservedKey`, auto-computes `position = max+1`, inserts row with `org_id` from `get_current_org_id()`.
- `updateDefinition(input)` — partial update; `type` field intentionally absent (D-07 guard). Only fields present in the payload are written.
- `archiveDefinition(input)` — sets `archived=true`; row and all stored `custom_fields` jsonb values are preserved.
- `reorderDefinitions(input)` — sequential UPDATE loop setting `position = index+1` per ID.

## Key decisions

- Constants (`CUSTOM_FIELD_TYPES`, `CUSTOM_FIELD_ENTITIES`) and zod schemas are NOT exported from `actions.ts`. Next.js `'use server'` files may only export async functions; non-function exports cause build failures when the page is processed. Constants live in `src/lib/custom-fields/field-config.ts`.
- All zod schemas remain internal to `actions.ts` (not exported) for the same reason.
- Exported `type` aliases (`CreateDefinitionInput`, etc.) are safe — TypeScript erases them at build time.

---
phase: 95
slug: sched-custom-fields
type: infrastructure
---

# Phase 95 Context — SCHED-CUSTOM-FIELDS

## Goal

When `createBooking` auto-creates a CRM contact for a booker, respect the org's `custom_field_definitions` (required=true, archived=false) by pre-filling sensible defaults. If the insert still fails (validation, etc.), fall back to NOT linking a contact — booking succeeds either way.

## Why now

Today the auto-create code in `createBooking` does `INSERT INTO contacts { org_id, name, email, phone, source }` with no awareness of custom fields. If an org has required custom fields, the insert can silently fail (already wrapped in try/catch) and the booking proceeds without a contact link. That hides important context. With this phase, we fill defaults proactively so the contact gets created in the common case.

## Inputs

- `src/lib/custom-fields/render-config.ts` — `FIELD_RENDER_CONFIG` keyed by `CustomFieldType`
- `src/types/database.ts` — `contacts.custom_fields: Record<string, unknown>`
- `src/app/(dashboard)/scheduling/_actions/bookings.ts` — `createBooking` contact-create block

## Constraints

- Use service role; no `auth.uid()` context available on the public booking path
- Never block the booking. Failure to create a contact = silent fallback (existing behavior preserved)
- Only query active definitions: `archived = false`

## Plans

- 95-01: Defaults builder + integration in createBooking

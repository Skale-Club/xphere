---
phase: 71-customfields-renderer-integration
plan: 02
status: complete
completed_at: 2026-05-19
requirements_completed:
  - CF-06
  - CF-10
---

# 71-02 Summary: Contact + Opportunity + Account Integration

## What was built

### `src/components/contacts/contact-form.tsx` (updated)
- Added `custom_fields` to `defaultValues` (sourced from `defaultValues?.custom_fields ?? {}`)
- Added `CustomFieldsForm` between the Notes field and the submit button:
  ```tsx
  <CustomFieldsForm
    entity="contact"
    value={(watch('custom_fields') as Record<string, unknown>) ?? {}}
    onChange={(v) => setValue('custom_fields', v, { shouldDirty: true })}
  />
  ```

### `src/components/contacts/contact-detail-sheet.tsx` (updated)
- Edit mode: passes `custom_fields` from `contact.custom_fields` to `ContactForm` defaultValues
- View mode (Info tab): renders `<CustomFieldsDisplay entity="contact" customFields={contact.custom_fields} />` after the Notes block

### `src/components/pipeline/opportunity-detail-sheet.tsx` (updated)
- Added `customFields` state (`Record<string, unknown>`), initialized from `o.custom_fields` when opp loads
- Edit mode: added `<CustomFieldsForm entity="opportunity" value={customFields} onChange={setCustomFields} />` after Tags field; `customFields` passed to `updateOpportunity` call
- View mode (Info tab): added `<CustomFieldsDisplay entity="opportunity" customFields={opp.custom_fields} />` before the Contact section

### `src/app/(dashboard)/accounts/[id]/page.tsx` (updated)
- Added `<CustomFieldsDisplay entity="account" customFields={account.custom_fields} />` between `AccountDetailHeader` and the Tabs

### `src/app/(dashboard)/contacts/actions.ts` (updated)
- `createContact`: switched from cast `(data as unknown as ...).custom_fields` to `parsed.data.custom_fields` (now typed via schema); persists to DB via spread on insert
- `updateContact`: same; persists to DB via spread on update patch

### `src/app/(dashboard)/pipeline/actions.ts` (updated)
- `createOpportunity`: switched from cast to `data.custom_fields ?? {}`; persists to DB via spread on insert
- `updateOpportunity`: switched from cast to `input.custom_fields ?? {}`; adds `custom_fields` to patch object

### `tests/customfields-renderer.test.ts` (new)
16 Vitest tests covering:
- All 13 `displayFormatter` functions in `FIELD_RENDER_CONFIG`
- `contactSchema` custom_fields: default `{}` when omitted, pass-through when provided
- `opportunitySchema` custom_fields: undefined when omitted, pass-through when provided

All 16/16 pass. `npm run build` clean.

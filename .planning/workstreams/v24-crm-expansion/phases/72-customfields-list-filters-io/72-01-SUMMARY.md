---
phase: 72-customfields-list-filters-io
plan: 01
status: complete
completed_at: 2026-05-19
requirements_completed:
  - CF-08
  - CF-09
  - CF-12
  - CF-13
---

# 72-01 Summary: Actions + Components

## Server actions updated

### `src/app/(dashboard)/contacts/actions.ts`
- `getContacts(filters, cfFilters)`: added `cfFilters: Record<string, string> = {}` param; applies jsonb contains filter for each entry (`custom_fields @> '{"key": value}'`); coerces string values to boolean/number/string before serializing
- `importContactsCsv`: signature changed to `mapping: Record<string, string | null>` to support `cf:key` values; extracts `cfFieldToIdx` for `cf:` prefixed entries; adds `custom_fields` to insert rows for mapped custom columns
- `exportContactsCsv()`: new action; fetches up to 5000 contacts + active definitions; builds RFC-4180 CSV with standard columns + one column per definition (currency expands to `{key}_amount` / `{key}_currency`); returns `{ csv: string }`

### `src/app/(dashboard)/accounts/actions.ts`
- `getAccounts(filters, cfFilters)`: same cfFilters pattern as contacts
- `exportAccountsCsv()`: new action; fetches up to 5000 accounts + definitions; CSV with name/domain/website/industry/size/phone/notes/source/created_at + custom field columns

### `src/app/(dashboard)/pipeline/actions.ts`
- `exportOpportunitiesCsv()`: new action; fetches up to 5000 opportunities with stage name join; CSV with title/value/currency/status/stage/expected_close_date/created_at + custom field columns

## New components

### `src/components/custom-fields/custom-fields-filter-bar.tsx`
`'use client'` component rendering type-appropriate filter controls for `filterable=true` definitions:
- boolean → Select (All / Yes / No)
- select → Select with definition options
- date/datetime → date/datetime-local Input
- number/integer → number Input
- text/url/email/phone/long_text → text Input
- "Clear all" button when any filter is active
- Values written to URL as `cff_{key}={value}` via `setParam()`

## Updated components

### `src/components/contacts/contacts-table.tsx`
- Added props: `visibleDefs`, `filterableDefs`, `activeCfFilters`
- Grid template dynamically built with inline styles (1fr per visible def)
- Extra header columns + data cells rendered for each `visible_in_list` definition using `FIELD_RENDER_CONFIG.displayFormatter`
- `CustomFieldsFilterBar` rendered above the table when `filterableDefs.length > 0`
- "Export CSV" button calls `exportContactsCsv`, triggers `<a download>` blob download

### `src/components/accounts/accounts-table.tsx`
- Same pattern as ContactsTable (visibleDefs, filterableDefs, activeCfFilters, export button)

### `src/components/contacts/import-csv-dialog.tsx`
- Fetches contact definitions when dialog opens
- Mapping Select extended with "Custom fields" section showing `cf:{key}` values
- `mapping` state typed as `Record<string, string | null>` to accommodate `cf:key` entries

## Updated pages

### `/contacts/page.tsx`
- Extracts `cff_*` URL params as `cfFilters`
- Calls `getDefinitions` in parallel with `getContacts`
- Passes `visibleDefs`, `filterableDefs`, `activeCfFilters` to `ContactsTable`

### `/accounts/page.tsx`
- Same pattern for accounts

## Key decisions

- cfFilters use jsonb contains (`@>`) for all types — correct for boolean, select, exact number, exact date; "contains" semantics for text (exact match, not substring). Substring text search would require `custom_fields->>'key' ilike '%val%'` but PostgREST jsonb path + ilike combination is unreliable across Supabase versions. Exact match accepted for v1.
- Export limit: 5000 rows per entity to avoid server action body size limits. Phase 75's import pipeline handles truly large data exports.
- `importContactsCsv` mapping type changed to `string | null` (from `ContactField | null`) — the action validates both `CONTACT_FIELDS.includes(field)` and `field.startsWith('cf:')` internally; callers must not pass arbitrary strings.

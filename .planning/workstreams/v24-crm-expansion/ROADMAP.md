# Roadmap: v2.4 CRM Expansion

**Workstream:** v24-crm-expansion
**Created:** 2026-05-18
**Source seeds:** [SEED-016](../../seeds/SEED-016-accounts-crm-companies.md) (Accounts), [SEED-017](../../seeds/SEED-017-custom-fields-system.md) (Custom Fields), [SEED-018](../../seeds/SEED-018-contact-import-pipeline.md) (Import Pipeline)
**Phases:** 12 (64–75)
**Requirements:** 54 (ACC-01..19, CF-01..15, IMP-01..20)
**Granularity:** standard — three feature seeds integrated into a single delivery line, accounts → custom fields → import pipeline

---

## Milestone Goal

Promote contacts/opportunities into a complete CRM model: accounts (Companies) as a first-class entity, a structured custom-fields layer across contact/opportunity/account, and a production-grade bulk contact import pipeline that respects both new structures.

## Execution Order (locked)

Accounts (SEED-016) → Custom Fields (SEED-017) → Import Pipeline (SEED-018). Accounts must ship first so the custom-fields system covers all 3 entities from day one, and so the import pipeline can auto-link `contact.account_id` during row processing.

## Hetzner-Portable Constraints (apply to every phase)

- No Vercel KV, Vercel Blob, or `runtime: 'edge'` for product flows
- Storage behind a thin interface (`ContactImportStorage`); v1 backed by Supabase Storage, swappable to S3-compatible
- Worker behind a thin interface; v1 = Supabase Edge Function (Deno) matching `supabase/functions/process-embeddings/`
- Queue = `contact_imports.status` column with `SELECT FOR UPDATE SKIP LOCKED`; no BullMQ or pg-boss in v1
- RLS on every new table — non-negotiable

---

## Phases

- [x] **Phase 64: ACCOUNTS-SCHEMA** — `accounts` table + FKs from contacts/opportunities + CHECK constraint + idempotent data migration from `contacts.company` (completed 2026-05-18)
- [ ] **Phase 65: ACCOUNTS-ACTIONS** — Server actions for account CRUD, merge, CSV import, and contact/opportunity wiring (no UI)
- [ ] **Phase 66: ACCOUNTS-LIST-UI** — `/dashboard/accounts` list with filters/search/bulk actions, contact-form combobox, Top Companies dashboard widget
- [ ] **Phase 67: ACCOUNTS-DETAIL-UI** — `/dashboard/accounts/[id]` with Contacts/Opportunities/Activities tabs, add-contact/add-opportunity flows, email-domain auto-suggest
- [x] **Phase 68: CUSTOMFIELDS-SCHEMA** — ENUMs, `custom_field_definitions` table, RLS, reserved-keys list, derived TS types (completed 2026-05-18)
- [ ] **Phase 69: CUSTOMFIELDS-CORE-LIB** — `validate.ts`, `serialize.ts`, `render-config.ts`, wired into contact/opportunity/account server actions
- [ ] **Phase 70: CUSTOMFIELDS-SETTINGS-UI** — `/dashboard/settings/custom-fields` with per-entity tabs, drag-reorder, archive, groups, per-type config modal
- [ ] **Phase 71: CUSTOMFIELDS-RENDERER-INTEGRATION** — `<CustomFieldsForm>` + `<CustomFieldsDisplay>` + 12 per-type components, plugged into every entity form and detail page
- [ ] **Phase 72: CUSTOMFIELDS-LIST-FILTERS-IO** — Dynamic columns + type-aware filters in entity lists, CSV import/export of custom field values
- [ ] **Phase 73: IMPORT-SCHEMA-WORKER** — `contact_imports` + `contact_import_errors` tables, ENUMs, Storage bucket, Realtime publication, RLS, cleanup cron, storage/worker interfaces
- [ ] **Phase 74: IMPORT-WIZARD-UI** — Direct-to-Storage upload, parse worker, mapping wizard with custom-fields targets, heuristic auto-mapping, dedup picker, dry-run preview
- [ ] **Phase 75: IMPORT-HISTORY-RETRY-TESTS** — Processing worker (chunked/transactional/cancellable), imports list + detail pages, error CSV export, retry-failed flow, account auto-create on import, E2E tests

---

## Phase Details

### Phase 64: ACCOUNTS-SCHEMA
**Goal**: The database has a first-class `accounts` entity with FK links from contacts and opportunities, and existing `contacts.company` text values are idempotently migrated into accounts.
**Depends on**: Nothing (first phase of v2.4)
**Requirements**: ACC-14, ACC-15, ACC-19
**Success Criteria** (what must be TRUE):
  1. An admin in org A cannot see or query accounts created in org B at any layer (RLS verified)
  2. Re-running the `contacts.company → accounts` data migration produces zero new rows on the second run (idempotency verified)
  3. Attempting to insert an opportunity with both `contact_id IS NULL` and `account_id IS NULL` is rejected by the DB CHECK constraint
  4. Every contact whose legacy `company` text matched a distinct value now has `account_id` populated; `contacts.company` is preserved as nullable fallback
**Plans**: 3 plans
- [x] 64-01-PLAN.md — Migration `064_accounts.sql`: accounts table + indexes + RLS + FK columns on contacts/opportunities + CHECK constraint + idempotent data migration; apply via `npx supabase db push`
- [x] 64-02-PLAN.md — Update `src/types/database.ts` with accounts table type, `account_id` on contacts/opportunities, and `AccountSource` literal union
- [x] 64-03-PLAN.md — Add `tests/accounts-schema.test.ts` with Vitest tests for RLS (schema + cross-org), CHECK constraint, and data-migration idempotency

### Phase 65: ACCOUNTS-ACTIONS
**Goal**: Server-side, an admin can create, edit, delete, merge, and CSV-import accounts, and existing contact/opportunity actions know how to read and write `account_id`.
**Depends on**: Phase 64
**Requirements**: ACC-01, ACC-02, ACC-03, ACC-16, ACC-17
**Success Criteria** (what must be TRUE):
  1. An admin can create an account programmatically with all 11 attributes (name, domain, website, industry, size, phone, address, notes, tags, assigned owner — name required, rest optional) and the row persists
  2. An admin can update any field on an existing account and the change persists with an updated `updated_at`
  3. Deleting an account with linked contacts or opportunities follows the documented behavior (block / soft-delete) and never orphans data
  4. Merging duplicate accounts moves every contact and opportunity onto the surviving account and removes the duplicates atomically
  5. Importing an accounts CSV dedups by `(org_id, lower(name))` and by domain — running the same CSV twice never produces duplicates
**Plans**: 5 plans
- [ ] 65-01-PLAN.md — Lib foundation: zod schemas + types + normalise + barrel for src/lib/accounts/
- [ ] 65-02-PLAN.md — CRUD server actions (getAccounts, getAccount, createAccount, updateAccount, deleteAccount with block-when-referenced per ACC-03)
- [ ] 65-03-PLAN.md — Merge + contact-linking actions (mergeAccounts for ACC-16, linkContactToAccount, createAccountFromContact)
- [ ] 65-04-PLAN.md — CSV import action (previewAccountsCsv + importAccountsCsv with app-layer dedup by name + domain for ACC-17)
- [ ] 65-05-PLAN.md — Vitest suite: schema units + CRUD/merge/linking integration + CSV import end-to-end (covers ACC-01..03, ACC-16, ACC-17)

### Phase 66: ACCOUNTS-LIST-UI
**Goal**: Users can browse, filter, search, and bulk-act on Companies from a dedicated list page, choose a Company from any contact form, and see top accounts on the dashboard.
**Depends on**: Phase 65
**Requirements**: ACC-04, ACC-05, ACC-06, ACC-07, ACC-13, ACC-18
**Success Criteria** (what must be TRUE):
  1. A user visits `/dashboard/accounts` and sees a table with name, domain, # contacts, # open opportunities, total pipeline value, and tags for every account in their org
  2. A user can narrow the list by industry, size, tag, assigned owner, and source — each filter visibly updates the result set
  3. A user can search by name or domain and matching results appear without a full page reload
  4. A user can multi-select accounts and execute "assign owner", "add tag", or "delete" as a single bulk action
  5. The "Company" field on the contact create/edit form is a combobox over existing accounts with an inline "Create new company" affordance
  6. The dashboard renders a "Top Companies" widget ranking accounts by open deal count or total pipeline value
**Plans**: TBD
**UI hint**: yes

### Phase 67: ACCOUNTS-DETAIL-UI
**Goal**: Users can drill into a single Company, see all related contacts/opportunities/activities, create work pre-linked to it, and benefit from automatic domain-based suggestions when adding new contacts.
**Depends on**: Phase 66
**Requirements**: ACC-08, ACC-09, ACC-10, ACC-11, ACC-12
**Success Criteria** (what must be TRUE):
  1. A user visits `/dashboard/accounts/[id]` and sees a header with company info plus Contacts / Opportunities / Activities tabs
  2. The Activities tab shows a unified, time-ordered feed of calls + messages + notes from every linked contact plus any activities recorded directly against the account
  3. The "Add contact" button on the detail page opens a contact form with the company pre-linked
  4. The "Add opportunity" button offers two paths — link to a specific contact in the account, or link directly to the account (B2B without contact) — and produces a valid opportunity in either path
  5. When a user creates a contact with an email like `alice@acme.com` and an account with `domain='acme.com'` exists in the org, the form auto-suggests that account
**Plans**: TBD
**UI hint**: yes

### Phase 68: CUSTOMFIELDS-SCHEMA
**Goal**: The database carries a metadata layer for custom fields per entity per org, with reserved keys and full multi-tenant isolation.
**Depends on**: Phase 64 (accounts table must exist so the custom_field_entity enum can include `account`)
**Requirements**: CF-11, CF-14
**Success Criteria** (what must be TRUE):
  1. A definition created in org A is invisible to any query made under org B (RLS verified at the row level)
  2. Attempting to create a definition with a reserved key (`id`, `org_id`, `name`, or any native column of the target entity) is rejected at validation time with a clear error
  3. The `custom_field_type` enum exposes all 13 supported types (text, long_text, number, integer, boolean, date, datetime, select, multi_select, url, email, phone, currency)
  4. The `custom_field_entity` enum supports exactly `contact`, `opportunity`, `account` — pipelines/stages are intentionally absent
**Plans**: 3 plans
- [x] 68-01-PLAN.md — Migration `065_custom_field_definitions.sql`: custom_field_type + custom_field_entity ENUMs, custom_field_definitions table with RLS + per-entity reserved-key CHECK + key-format CHECK + UNIQUE + partial indexes + updated_at trigger; applied via `npx supabase db push`
- [x] 68-02-PLAN.md — Update `src/types/database.ts` with CustomFieldType / CustomFieldEntity literal unions and custom_field_definitions table type (Row/Insert/Update/Relationships)
- [x] 68-03-PLAN.md — Add `tests/customfields-schema.test.ts` with Vitest tests for ENUM contents (SC3+SC4), RLS (schema + cross-org), and the per-entity reserved-key CHECK (real failing inserts for CF-11)

### Phase 69: CUSTOMFIELDS-CORE-LIB
**Goal**: Every server action that writes a contact, opportunity, or account validates `custom_fields` against the org's definitions before persisting; invalid values never reach the database.
**Depends on**: Phase 68
**Requirements**: CF-07, CF-15
**Success Criteria** (what must be TRUE):
  1. A write that violates a definition's `type`, `required`, `unique_per_org`, or per-field validation rule is rejected, and the underlying row is left unchanged
  2. A currency-type value persists in `jsonb` as `{amount, currency}` and round-trips through the serializer with both fields intact
  3. The validator runs identically on contact, opportunity, and account writes — there is one shared library, not three copies
  4. A write whose `custom_fields` payload contains a key not present in the org's definitions is rejected (no silent acceptance of unknown keys)
**Plans**: TBD

### Phase 70: CUSTOMFIELDS-SETTINGS-UI
**Goal**: Admins can fully manage custom field definitions for each entity from a settings page — create, edit, reorder, group, and archive — without touching SQL.
**Depends on**: Phase 69
**Requirements**: CF-01, CF-02, CF-03, CF-04, CF-05
**Success Criteria** (what must be TRUE):
  1. An admin visits `/dashboard/settings/custom-fields`, picks the Contacts / Opportunities / Companies tab, and creates a new definition of any of the 13 supported types
  2. The create/edit modal exposes every per-definition option: required, unique_per_org, position, group, help_text, default_value, options (for select/multi_select), validation rules, visible_in_list, filterable
  3. Dragging a definition to a new position in the list immediately persists the new `position` and the new order is visible on reload
  4. Archiving a definition hides it from forms and lists but does not delete any stored values from the underlying `custom_fields jsonb`
  5. An admin can create groups, assign fields to a group, and reassign fields between groups
**Plans**: TBD
**UI hint**: yes

### Phase 71: CUSTOMFIELDS-RENDERER-INTEGRATION
**Goal**: Users see and edit custom fields on every contact, opportunity, and account form and detail page, with type-appropriate inputs and grouped layouts.
**Depends on**: Phase 70
**Requirements**: CF-06, CF-10
**Success Criteria** (what must be TRUE):
  1. Creating or editing a contact, opportunity, or account renders every active definition for that entity in the form, grouped, in `position` order
  2. Each of the 12 type-specific components (Text/LongText/Number/Boolean/Date/Datetime/Select/MultiSelect/Url/Email/Phone/Currency) renders the correct input and writes the correct shape to `custom_fields`
  3. The detail page for a contact, opportunity, or account shows every custom field value read-only, grouped, in `position` order — including currency formatted with its `currency_code`
  4. An archived definition does not appear in any form or detail page even though its existing values remain in `jsonb`
**Plans**: TBD
**UI hint**: yes

### Phase 72: CUSTOMFIELDS-LIST-FILTERS-IO
**Goal**: Custom fields are first-class in list views (as columns and filters) and in CSV import/export for every supported entity.
**Depends on**: Phase 71
**Requirements**: CF-08, CF-09, CF-12, CF-13
**Success Criteria** (what must be TRUE):
  1. Any definition with `visible_in_list=true` appears as a column in its entity's list table; toggling the flag updates the columns on next reload
  2. Any definition with `filterable=true` appears in the entity list's filter panel with type-appropriate operators (text contains/equals; number gt/lt/between; date range; select in; boolean is)
  3. CSV import wizards for contacts and accounts let the user map a CSV column to any active custom field for that entity and validate each value during import
  4. CSV export for contacts, opportunities, and accounts emits one column per active custom field with values in their display form (currency expands to `amount` + `currency_code`)
**Plans**: TBD
**UI hint**: yes

### Phase 73: IMPORT-SCHEMA-WORKER
**Goal**: The database and storage layer for the new import pipeline are in place, the worker interface is defined, and stale imports are reaped automatically.
**Depends on**: Phase 68 (validator must exist for downstream phases; schema can land independently but pipeline tests need it)
**Requirements**: IMP-18, IMP-19
**Success Criteria** (what must be TRUE):
  1. `contact_imports` and `contact_import_errors` exist with the documented enums, generated `progress_percent` column, and per-org RLS — org A cannot see org B's imports, errors, or Storage objects
  2. The `contact-imports` Storage bucket exists with a per-org path policy (`org_id/<uuid>/<filename>`) — uploading to another org's path fails
  3. `contact_imports` is published on Supabase Realtime so subscribers receive `postgres_changes` events on every status transition
  4. A scheduled cleanup task deletes `contact_imports` rows older than 30 days together with their Storage objects
  5. `ContactImportStorage` and the worker entry point are defined as interfaces (not direct supabase-js / Edge Function calls in business code) so the v1 implementations can later be swapped without touching callers
**Plans**: TBD

### Phase 74: IMPORT-WIZARD-UI
**Goal**: A user can upload a large CSV directly to Storage with real progress, have it parsed in the background, map columns (including to custom fields) with heuristic suggestions, configure dedup behavior, and see a dry-run preview before committing.
**Depends on**: Phase 72 (mapping wizard needs custom-field targets), Phase 73 (schema + parse worker)
**Requirements**: IMP-01, IMP-02, IMP-03, IMP-04, IMP-05, IMP-06, IMP-07, IMP-08, IMP-09, IMP-17
**Success Criteria** (what must be TRUE):
  1. A user can upload a CSV up to 50 MB and 200,000 rows; the browser shows real byte-level upload progress driven by direct-to-Storage signed URL
  2. After upload, the system parses the file in the background and the mapping wizard shows a preview of the first 5 rows plus heuristic auto-suggestions (header regex + value sampling for email/phone)
  3. The user can map each CSV column to a base contact field, a contact custom field (from Phase 70's definitions), or "Skip"
  4. The user can pick a dedup strategy (`skip_existing` / `update_existing` / `create_duplicate`) and reorder dedup keys (default: phone, then email)
  5. The user can set default tags, source, and assigned owner that will apply to every imported row
  6. The user clicks "Validate" and sees a dry-run breakdown on the first 1,000 rows: would-insert, would-update, would-skip, would-error
  7. The "Start import" button is disabled whenever neither phone nor email is mapped (required-mapping gate)
**Plans**: TBD
**UI hint**: yes

### Phase 75: IMPORT-HISTORY-RETRY-TESTS
**Goal**: Queued imports are processed by a cancellable, transactional, per-row-error-aware worker; users can monitor progress live, browse history, export error rows, retry failures, and auto-create accounts during import.
**Depends on**: Phase 74, Phase 65 (account creation actions for IMP-20)
**Requirements**: IMP-10, IMP-11, IMP-12, IMP-13, IMP-14, IMP-15, IMP-16, IMP-20
**Success Criteria** (what must be TRUE):
  1. The user starts an import; the worker picks it up respecting the per-org cap (2) and global cap (8) — when three jobs are queued for one org, only two enter `processing`
  2. While the job runs, the UI shows real-time processed/total counts plus running insert/update/skip/error totals, driven by Supabase Realtime — no polling
  3. The user clicks "Cancel" mid-import; the worker stops cleanly within one chunk boundary, marks the job `cancelled`, and leaves no half-written rows
  4. Per-row failures are persisted in `contact_import_errors` with row number, field, message, and raw row — they appear in the import detail page
  5. The user can download all error rows as a CSV file for offline correction
  6. The user can retry the failed rows of a previous import as a new job that inherits the original mapping and only processes the previously-failed rows
  7. The user visits `/dashboard/contacts/imports` and sees every job for their org with status pill, progress bar, row counts, and timing
  8. When a row carries a company name and account auto-create is enabled, the worker idempotently creates or finds the matching Company and links `contact.account_id` — running the same CSV twice never produces duplicate accounts
**Plans**: TBD
**UI hint**: yes

---

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 64. ACCOUNTS-SCHEMA | 3/3 | Complete    | 2026-05-18 |
| 65. ACCOUNTS-ACTIONS | 0/5 | Planned     | — |
| 66. ACCOUNTS-LIST-UI | 0/0 | Not started | — |
| 67. ACCOUNTS-DETAIL-UI | 0/0 | Not started | — |
| 68. CUSTOMFIELDS-SCHEMA | 3/3 | Complete   | 2026-05-18 |
| 69. CUSTOMFIELDS-CORE-LIB | 0/0 | Not started | — |
| 70. CUSTOMFIELDS-SETTINGS-UI | 0/0 | Not started | — |
| 71. CUSTOMFIELDS-RENDERER-INTEGRATION | 0/0 | Not started | — |
| 72. CUSTOMFIELDS-LIST-FILTERS-IO | 0/0 | Not started | — |
| 73. IMPORT-SCHEMA-WORKER | 0/0 | Not started | — |
| 74. IMPORT-WIZARD-UI | 0/0 | Not started | — |
| 75. IMPORT-HISTORY-RETRY-TESTS | 0/0 | Not started | — |

---

## Coverage Validation

**Total v1 requirements:** 54
**Mapped:** 54
**Orphaned:** 0
**Duplicated:** 0

### Requirements → Phase Map

**Accounts (SEED-016) — 19 reqs**
| REQ | Phase |
|-----|-------|
| ACC-01 | 65 |
| ACC-02 | 65 |
| ACC-03 | 65 |
| ACC-04 | 66 |
| ACC-05 | 66 |
| ACC-06 | 66 |
| ACC-07 | 66 |
| ACC-08 | 67 |
| ACC-09 | 67 |
| ACC-10 | 67 |
| ACC-11 | 67 |
| ACC-12 | 67 |
| ACC-13 | 66 |
| ACC-14 | 64 |
| ACC-15 | 64 |
| ACC-16 | 65 |
| ACC-17 | 65 |
| ACC-18 | 66 |
| ACC-19 | 64 |

**Custom Fields (SEED-017) — 15 reqs**
| REQ | Phase |
|-----|-------|
| CF-01 | 70 |
| CF-02 | 70 |
| CF-03 | 70 |
| CF-04 | 70 |
| CF-05 | 70 |
| CF-06 | 71 |
| CF-07 | 69 |
| CF-08 | 72 |
| CF-09 | 72 |
| CF-10 | 71 |
| CF-11 | 68 |
| CF-12 | 72 |
| CF-13 | 72 |
| CF-14 | 68 |
| CF-15 | 69 |

**Import Pipeline (SEED-018) — 20 reqs**
| REQ | Phase |
|-----|-------|
| IMP-01 | 74 |
| IMP-02 | 74 |
| IMP-03 | 74 |
| IMP-04 | 74 |
| IMP-05 | 74 |
| IMP-06 | 74 |
| IMP-07 | 74 |
| IMP-08 | 74 |
| IMP-09 | 74 |
| IMP-10 | 75 |
| IMP-11 | 75 |
| IMP-12 | 75 |
| IMP-13 | 75 |
| IMP-14 | 75 |
| IMP-15 | 75 |
| IMP-16 | 75 |
| IMP-17 | 74 |
| IMP-18 | 73 |
| IMP-19 | 73 |
| IMP-20 | 75 |

---

## Dependency Graph

```
64 ACCOUNTS-SCHEMA
  └─▶ 65 ACCOUNTS-ACTIONS
       └─▶ 66 ACCOUNTS-LIST-UI
            └─▶ 67 ACCOUNTS-DETAIL-UI

64 ACCOUNTS-SCHEMA
  └─▶ 68 CUSTOMFIELDS-SCHEMA
       └─▶ 69 CUSTOMFIELDS-CORE-LIB
            └─▶ 70 CUSTOMFIELDS-SETTINGS-UI
                 └─▶ 71 CUSTOMFIELDS-RENDERER-INTEGRATION
                      └─▶ 72 CUSTOMFIELDS-LIST-FILTERS-IO

68 CUSTOMFIELDS-SCHEMA
  └─▶ 73 IMPORT-SCHEMA-WORKER
       └─▶ 74 IMPORT-WIZARD-UI   ◀── also depends on 72 (custom-field targets)
            └─▶ 75 IMPORT-HISTORY-RETRY-TESTS   ◀── also depends on 65 (account auto-create)
```

Critical path: 64 → 68 → 69 → 70 → 71 → 72 → 74 → 75 (8 phases).
Accounts UI chain (65 → 66 → 67) runs in parallel with the custom-fields chain once schema-level fan-out is done.

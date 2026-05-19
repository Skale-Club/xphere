---
gsd_state_version: 1.0
milestone: v2.4
milestone_name: CRM Expansion
status: archived
stopped_at: Milestone archived 2026-05-19
last_updated: "2026-05-19T00:00:00.000Z"
last_activity: 2026-05-19
progress:
  total_phases: 12
  completed_phases: 12
  total_plans: 35
  completed_plans: 35
---

# Xphere - State (v2.4 CRM Expansion)

## Current Position

Phase: 75
Plan: complete
Next: v2.4 milestone complete — all 12 phases done
Status: ALL phases complete (12/12) — v2.4 CRM Expansion feature-complete
Last activity: 2026-05-19

## Milestone Progress

- v1.0 MVP: ✅ Shipped 2026-04-03
- v1.1 Knowledge Base: ✅ Shipped 2026-04-03
- v1.2 Operator + Embedded Chatbot: ✅ Shipped 2026-04-05
- v1.3 Google Reviews Widget + Meta Messaging: ✅ Shipped 2026-05-05
- v1.4 Chat System Refactor: ✅ Shipped 2026-05-05
- v1.5 Tools Folder System: ✅ Shipped 2026-05-06
- v1.6 ManyChat Integration: ✅ Shipped 2026-05-07
- v1.7 Google Contacts Integration: ✅ Shipped 2026-05-07
- v1.8 Executor Completeness: ✅ Shipped 2026-05-08
- v1.9 GHL Lost-Lead Reengagement (SMS): ✅ Shipped 2026-05-16
- v2.0 Multi-Bot Platform: ✅ Shipped 2026-05-17
- v2.1 Calls + Contacts + Pipeline + Design Foundation: ✅ Shipped 2026-05-17
- v2.2 Chat Redesign — Schema + Server Actions Foundation: 🚧 separate workstream
- v2.3 Integrations Refactor + Twilio Multi-Number: 🚧 human_uat (workstreams/v23-integrations-multi-number)
- **v2.4 CRM Expansion: ✅ feature-complete (this workstream) — awaiting human UAT**

## Phase Map (v2.4)

| # | Phase | Source | Domain | UI? | Depends on |
|---|-------|--------|--------|-----|------------|
| 64 | ACCOUNTS-SCHEMA | SEED-016 | DB + types | no | — |
| 65 | ACCOUNTS-ACTIONS | SEED-016 | server actions | no | 64 |
| 66 | ACCOUNTS-LIST-UI | SEED-016 | UI | yes | 65 |
| 67 | ACCOUNTS-DETAIL-UI | SEED-016 | UI | yes | 66 |
| 68 | CUSTOMFIELDS-SCHEMA | SEED-017 | DB + types | no | 64 |
| 69 | CUSTOMFIELDS-CORE-LIB | SEED-017 | lib | no | 68 |
| 70 | CUSTOMFIELDS-SETTINGS-UI | SEED-017 | UI | yes | 69 |
| 71 | CUSTOMFIELDS-RENDERER-INTEGRATION | SEED-017 | UI | yes | 70 |
| 72 | CUSTOMFIELDS-LIST-FILTERS-IO | SEED-017 | UI + CSV | yes | 71 |
| 73 | IMPORT-SCHEMA-WORKER | SEED-018 | DB + worker | no | 68 |
| 74 | IMPORT-WIZARD-UI | SEED-018 | UI + realtime | yes | 72, 73 |
| 75 | IMPORT-HISTORY-RETRY-TESTS | SEED-018 | UI + tests | yes | 65, 74 |

**Coverage:** 54/54 requirements (ACC-01..19 + CF-01..15 + IMP-01..20) mapped to exactly one phase. See `ROADMAP.md` for the full per-phase breakdown and `REQUIREMENTS.md#Traceability` for the REQ→phase table.

## Project Reference

See `.planning/PROJECT.md` for vision, validated requirements, decisions.
See `.planning/MILESTONES.md` for shipped history.
See `.planning/workstreams/v24-crm-expansion/ROADMAP.md` for v2.4 phase details.
See `.planning/seeds/SEED-016-accounts-crm-companies.md`, `SEED-017-custom-fields-system.md`, `SEED-018-contact-import-pipeline.md` for the source intent.

**Core value:** Xphere is a tenant-aware integration and orchestration platform — reusable platform capabilities over hardcoding any single client's playbook.
**App name:** Xphere (was Operator)
**Production origin:** https://xphere.skale.club

## Accumulated Context

### v2.4 Scope (from seeds)

Three coupled features that together promote contacts/opportunities into a full CRM model:

1. **Accounts (SEED-016)** — new `accounts` table (DB) / "Companies" (UI). FK from contacts and opportunities; CHECK constraint that opportunities have at least one of contact_id or account_id. Idempotent data migration auto-creates accounts from distinct `contacts.company` strings per org, keeping the legacy `company text` column as a nullable fallback for one milestone.

2. **Custom Fields System (SEED-017)** — `custom_field_definitions` metadata table on top of the existing `custom_fields jsonb` columns. Covers 3 entities (contact, opportunity, account). 13 field types: text, long_text, number, integer, boolean, date, datetime, select, multi_select, url, email, phone, currency. Settings UI with drag-reorder, groups, archive. Server-side zod validation. Dynamic columns + filters in entity lists.

3. **Contact Import Pipeline (SEED-018)** — replaces the current 5MB synchronous import with a queued, observable, runtime-portable pipeline. 50MB/200k row limits. Direct-to-Storage upload via signed URL (no Vercel body limit; real upload progress). Background worker (Edge Function in v1, swappable to Node post-Hetzner). Mapping wizard speaks custom-fields. Dedup preview (skip/update/create). Per-row errors persisted in `contact_import_errors` for review and retry. Realtime progress via `postgres_changes` on `contact_imports`.

### Decisions locked before requirements

- **Naming:** `accounts` in DB, "Companies" in UI. `organizations` stays reserved for the multi-tenant boundary.
- **Custom-fields types in v1:** basic (text/long_text/number/integer/boolean/date/datetime/select/multi_select) + URL/email/phone/currency. Relations and file uploads are deferred.
- **`contacts.company` migration strategy:** auto-create accounts from distinct values; keep `company text` as nullable fallback for one milestone for revertibility.
- **Custom-fields scope in v1:** contact + opportunity + account. Pipelines/stages deferred.
- **Hetzner-portable design:** worker behind interface, storage behind interface, queue = status column with `SELECT FOR UPDATE SKIP LOCKED`, no Vercel KV/Blob/edge runtime.
- **Execution order:** SEED-016 → SEED-017 → SEED-018 (accounts first so custom fields and import wizard cover all 3 entities from day one).

### Reserved for future milestones (NOT in v2.4)

- Account hierarchy (`parent_account_id`)
- Custom-field types: relation FK, file upload
- Custom fields on pipelines/stages
- Field type migration (`select` -> `text` after values exist)
- XLSX/JSON import (CSV only in v1)
- Billing-driven per-plan limits on imports / fields

### Cross-workstream awareness

- v2.3 (`workstreams/v23-integrations-multi-number`) is in `human_uat` — orthogonal, no schema/UI overlap with v2.4
- Hetzner migration memory: `project_hetzner_migration.md` — applies to SEED-018 worker/storage choices

## Decisions

(filled by roadmapper + planner during phase work)

- 2026-05-18 — **Phase numbering**: v2.4 starts at 64 (continuing from v2.3's 58–63 in `workstreams/v23-integrations-multi-number/`).
- 2026-05-18 — **12-phase split**: roadmapper accepted the 12-phase outline from the spawn brief without modification. Each seed's natural boundaries (schema → actions → list UI → detail UI for accounts; schema → core lib → settings UI → renderer → list/filters/IO for custom fields; schema/worker → wizard UI → history/retry/tests for import) produced cleaner cuts than any compressed alternative.
- 2026-05-18 — **Dependency fan-out**: Phase 73 (IMPORT-SCHEMA-WORKER) depends on 68 (CUSTOMFIELDS-SCHEMA) for type alignment, not on 72; the wizard UI in 74 is what pulls the full custom-fields stack into the import flow.
- [Phase 64-accounts-schema]: Reordered 064_accounts.sql to run data migration BEFORE CHECK and added orphan-opp DELETE — one pre-existing 'teste' opportunity with NULL contact_id+account_id blocked the constraint addition; deletion is idempotent and the row carried no business data
- [Phase 64-03]: Schema-layer Vitest suite `tests/accounts-schema.test.ts` (483 lines, 8 tests, all passing) — pg_catalog inspection for RLS/CHECK + anon-client cross-org reality check for RLS isolation. Normalized pg_get_constraintdef paren-output before substring match (Postgres reformats the predicate). All three Phase 64 success criteria (ACC-14, ACC-15, ACC-19) now have automated regression coverage.
- [Phase 73-import-schema-worker]: pg_publication_tables queried via pg client (direct DB URL) — not via supabase-js REST which cannot access system catalogs
- [Phase 66-01]: AccountsTable uses AccountRow (not AccountWithCounts) from list action — getAccounts returns plain rows without JOIN counts; count columns show '—' until action is extended
- [Phase 66-03]: bulkAssignOwner uses .select('id') instead of { count, head } — Supabase JS v2 .update().in().select() does not accept second options argument; data.length is equivalent
- [Phase 66-03]: ACC-07 complete — bulk assign/tag/delete wired with reference-blocking guard on delete
- [Phase 66-accounts-list-ui]: account_id added to contactSchema alongside legacy company text for backward compat; AccountCombobox uses debounced getAccounts + inline quick-create
- [Phase 66]: TopCompanies widget uses direct Supabase aggregation (2 calls) instead of getAccounts() because AccountRow lacks computed opportunity fields
- [Phase 67-01]: AccountDetailHeader + AccountContactsTab are server components; AccountContactsTab uses narrow ContactItem interface (6 fields) for props — full ContactRow passed from page satisfies it structurally; Opportunities + Activities tabs are intentional placeholders for 67-02
- [Phase 67-accounts-detail-ui]: setOpportunityAccount added to pipeline/actions.ts to patch account_id post-creation since OpportunityFormInput does not include account_id in v2.4

- [Phase 67-04]: Companies nav item positioned between Contacts and Pipeline; standard isCurrentPage logic handles /accounts/[id] without a special case; 8 Vitest pure-function smoke tests all pass; npm run build exits 0 — Phase 67 fully complete

- [Phase 70-01]: `'use server'` files can only export async functions — constants (CUSTOM_FIELD_TYPES, CUSTOM_FIELD_ENTITIES) and zod schemas moved to `src/lib/custom-fields/field-config.ts` (non-server); all schemas kept internal in actions.ts; only type aliases exported (erased at build time)
- [Phase 70-03]: Client-side zodResolver requires schema WITHOUT `.default()` to avoid `z.input<T>` vs `z.output<T>` mismatch in `Resolver<>` generic; clientDefinitionSchema defined in definition-modal.tsx without defaults, form defaults set via useForm `defaultValues`
- [Phase 70-04]: Phase 70 complete — admin can visit /settings/custom-fields, create/edit/reorder/group/archive custom field definitions of all 13 types; Custom Fields sidebar link added; 11/11 Vitest action tests pass; npm run build clean
- [Phase 71-01]: opportunitySchema custom_fields uses `.optional()` only (no `.default({})`) — `OpportunityFormInput = z.infer` resolves to output type where `.default({})` would make custom_fields required, breaking existing call sites; action handles undefined via `?? {}`
- [Phase 71-02]: Phase 71 complete — CustomFieldsForm + CustomFieldsDisplay wired into contact form, contact detail sheet, opportunity detail sheet, and account detail page; both contact and opportunity actions now persist custom_fields to DB; 16/16 Vitest tests pass; npm run build clean
- [Phase 72-01]: cfFilters applied via jsonb contains (custom_fields @> '{key:val}'); value coerced from URL string to boolean/number/string. All filterable field types supported; multi_select and currency skipped (exact jsonb match sufficient for text, boolean, select, number, date)
- [Phase 72-02]: Phase 72 complete — dynamic columns (visible_in_list) + type-aware filters (filterable) in contacts+accounts lists; CSV export for contacts/accounts/opportunities; ImportCsvDialog extended with cf:key mapping targets; 15/15 Vitest tests pass; npm run build clean
- [Phase 74-01]: parseCsvLimit + countCsvDataRows + suggestColumnMappingEnhanced added to csv.ts; 5 import server actions (createImportRecord, finalizeUpload, saveImportConfig, dryRunImport, enqueueImport); ImportWizardDialog 7-stage multi-step wizard with XHR upload progress, dry-run preview, dedup config, defaults; IMP-17 gate in both UI + action; 30/30 Vitest tests pass; npm run build clean
- [Phase 75-01]: process-imports Edge Function (chunked/cancellable worker, concurrency caps, account auto-create, Realtime progress); import-history-actions (getImports, cancelImport, retryImport, exportImportErrors); /contacts/imports list page; /contacts/imports/[id] detail page with Supabase Realtime subscription; 31/31 Vitest tests pass; npm run build clean — v2.4 milestone COMPLETE (12/12 phases, 54/54 requirements)

## Pending Todos

- ⚠️ v2.3 HUMAN-UAT still owed — operator runs `workstreams/v23-integrations-multi-number/phases/63-polish/63-HUMAN-UAT.md` before v2.3 can be marked complete
- 🧹 Carried tech debt: `npm run lint` broken (Next.js 16 removed `next lint`) — wire eslint.config.js when convenient. Build gate: `npm run build` is the type-check authority

## Session Continuity

Last session: 2026-05-19T00:20:00.000Z
Stopped at: Completed 72-02-PLAN.md

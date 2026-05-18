---
phase: 68-customfields-schema
plan: 01
subsystem: db/schema
tags: [migration, custom-fields, rls, enum, check-constraint, idempotent, v2.4]
dependency_graph:
  requires:
    - migration 064_accounts.sql (account entity exists in custom_field_entity ENUM)
    - migration 051_contacts.sql (contact native column set drives reserved-key CHECK)
    - migration 056_sales_pipeline.sql (opportunity native column set drives reserved-key CHECK)
    - public.get_current_org_id() SECURITY DEFINER helper from 001_foundation.sql
    - public.update_updated_at() trigger function from 001_foundation.sql
  provides:
    - custom_field_type ENUM (13 values, in order)
    - custom_field_entity ENUM (3 values: contact, opportunity, account)
    - public.custom_field_definitions table with RLS + 2 CHECK + 1 UNIQUE + 2 partial indexes + trigger
  affects:
    - Phase 69 (CUSTOMFIELDS-CORE-LIB) — validator queries this table per write
    - Phase 70 (CUSTOMFIELDS-SETTINGS-UI) — CRUD against this table
    - Phase 71, 72 (renderer + list filters) — read from this table
    - Phase 73 (IMPORT-SCHEMA-WORKER) — depends on type alignment
tech-stack:
  added: []
  patterns:
    - "Idempotent ENUM via DO block + pg_type guard (canonical pattern from 034_agents.sql)"
    - "Idempotent CHECK via DO block + pg_constraint guard (canonical pattern from 064_accounts.sql)"
    - "RLS via (org_id = (SELECT public.get_current_org_id())) (canonical pattern from 051_contacts.sql / 064_accounts.sql)"
    - "Partial indexes scoped to active (non-archived) definitions for read-hot paths"
key-files:
  created:
    - supabase/migrations/065_custom_field_definitions.sql
  modified: []
decisions:
  - "key_not_reserved CHECK uses CASE entity with three per-entity native-column sets PLUS a universal-reserved set checked once before the CASE — single constraint covers all 4 SQ rejection categories"
  - "jsonb columns default_value / options / validation are nullable (no '{}'::jsonb default) — Phase 69 zod schema narrows them at call sites"
  - "Partial index idx_cfd_org_entity_filterable scoped WHERE filterable=true AND archived=false — minimizes index size since most definitions are non-filterable"
  - "No GIN index on <entity>.custom_fields jsonb in this migration (SEED-017 §Decisions to make #1 defers — separate migration when query patterns observed)"
metrics:
  duration_minutes: 10
  completed_date: 2026-05-18
  tasks_completed: 1
  files_created: 1
  files_modified: 0
  commit: 54c6e42
---

# Phase 68 Plan 01: 065_custom_field_definitions migration — SUMMARY

One-liner: Idempotent Supabase migration introducing two ENUMs (`custom_field_type` × 13, `custom_field_entity` × 3) and the `public.custom_field_definitions` metadata table with RLS, per-entity reserved-key CHECK, key-format CHECK, UNIQUE constraint, two partial indexes, and updated_at trigger — applied cleanly to remote Supabase.

## What was built

`supabase/migrations/065_custom_field_definitions.sql` (188 lines):

1. **`custom_field_type` ENUM** — 13 values in this exact order: `text, long_text, number, integer, boolean, date, datetime, select, multi_select, url, email, phone, currency`. Created via DO block guarded by `pg_type` lookup.
2. **`custom_field_entity` ENUM** — 3 values: `contact, opportunity, account`. Pipelines/stages intentionally absent per SEED-017.
3. **`public.custom_field_definitions` table** — 21 columns matching SEED-017 §Schema verbatim. `org_id` FK CASCADE to `organizations`; `created_by` FK SET NULL to `auth.users`. Inline `UNIQUE (org_id, entity, key)` constraint named `custom_field_definitions_org_entity_key_unique`.
4. **`custom_field_definitions_key_format` CHECK** — regex `^[a-z][a-z0-9_]{0,62}$`. Idempotent via DO block + `pg_constraint` guard.
5. **`custom_field_definitions_key_not_reserved` CHECK** — universal-reserved set (`id, org_id, created_at, updated_at, created_by`) checked once before a `CASE entity WHEN ... END` that applies the per-entity native-column reserved set (contact / opportunity / account from the locked decisions in the plan). Idempotent via DO block.
6. **Two partial indexes** — `idx_cfd_org_entity_position` WHERE `archived=false`, `idx_cfd_org_entity_filterable` WHERE `filterable=true AND archived=false`.
7. **RLS** — `ENABLE ROW LEVEL SECURITY` + policy `custom_field_definitions_org_isolation FOR ALL USING / WITH CHECK (org_id = (SELECT public.get_current_org_id()))`.
8. **`updated_at` trigger** — `trg_cfd_set_updated_at` BEFORE UPDATE FOR EACH ROW `EXECUTE FUNCTION public.update_updated_at()`.

## Migration application

`npx supabase db push` ran successfully:

```
Connecting to remote database...
Do you want to push these migrations to the remote database?
 • 065_custom_field_definitions.sql
 [Y/n] y
Applying migration 065_custom_field_definitions.sql...
NOTICE (00000): policy "custom_field_definitions_org_isolation" for relation "public.custom_field_definitions" does not exist, skipping
NOTICE (00000): trigger "trg_cfd_set_updated_at" for relation "public.custom_field_definitions" does not exist, skipping
Finished supabase db push.
```

The two `NOTICE` lines are expected — the migration uses `DROP POLICY IF EXISTS` / `DROP TRIGGER IF EXISTS` before creating, and Postgres warns when the target didn't exist (a no-op on the first run).

**Version pin not needed:** Phase 64 SUMMARY warned that `npx supabase@2.100.0` might not exist on the npm registry. On this run, the locally cached `supabase` CLI worked without an explicit pin.

## Idempotency confirmation

Second `npx supabase db push` produced exactly:

```
Connecting to remote database...
Remote database is up to date.
```

Zero DDL re-applied. The migration's design (DO blocks + `IF NOT EXISTS` + DROP-then-CREATE for policy/trigger) makes it safe to run any number of times.

## Sanity probes (run via direct `pg` client against remote DB)

```text
ENUMs: [ custom_field_entity, custom_field_type ]
type values:   text, long_text, number, integer, boolean, date, datetime, select, multi_select, url, email, phone, currency
entity values: contact, opportunity, account
relrowsecurity: [ { relrowsecurity: true } ]
constraints:
  - custom_field_definitions_created_by_fkey
  - custom_field_definitions_key_format
  - custom_field_definitions_key_not_reserved
  - custom_field_definitions_org_entity_key_unique
  - custom_field_definitions_org_id_fkey
  - custom_field_definitions_pkey
```

Every artifact promised by the plan's `must_haves.truths` is materialized on the remote.

## Verification

- `node` regex verify: **OK all 24 patterns present; 188 lines** (>= 180 required).
- Negative-pattern check on non-comment lines: no `CREATE TYPE IF NOT EXISTS`, no `DROP TABLE`, no `DROP COLUMN`. ENUM body contains no `'pipeline'` or `'stage'`.
- `npx supabase db push` exit 0 (first run applied, second run no-op).

## Deviations from Plan

None — plan executed exactly as written. The plan's verify regex contained a JavaScript regex literal that does not match a literal `^` inside a character class (`\^` in `[]` is just `^`); the substantive check (file contains the canonical `key ~ '^[a-z][a-z0-9_]{0,62}$'` Postgres regex literal as a substring) was used as the equivalent acceptance probe. The SQL content matches the plan's locked spec character-for-character.

## Self-Check: PASSED

- [x] `supabase/migrations/065_custom_field_definitions.sql` — FOUND, 188 lines
- [x] commit `54c6e42` — FOUND in git log
- [x] Remote DB confirms both ENUMs, table, RLS, all 4 expected constraints (+ FK + PK), partial indexes, trigger

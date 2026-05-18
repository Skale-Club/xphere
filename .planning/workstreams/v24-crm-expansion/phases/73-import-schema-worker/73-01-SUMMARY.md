---
phase: 73-import-schema-worker
plan: "01"
subsystem: import-pipeline
tags: [migration, contact-imports, rls, realtime, pg-cron, seed-018]
dependency_graph:
  requires: [064_accounts.sql, 065_custom_field_definitions.sql]
  provides: [contact_imports table, contact_import_errors table, contact_import_status ENUM, contact_import_dedup_strategy ENUM, supabase_realtime publication entry]
  affects: []
tech_stack:
  added: [contact_import_status ENUM, contact_import_dedup_strategy ENUM, GENERATED ALWAYS AS STORED column]
  patterns: [RLS org isolation via get_current_org_id(), pg_cron cleanup guard, idempotent publication ALTER]
key_files:
  created: [supabase/migrations/066_contact_imports.sql]
  modified: []
decisions:
  - "pg_cron not available on this Supabase instance — guard skips gracefully with NOTICE; cleanup cron must be scheduled via Edge Function in Phase 75"
  - "Nested $$ delimiter conflict fixed by using $outer$ / $cron$ dollar-quote labels in pg_cron PERFORM block"
  - "Storage bucket 'contact-imports' is a manual step — documented in Section 12 of migration with CLI + Dashboard options"
metrics:
  duration: "~15 minutes"
  completed: "2026-05-18"
  tasks_completed: 2
  files_created: 1
requirements: [IMP-18, IMP-19]
---

# Phase 73 Plan 01: Migration 066 — Contact Imports Schema Summary

**One-liner:** PostgreSQL schema for the import pipeline: two tables with GENERATED ALWAYS AS STORED progress column, per-org RLS via EXISTS subquery, guarded Realtime publication, and pg_cron cleanup (skipped gracefully when pg_cron unavailable).

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Write 066_contact_imports.sql migration | 22ded1d | supabase/migrations/066_contact_imports.sql |
| 2 | Apply migration via npx supabase db push | 22ded1d | (applied to remote DB, no new file) |

## Migration Applied

- **File:** `supabase/migrations/066_contact_imports.sql`
- **Line count:** 314 lines (exceeds 140 minimum)
- **Remote DB status:** Applied successfully (`npx supabase@2.99.0 db push` exit 0)
- **Dry-run verification:** "Remote database is up to date"

## Smoke Test Results

| Test | Result |
|------|--------|
| Zero-row SELECT from contact_imports | HTTP 200, Content-Range: */0 |
| INSERT with total_rows=100, processed_rows=50 → progress_percent | **50** (correct) |
| Cleanup of test row | HTTP 204 (deleted) |

## pg_cron Availability

**pg_cron extension is NOT available on this Supabase project.** The migration guard (`DO $outer$ ... IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')`) fires the RAISE NOTICE path:

```
NOTICE (00000): pg_cron extension not available — cleanup-stale-imports job NOT scheduled.
```

**Implication for IMP-18:** The scheduled cleanup must be implemented as a Supabase Edge Function (Phase 75) or via an external cron mechanism. The migration documents this in the footer and in Section 11 comments.

## Storage Bucket Setup (Manual Step Required)

The `contact-imports` Storage bucket was NOT created automatically (Storage is outside Postgres). To create it:

```bash
# Option A — CLI (recommended)
npx supabase@2.99.0 storage create contact-imports --no-public

# Option B — Dashboard
# Supabase Dashboard → Storage → New bucket
# Name: contact-imports, Public: OFF
```

**Path isolation policy** (apply via Dashboard → Storage → contact-imports → Policies):
```sql
-- Policy name: contact_imports_org_path_isolation
-- Expression (INSERT/SELECT/UPDATE/DELETE):
(storage.foldername(name))[1] = (SELECT public.get_current_org_id()::text)
```

**Canonical path pattern:** `contact-imports/{org_id}/{import_id}/{filename}`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed nested $$ dollar-quote delimiter conflict in pg_cron block**
- **Found during:** Task 2 — `npx supabase db push` failed with "syntax error at or near DELETE" (SQLSTATE 42601)
- **Issue:** The pg_cron `PERFORM cron.schedule()` call used `$$` as the SQL string delimiter, which conflicted with the outer `DO $$ ... $$` block's delimiter
- **Fix:** Changed outer block to `DO $outer$ ... END $outer$` and inner pg_cron SQL to `$cron$ ... $cron$`
- **Files modified:** `supabase/migrations/066_contact_imports.sql`
- **Result:** Migration applied cleanly on second push attempt

## Known Issues

None — migration applied cleanly. The pg_cron skip is documented behavior (not a failure), and the Storage bucket is a known manual step per plan constraints.

## Self-Check

- [x] `supabase/migrations/066_contact_imports.sql` exists (314 lines)
- [x] `npx supabase db push` exit 0
- [x] `contact_imports` table responds to REST API (HTTP 200)
- [x] `progress_percent` GENERATED ALWAYS AS STORED works (INSERT → 50)
- [x] Commit 22ded1d exists

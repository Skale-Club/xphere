---
phase: 106-merge-tool
plan: 01
subsystem: contacts-identity
tags: [migration, sql, security-definer, rls, merge-tool, audit]
wave: 1
requirements: [CID-04, CID-06]
dependency-graph:
  requires:
    - migration 1056 (contact_identity_audit) — provides identity_status column, contact_duplicate_audit table, refresh_contact_duplicate_audit() function
  provides:
    - merge_contacts(uuid, uuid) SECURITY DEFINER function
    - contact_merge_log table (deny-all RLS, audit trail)
    - contact_merge_exclusions table (org admin RLS, mark-as-separate pairs)
    - contacts.merged_into_contact_id self-FK column
    - _is_cluster_fully_excluded(uuid, uuid[]) helper
    - refresh_contact_duplicate_audit() replaced with exclusion-aware + archived-filter body
  affects:
    - Phase 106 Plan 02 (apply + validate)
    - Phase 106 Plan 03+ (admin UI consumes contact_duplicate_audit + calls merge_contacts RPC)
    - Phase 107 (UNIQUE constraints) — gates on refresh_contact_duplicate_audit excluding archived rows
tech-stack:
  added: []
  patterns:
    - "Explicit per-table UPDATE in SECURITY DEFINER function (no dynamic SQL, no pg_constraint loops)"
    - "Dedupe-then-delete join-table merge: INSERT ON CONFLICT DO NOTHING + DELETE"
    - "Canonical-order CHECK (a<b) on pairwise exclusion table"
    - "Deny-all RLS via ENABLE ROW LEVEL SECURITY + zero policies (service role + SECURITY DEFINER only)"
key-files:
  created:
    - supabase/migrations/1057_contact_merge_tool.sql
  modified: []
decisions:
  - "Migration filename chosen: 1057_contact_merge_tool.sql (Claude's discretion per CONTEXT)"
  - "contact_tags INSERT uses verified column list (contact_id, tag_id, tagged_at, tagged_by) — table has NO org_id per 060_tags_system.sql"
  - "Exclusion RLS policy references org_members.organization_id (not org_memberships.org_id per 106-PLAN inline SQL) — verified against 001_foundation.sql"
  - "Exclusion RLS policy uses role = 'admin' only — verified user_role enum is ('admin','member'); no 'owner' value exists"
metrics:
  duration: "~25 minutes"
  completed: 2026-05-25
  tasks_completed: 1
  files_created: 1
  commits: 1
---

# Phase 106 Plan 01: Author Merge Migration Summary

Authored migration `1057_contact_merge_tool.sql` delivering the full Phase 106 SQL surface (self-FK column, two new tables, three functions) in a single file mirroring Phase 105's pattern.

## What Was Built

- **`supabase/migrations/1057_contact_merge_tool.sql`** — single-file migration with 6 sections:
  1. `contacts.merged_into_contact_id` self-FK (nullable, ON DELETE SET NULL) + partial index
  2. `contact_merge_log` table (RLS enabled, NO policies → deny-all to authenticated; only service role + SECURITY DEFINER mutate)
  3. `contact_merge_exclusions` table with `CHECK (contact_id_a < contact_id_b)` + org admin RLS policies
  4. `merge_contacts(survivor_id uuid, archived_id uuid)` SECURITY DEFINER function with 4 guards, 6 direct UPDATEs, 2 join-table dedupe-then-delete blocks, archived-row marking, audit log insert
  5. `refresh_contact_duplicate_audit()` REPLACED with `identity_status <> 'archived_duplicate'` filter and NOT `_is_cluster_fully_excluded()` HAVING guard
  6. `_is_cluster_fully_excluded(org_id, contact_ids[])` STABLE helper using `unnest x unnest WHERE a.id < b.id` pair generation

## Sections Present (Confirmation)

| Section | Anchor | Present |
|---|---|---|
| 1. merged_into_contact_id column | `ADD COLUMN IF NOT EXISTS merged_into_contact_id` | yes |
| 2. contact_merge_log | `CREATE TABLE IF NOT EXISTS public.contact_merge_log` | yes |
| 3. contact_merge_exclusions | `CREATE TABLE IF NOT EXISTS public.contact_merge_exclusions` + `CHECK (contact_id_a < contact_id_b)` | yes |
| 4. merge_contacts | `CREATE OR REPLACE FUNCTION public.merge_contacts` | yes |
| 5. refresh_contact_duplicate_audit | `CREATE OR REPLACE FUNCTION public.refresh_contact_duplicate_audit` | yes |
| 6. _is_cluster_fully_excluded | `CREATE OR REPLACE FUNCTION public._is_cluster_fully_excluded` | yes |

## 8 FK Tables Enumerated in `merge_contacts` Body

| # | Table | Column | Pattern Used |
|---|---|---|---|
| 1 | `bookings` | `linked_contact_id` | Direct UPDATE |
| 2 | `call_logs` | `contact_id` | Direct UPDATE |
| 3 | `contact_tags` | `contact_id` | INSERT ON CONFLICT + DELETE (join table) |
| 4 | `conversations` | `contact_id` | Direct UPDATE |
| 5 | `opportunities` | `contact_id` | Direct UPDATE |
| 6 | `opportunity_contacts` | `contact_id` | INSERT ON CONFLICT + DELETE (join table) |
| 7 | `traffic_events` | `contact_id` | Direct UPDATE |
| 8 | `traffic_visitors` | `contact_id` | Direct UPDATE |

All 8 explicitly enumerated; no dynamic SQL.

## CRITICAL: SELECT INTO Variable Order

The first `SELECT ... INTO` in `merge_contacts` uses the **CORRECTED** variable order:

```sql
SELECT org_id, identity_status INTO survivor_org, survivor_status
  FROM public.contacts WHERE id = survivor_id FOR UPDATE;
```

NOT the RESEARCH.md skeleton typo (`survivor_org, archived_status`). Verified by the in-flight check script — `INTO survivor_org, archived_status` is absent from the file; `INTO survivor_org, survivor_status` is present. This was the load-bearing correction documented in 106-01-PLAN's IMPORTANT callout.

## Deviations from Plan (Author-Time Corrections)

While the plan correctly warned to read the actual migration files before writing the INSERTs, the inline SQL still required three corrections discovered during the `<read_first>` phase:

### 1. [Rule 1 — Bug] `contact_tags` has NO `org_id` column

- **Found during:** Task 1 read_first of `060_tags_system.sql`
- **Issue:** PLAN inline SQL wrote `INSERT INTO public.contact_tags (org_id, contact_id, tag_id)` — would fail on apply because `contact_tags` is `(contact_id, tag_id, tagged_at, tagged_by)` with PK `(contact_id, tag_id)`.
- **Fix:** Adjusted INSERT to verified column list: `(contact_id, tag_id, tagged_at, tagged_by)` preserving the original `tagged_at` and `tagged_by` from the archived row. PK `(contact_id, tag_id)` is the implicit conflict target so `ON CONFLICT DO NOTHING` resolves correctly.
- **Files modified:** `supabase/migrations/1057_contact_merge_tool.sql` (Section 4, join-table block)

### 2. [Rule 1 — Bug] Membership table name + column name

- **Found during:** Task 1 read_first of `001_foundation.sql`
- **Issue:** PLAN inline SQL used `public.org_memberships` with column `org_id` for the exclusion RLS INSERT policy. The actual table is `public.org_members` with column `organization_id`. PLAN would have failed on policy creation.
- **Fix:** Updated RLS policy to reference `public.org_members` with `organization_id = contact_merge_exclusions.org_id` and `user_id = auth.uid()`.
- **Files modified:** `supabase/migrations/1057_contact_merge_tool.sql` (Section 3, `contact_merge_exclusions_insert` policy)

### 3. [Rule 1 — Bug] `role` is an enum, not text

- **Found during:** Same read of `001_foundation.sql` (line 11: `CREATE TYPE public.user_role AS ENUM ('admin', 'member')`)
- **Issue:** PLAN suggested broadening to `role IN ('admin','owner')` if owner existed; verified no `'owner'` value in the enum.
- **Fix:** Kept policy as `role = 'admin'` (single value). Enum cast is implicit since literal is a valid enum label.
- **Files modified:** Same policy.

No architectural changes (no Rule 4). All corrections were table/column-name fact-checks that PLAN explicitly asked the executor to do.

## Authentication Gates Encountered

None. This plan is migration authoring only; no DB connection, API calls, or external tools required.

## Verification Results

Plan's `<automated>` probe (20 literal-string checks): **PASS**
Acceptance criteria literal-string checks (11 additional strings + `identity_status <> 'archived_duplicate'` count >= 2): **PASS** (3 occurrences found)

```
identity_status<>archived_duplicate count: 3
OK — all required SQL strings present
OK — all acceptance criteria literal strings present
```

## Confirmed Acceptance Criteria

- [x] File `supabase/migrations/1057_contact_merge_tool.sql` exists
- [x] `ADD COLUMN IF NOT EXISTS merged_into_contact_id`
- [x] `REFERENCES public.contacts(id) ON DELETE SET NULL`
- [x] `CREATE TABLE IF NOT EXISTS public.contact_merge_log`
- [x] `strategy IN ('manual','auto','import-dedup')`
- [x] `CREATE TABLE IF NOT EXISTS public.contact_merge_exclusions`
- [x] `CHECK (contact_id_a < contact_id_b)`
- [x] `CREATE OR REPLACE FUNCTION public.merge_contacts(`
- [x] `SECURITY DEFINER` (3 functions)
- [x] First `SELECT INTO` uses CORRECT order: `INTO survivor_org, survivor_status`
- [x] All 6 direct UPDATE statements present
- [x] Both join-table patterns (INSERT followed by DELETE) present
- [x] All 4 guards: same-id, archived-survivor, archived-target, cross-org
- [x] `INSERT INTO public.contact_merge_log` (audit log write)
- [x] `CREATE OR REPLACE FUNCTION public.refresh_contact_duplicate_audit()`
- [x] `identity_status <> 'archived_duplicate'` present 3 times in refresh body (twice for phone+email source filter, once in comment)
- [x] `_is_cluster_fully_excluded` defined and called from refresh HAVING
- [x] RLS enabled on both new tables
- [x] `contact_merge_exclusions_insert` policy requires `role = 'admin'`
- [x] NO policies on `contact_merge_log` (deny-all by absence)
- [x] `REVOKE ALL ... FROM public` + `GRANT EXECUTE ... TO authenticated` for `merge_contacts`

## Commit

| Hash | Message |
|---|---|
| db26eda | feat(106-01): author merge_contacts migration 1057 |

## Next Plan

Phase 106 Plan 02 will apply this migration against prod (via `npx supabase db push` or branch flow) and validate the schema landed correctly. No application code touches this migration; Plans 03+ build the admin UI on top of the schema landed here.

## Self-Check: PASSED

- Migration file exists: `supabase/migrations/1057_contact_merge_tool.sql` (FOUND)
- Commit `db26eda` exists in git log (FOUND)
- Plan's automated verification probe: PASS
- Extra acceptance-criteria check script: PASS

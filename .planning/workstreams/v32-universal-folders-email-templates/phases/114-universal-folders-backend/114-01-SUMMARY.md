---
phase: 114-universal-folders-backend
plan: 01
subsystem: database
tags: [postgres, supabase, rls, folders, migration, typescript]

# Dependency graph
requires: []
provides:
  - "public.folders table (org-scoped, entity-typed, self-referential) in the DB schema"
  - "Database['public']['Tables']['folders'] Row/Insert/Update/Relationships types"
affects: [115-workflows-repoint, 116-projects-tools-repoint, 117-email-templates-adoption, foldering-core]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single entity-typed folder store: one table + entity_type discriminator replaces per-entity folder tables"
    - "UNIQUE(org_id, entity_type, parent_id, name) — workflow_folders uniqueness scoped by entity_type"
    - "moddatetime trigger for updated_at (matches 1097 convention) instead of a bespoke touch function"

key-files:
  created:
    - supabase/migrations/1225_universal_folders.sql
  modified:
    - src/types/database.ts

key-decisions:
  - "Used migration number 1225 (tip was 1224_booking_status_showed.sql); CONTEXT's '1098' note was stale"
  - "Migration is additive only — creates public.folders + RLS/trigger/index; no ALTER on any existing table"
  - "entity_type CHECK constrained to workflow/project/tool/email_template, documented as extensible"

patterns-established:
  - "Universal folders: entity_type discriminator on a shared org-scoped table"
  - "moddatetime(updated_at) trigger convention for new folder rows"

requirements-completed: [UFE-01]

# Metrics
duration: ~7min
completed: 2026-07-02
---

# Phase 114 Plan 01: Universal Folders Backend Summary

**Additive `public.folders` migration (org-scoped, entity-typed, self-referential parent, RLS + moddatetime trigger + composite index) plus mirrored `folders` types in database.ts — no existing folder table touched.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-02T09:49:00Z (approx)
- **Completed:** 2026-07-02T09:56:00Z (approx)
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Created additive migration `1225_universal_folders.sql` defining `public.folders`: org-scoped FK to `organizations(id)` (cascade), `entity_type` discriminator with CHECK (`workflow`/`project`/`tool`/`email_template`), self-referential `parent_id` (cascade), `position`, `color`/`icon`, `created_by`, timestamps.
- Added org-scoped RLS policy (`org_id = get_current_org_id()` in both USING and WITH CHECK), `moddatetime(updated_at)` trigger, composite index `folders_org_entity_parent_pos_idx`, and `UNIQUE(org_id, entity_type, parent_id, name)`.
- Mirrored the table into `src/types/database.ts` as a `folders` Row/Insert/Update/Relationships block (with `entity_type` and self-referential `folders_parent_id_fkey`), leaving `workflow_folders` / `project_spaces` / `tool_folders` blocks untouched.
- `npm run build` (Turbopack production build + strict type check) exits 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Create additive migration 1225_universal_folders.sql** - `73aa84e8` (feat)
2. **Task 2: Add `folders` table types to src/types/database.ts** - `2820fe76` (feat)

## Files Created/Modified
- `supabase/migrations/1225_universal_folders.sql` - Creates `public.folders` with RLS, moddatetime trigger, composite index, entity_type CHECK, and UNIQUE constraint. Additive only.
- `src/types/database.ts` - Adds the `folders` table Row/Insert/Update/Relationships type block (placed adjacent to `workflow_folders`).

## Decisions Made
- **Migration number 1225** used after confirming the tip is `1224_booking_status_showed.sql` (`ls supabase/migrations/ | sort | tail -3`). The CONTEXT.md "next number is 1098" note was stale, as the plan warned.
- **moddatetime trigger** chosen for `updated_at` (matching the 1097 convention) rather than the older bespoke `touch_*_updated_at()` plpgsql function used by migration 100.
- **entity_type as a discriminator with a CHECK constraint** rather than a Postgres enum, so new modules can extend the allowed set with a simple constraint change.

## Deviations from Plan

None - plan executed exactly as written. Both tasks passed their automated verification blocks; no bugs, missing functionality, or blocking issues were encountered in the code changes.

## Issues Encountered

**`npx supabase db push` could not be applied in this environment (migration deferred to deploy time).**

- **What happened:** `npx supabase db push` failed with "Remote migration versions not found in local migrations directory" — the remote migration-history table contains versions (`20260615153927`, `20260625201926`, `20260701122750`, `20260701122808`, `20260701143859`) that are not present in the local `supabase/migrations/` directory. This is a pre-existing history desync unrelated to this plan's additive migration.
- **Why not forced:** The CLI's suggested remedies (`supabase migration repair` / `supabase db pull`) would rewrite unrelated migration history, which the plan's execution notes explicitly prohibit forcing. The Supabase MCP tools were not available in this executor's tool set, so the table could not be created out-of-band on `mwklvkmggmsintqcqfvu` either.
- **Resolution / deploy action required:** The migration file `supabase/migrations/1225_universal_folders.sql` is written and committed (`73aa84e8`). It is additive and safe. **Run `npx supabase db push` at deploy time** (after the migration-history desync is resolved via `supabase migration repair`/`db pull` on the correct production CRM project `mwklvkmggmsintqcqfvu`) to create `public.folders` in the remote DB. The file-creation acceptance criterion is satisfied; only the remote apply is deferred.

_Note: Task 1's `<automated>` verification (all schema/constraint/no-ALTER checks) passed; only the `npx supabase db push` acceptance line is deferred to deploy._

## User Setup Required

None - no external service configuration required. One deploy-time action: apply the committed migration with `npx supabase db push` once the remote migration history is reconciled (see Issues Encountered).

## Next Phase Readiness
- Schema + types foundation for the universal foldering milestone (UFE-01) is in place at the file/commit level; the `folders` table becomes live once `npx supabase db push` runs at deploy.
- Downstream phases (115 Workflows repoint, 116 Projects/Tools, 117 Email Templates) can type against `Database['public']['Tables']['folders']` now.
- **Deploy blocker to track:** the remote migration is not yet applied due to a pre-existing history desync — must be reconciled and pushed before any downstream phase writes to `folders`.

## Self-Check: PASSED

- FOUND: supabase/migrations/1225_universal_folders.sql
- FOUND: src/types/database.ts
- FOUND: .planning/workstreams/v32-universal-folders-email-templates/phases/114-universal-folders-backend/114-01-SUMMARY.md
- FOUND commit: 73aa84e8 (Task 1)
- FOUND commit: 2820fe76 (Task 2)

---
*Phase: 114-universal-folders-backend*
*Completed: 2026-07-02*

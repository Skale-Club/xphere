---
phase: 19-db-foundation
plan: "01"
subsystem: database
tags: [postgresql, supabase, rls, migration, vitest]

# Dependency graph
requires:
  - phase: 07-db-foundation
    provides: "google_reviews migration pattern (018) used as RLS model"
  - phase: 15-refactor
    provides: "tool_folders_labels (016) and org_folder_order (017) migrations being replaced"

provides:
  - "025_tool_folders.sql migration: relational tool_folders table replacing flat folder TEXT column"
  - "RLS policy org_isolation on tool_folders with FOR ALL + get_current_org_id() subquery form"
  - "tool_configs.folder_id UUID FK with ON DELETE SET NULL"
  - "Data migration: folder names from organizations.tool_folder_order and orphan tool_configs.folder values"
  - "tests/tools/actions.test.ts stub with 4 describe blocks (getFolders, createFolder, updateFolder, deleteFolder)"

affects:
  - 19-02 (server actions must reference tool_folders table after migration applies)
  - 19-03 (TypeScript types update depends on migration schema)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "UNIQUE NULLS NOT DISTINCT (PG15+) for nullable parent_id unique constraint"
    - "Two-step data migration: insert from array column then back-fill FK"
    - "Vitest it.todo() stubs for pre-implementation test scaffolding"

key-files:
  created:
    - supabase/migrations/025_tool_folders.sql
    - tests/tools/actions.test.ts
  modified: []

key-decisions:
  - "Used UNIQUE NULLS NOT DISTINCT (PG15+) for top-level folder uniqueness; fallback partial index documented in migration comments"
  - "Migration deferred push (SUPABASE_DB_PASSWORD auth gate) — file committed, push pending user action"

patterns-established:
  - "Two-step INSERT migration: canonical order array first, orphan strings second via NOT EXISTS subquery"

requirements-completed: []

# Metrics
duration: 6min
completed: "2026-05-06"
---

# Phase 19 Plan 01: DB Foundation Summary

**SQL migration 025 adds relational tool_folders table with RLS and self-referencing hierarchy, migrating flat folder TEXT and organizations.tool_folder_order array data before dropping both superseded columns**

## Performance

- **Duration:** 6 min
- **Started:** 2026-05-06T14:20:18Z
- **Completed:** 2026-05-06T14:25:33Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Created `tests/tools/actions.test.ts` with 4 describe blocks (getFolders, createFolder, updateFolder, deleteFolder) using `it.todo()` — all 17 cases run cleanly under Vitest
- Wrote `025_tool_folders.sql` with complete table definition, RLS (`org_isolation` FOR ALL), `updated_at` trigger, FK addition to `tool_configs`, two-step data migration (from `tool_folder_order` array and orphan `tool_configs.folder` strings), and column drops
- Build passes green (npm run build) — no TypeScript errors introduced

## Task Commits

Each task was committed atomically:

1. **Task 1: Create test stub for tools/actions server actions** - `c2ff599` (test)
2. **Task 2: Write migration 025_tool_folders.sql** - `9619633` (chore)

**Plan metadata:** `5bf68f6` (docs: complete tool-folders db foundation plan)

## Files Created/Modified
- `tests/tools/actions.test.ts` - Vitest stub with todo cases for getFolders, createFolder, updateFolder, deleteFolder
- `supabase/migrations/025_tool_folders.sql` - Complete migration: tool_folders table, RLS, trigger, FK, data migration, column drops

## Decisions Made
- Used `UNIQUE NULLS NOT DISTINCT (org_id, parent_id, name)` (PG15+ syntax) for correct NULL-equality semantics on top-level folders; fallback two-constraint approach documented in comments
- Migration file committed without `db push` due to `SUPABASE_DB_PASSWORD` auth gate — follows established project pattern from MEMORY.md (same deferral as migrations 018-020)

## Deviations from Plan

None - plan executed exactly as written. The `npx supabase db push` auth gate is a known, pre-existing project constraint (SUPABASE_DB_PASSWORD not set in shell environment).

## Issues Encountered

**Auth gate: SUPABASE_DB_PASSWORD required for `npx supabase db push`**

The Supabase CLI requires `SUPABASE_DB_PASSWORD` to push migrations to remote. This env var is not set in the current shell. The migration file `025_tool_folders.sql` is correctly written and committed.

To apply:
```bash
# Get DB password from: Supabase Dashboard → Project Settings → Database
export SUPABASE_DB_PASSWORD=your_password
npx supabase db push
```

This follows the same pattern as migrations 018-020 (documented in MEMORY.md reminder_db_push.md).

## User Setup Required

**Action needed before Phase 19-02/03 can proceed:**

1. Go to Supabase Dashboard → Project `mwklvkmggmsintqcqfvu` → Settings → Database
2. Copy the database password
3. Run: `npx supabase db push -p YOUR_DB_PASSWORD` (or set `SUPABASE_DB_PASSWORD` env var)
4. After push succeeds, update `src/types/database.ts` to:
   - Add `tool_folders` table type entry
   - Remove `folder: string | null` from `tool_configs` Row/Insert/Update
   - Add `folder_id: string | null` to `tool_configs` Row/Insert/Update
   - Remove `tool_folder_order: string[]` from `organizations` Row/Insert/Update

## Next Phase Readiness
- Migration file is written and committed — ready to push once DB password is available
- Test stub satisfies Nyquist validation rule
- Phase 19-02 (server actions) and 19-03 (TypeScript types) blocked until migration is applied to remote DB

---
*Phase: 19-db-foundation*
*Completed: 2026-05-06*

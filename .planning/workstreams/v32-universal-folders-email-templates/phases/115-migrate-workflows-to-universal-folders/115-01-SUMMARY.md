---
phase: 115-migrate-workflows-to-universal-folders
plan: 01
subsystem: database
tags: [postgres, migration, folders, workflows, foreign-key]

# Dependency graph
requires:
  - phase: 114-universal-folders-backend
    provides: "public.folders table (entity-typed universal folder store) via migration 1225"
provides:
  - "Migration 1226: UUID-preserving copy of workflow_folders into folders (entity_type='workflow')"
  - "workflows.folder_id FK repointed to folders(id) on delete set null"
  - "workflow_folders retired via RENAME to workflow_folders_deprecated (safety net, not dropped)"
  - "PENDING-MIGRATIONS.md ledger entry for 1226 (apply order, risk, parity verify query)"
affects: [115-02, 116-migrate-projects-tools, deploy-of-phase-115-code]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "UUID-preserving data migration: copy rows with original ids so downstream FKs stay valid"
    - "Retire-not-drop: RENAME legacy table to _deprecated until post-apply parity confirmed"

key-files:
  created:
    - supabase/migrations/1226_migrate_workflow_folders.sql
  modified:
    - .planning/workstreams/v32-universal-folders-email-templates/PENDING-MIGRATIONS.md

key-decisions:
  - "Migration written as a FILE only, NOT applied (code-only mode; prod writes gated + migration-history desync blocks db push)"
  - "Reference audit confirmed only one inbound FK (workflows.folder_id) references workflow_folders — three-step migration is complete, no extra repoints needed"
  - "on conflict (id) do nothing makes the copy idempotent/re-runnable"

patterns-established:
  - "Pattern: preserve UUIDs on folder copy so workflows.folder_id references survive unchanged"
  - "Pattern: RENAME to _deprecated leaves a rollback safety net; DROP deferred to a later phase after parity"

requirements-completed: [UFE-03]

# Metrics
duration: 1min
completed: 2026-07-02
---

# Phase 115 Plan 01: Write Workflow-Folders Data Migration Summary

**Migration 1226 copies `workflow_folders` → `folders` (entity_type='workflow') preserving UUIDs, repoints `workflows.folder_id` FK to `folders(id)`, and retires the legacy table via RENAME — written as a committed file, not applied.**

## Performance

- **Duration:** ~1 min
- **Started:** 2026-07-02T15:45:26Z
- **Completed:** 2026-07-02T15:46:31Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Wrote `supabase/migrations/1226_migrate_workflow_folders.sql` verbatim from CONTEXT.md: three steps (UUID-preserving copy, FK repoint, RENAME to `_deprecated`).
- Confirmed next migration number is 1226 (tip is `1225_universal_folders.sql`).
- Recorded the 1226 entry in the workstream PENDING-MIGRATIONS ledger with apply order (AFTER 1225, BEFORE deploy), MEDIUM-HIGH risk classification, and a parity verify query.
- Zero production DB writes performed — the migration is a committed file only, applied later interactively.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the 1226 workflow-folders migration file** - `0104f7b2` (feat)
2. **Task 2: Append the 1226 entry to PENDING-MIGRATIONS.md** - `b0c38fbc` (docs)

## Files Created/Modified
- `supabase/migrations/1226_migrate_workflow_folders.sql` - UUID-preserving copy of `workflow_folders` into `folders`, FK repoint on `workflows.folder_id`, RENAME `workflow_folders` → `workflow_folders_deprecated`.
- `.planning/workstreams/v32-universal-folders-email-templates/PENDING-MIGRATIONS.md` - New section 2 documenting migration 1226 (status, what, order, risk, verify query).

## Decisions Made
- Migration written as a file only, never applied — consistent with the workstream's code-only mode (prod writes gated + a pre-existing migration-history desync blocks `supabase db push`).
- No extra FK repoint statements added: the reference audit in the plan confirmed `workflows.folder_id` is the sole inbound FK to `workflow_folders` (the `parent_id` self-FK moves with the table on RENAME; the 1160_agent_groups.sql reference is a comment only).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. The migration must be applied to production interactively per PENDING-MIGRATIONS.md before the Phase 115 code deploys, but that is a deferred deploy step, not setup.

## Next Phase Readiness
- The migration file exists and is committed; 115-02 (code swap) can proceed to point runtime code at `folders`.
- Deferred: migration 1226 must be applied to prod (AFTER 1225) before the Phase 115 code is deployed; parity verify query recorded in the ledger.

## Self-Check: PASSED

- FOUND: `supabase/migrations/1226_migrate_workflow_folders.sql`
- FOUND: commit `0104f7b2` (Task 1)
- FOUND: commit `b0c38fbc` (Task 2)

---
*Phase: 115-migrate-workflows-to-universal-folders*
*Completed: 2026-07-02*

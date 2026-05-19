---
phase: 76-db-foundation
plan: 02
subsystem: database
tags: [postgres, supabase, migrations, typescript, rls, enums]

# Dependency graph
requires:
  - phase: 76-01
    provides: tasks table + crm_entity_type/task_priority/task_status enums defined in 067

provides:
  - notes table DDL with RLS and updated_at trigger (migration 068)
  - TypeScript types for tasks table (Row/Insert/Update with TaskPriority, TaskStatus, CrmEntityType)
  - TypeScript types for notes table (Row/Insert/Update)
  - Exported type aliases: TaskPriority, TaskStatus, CrmEntityType

affects: [77-tasks-actions, 79-notes-actions, 81-entity-integration]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "crm_entity_type polymorphic enum shared between tasks and notes — defined once in 067, referenced in 068"
    - "notes.title nullable; notes.content required — UI falls back to first line of content"
    - "TypeScript type aliases exported alongside Database interface for direct use in actions"

key-files:
  created:
    - supabase/migrations/068_notes.sql
  modified:
    - src/types/database.ts

key-decisions:
  - "notes.title is intentionally nullable — title is optional per NOT-01; UI falls back to content excerpt"
  - "crm_entity_type enum not redefined in 068 — reuses the enum created in 067 to avoid duplicate-type errors"
  - "entity_id has no FK constraint — polymorphic reference to contacts/accounts/opportunities enforced at application layer"
  - "Full-text GIN index on notes (title + content) added in anticipation of NOT-06 search requirement"
  - "TaskPriority, TaskStatus, CrmEntityType exported as standalone type aliases for ergonomic use in server actions"

patterns-established:
  - "Polymorphic entity linkage: entity_type (enum) + entity_id (uuid) pair with no FK, app-layer validation — same pattern as tasks"

requirements-completed: [TSK-01, TSK-09, TSK-12, NOT-01, NOT-08, NOT-11]

# Metrics
duration: 8min
completed: 2026-05-18
---

# Phase 76 Plan 02: Migration 068 notes table + TypeScript types for tasks and notes Summary

**notes table (10 cols) with org-isolation RLS + GIN search index, plus TypeScript Row/Insert/Update types for both tasks and notes wired into database.ts**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-18T23:00:00Z
- **Completed:** 2026-05-18T23:08:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Created `supabase/migrations/068_notes.sql` with the notes table (10 columns), 4 indexes, RLS org-isolation policy, and updated_at trigger — reuses crm_entity_type enum from 067 without redefining it
- Updated `src/types/database.ts` with `TaskPriority`, `TaskStatus`, `CrmEntityType` exported type aliases plus full `tasks` and `notes` entries (Row/Insert/Update/Relationships) inside the Tables object and the Enums block
- `npm run build` exits 0 — TypeScript check passed with no errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 068 — notes table and RLS** - `115a502` (feat)
2. **Task 2: Update src/types/database.ts — add tasks and notes table types** - `dc5cc51` (feat)

**Plan metadata:** (docs commit follows)

## Files Created/Modified

- `supabase/migrations/068_notes.sql` - notes table DDL with RLS policy (notes_org_isolation) and updated_at trigger; 4 indexes including GIN full-text on title+content
- `src/types/database.ts` - added TaskPriority/TaskStatus/CrmEntityType exports; tasks + notes entries in Tables; task_priority/task_status/crm_entity_type in Enums

## Decisions Made

- **notes.title nullable:** NOT-01 specifies title as optional; UI will fall back to first line of content for display. content is the required field.
- **crm_entity_type not redefined in 068:** Enum is created with an idempotent DO $$ block in 067 and simply referenced as `public.crm_entity_type` in the 068 column definition to avoid duplicate type errors on re-run.
- **No FK on entity_id:** Polymorphic reference pattern — same as tasks in 067. Application layer enforces referential integrity.
- **GIN full-text index added:** Added proactively in anticipation of NOT-06 (search) requirement; cost is negligible at current scale.
- **Standalone TypeScript type aliases:** TaskPriority, TaskStatus, CrmEntityType exported as top-level types (not only inline in Database interface) so server actions can import them directly without deep Database['public']['Enums'] path.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

After this plan, run:
```bash
npx supabase db push
```
This applies migration 068 to the remote Supabase database.

## Next Phase Readiness

- Phase 77 (TASKS-ACTIONS): tasks table exists, TypeScript types correct — ready to write server actions
- Phase 79 (NOTES-ACTIONS): notes table exists, TypeScript types correct — ready to write server actions
- Both tables have RLS policies in place; org scoping is handled automatically by get_current_org_id()

## Self-Check: PASSED

- FOUND: supabase/migrations/068_notes.sql
- FOUND: src/types/database.ts
- FOUND commit 115a502 (migration 068)
- FOUND commit dc5cc51 (database.ts types)
- npm run build exits 0

---
*Phase: 76-db-foundation*
*Completed: 2026-05-18*

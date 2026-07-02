---
phase: 116-migrate-projects-tools-to-universal-folders
plan: 02
subsystem: database
tags: [migration, supabase, folders, projects, tools, foreign-keys]

# Dependency graph
requires:
  - phase: 114-universal-folders-core
    provides: public.folders table (entity-typed universal folder store)
  - phase: 115-migrate-workflows-to-universal-folders
    provides: sibling migration 1226 (workflow_folders -> folders) — same copy/repoint/rename shape
provides:
  - "Migration 1227: project_spaces -> folders (entity_type='project') and tool_folders -> folders (entity_type='tool'), UUID-preserving"
  - "projects.space_id and tool_configs.folder_id FKs repointed to folders(id)"
  - "Both legacy tables renamed _deprecated (retired, not dropped)"
  - "PENDING-MIGRATIONS.md ## 3. entry with apply order + parity verify queries"
affects: [116-03-projects-swap, 116-04-tools-swap]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "UUID-preserving copy -> FK repoint -> RENAME-to-_deprecated migration shape (mirrors 1226) so item-column references stay valid and a rollback safety net remains"

key-files:
  created:
    - supabase/migrations/1227_migrate_project_tool_folders.sql
  modified:
    - .planning/workstreams/v32-universal-folders-email-templates/PENDING-MIGRATIONS.md

key-decisions:
  - "Migration written but NOT applied (code-only mode; prod writes gated by harness + migration-history desync) — recorded in PENDING-MIGRATIONS.md instead"
  - "No extra FK repoints added beyond the two item columns — planning grep confirmed only self-referential parent_id FKs and the two item-column FKs reference the legacy tables"

patterns-established:
  - "Data migrations for v3.2 are committed as files + logged in the workstream PENDING-MIGRATIONS ledger with apply order, risk, and parity verify queries; applied later in an interactive session"

requirements-completed: [UFE-04, UFE-05]

# Metrics
duration: 3min
completed: 2026-07-02
---

# Phase 116 Plan 02: Project + Tool Folders Migration Summary

**Migration 1227 copies `project_spaces` and `tool_folders` into the universal `public.folders` store (entity_type='project'/'tool') preserving UUIDs, repoints `projects.space_id` and `tool_configs.folder_id` FKs to `folders(id)`, and renames both legacy tables `_deprecated` — written and committed but not applied (logged in PENDING-MIGRATIONS.md).**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-07-02T12:13:00Z
- **Completed:** 2026-07-02T12:15:00Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Wrote `supabase/migrations/1227_migrate_project_tool_folders.sql` verbatim from CONTEXT: two UUID-preserving copies (`insert ... on conflict (id) do nothing`), two FK repoints to `folders(id)` with `on delete set null`, and two `rename ... _deprecated` statements.
- Projects copy carries color/icon/created_by; tools copy nulls color/icon/created_by (source `tool_folders` lacks those columns).
- Both possible project FK names (`projects_folder_id_fkey`, `projects_space_id_fkey`) dropped `if exists` before re-adding `projects_space_id_fkey`.
- Appended a `## 3.` entry to PENDING-MIGRATIONS.md with apply order (after 1226, before deploy), MEDIUM-HIGH risk note, and both parity verify queries.
- No `db push` / `apply_migration` run — code-only as required.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 1227 (copy -> repoint FKs -> rename _deprecated)** - `b1e9bd31` (feat)
2. **Task 2: Append the 1227 entry to the pending-migrations ledger** - `d0093c18` (docs)

## Files Created/Modified
- `supabase/migrations/1227_migrate_project_tool_folders.sql` - UUID-preserving copy of project_spaces + tool_folders into folders, FK repoints, rename-to-_deprecated.
- `.planning/workstreams/v32-universal-folders-email-templates/PENDING-MIGRATIONS.md` - New `## 3.` entry documenting how/when to apply 1227 + parity verification.

## Decisions Made
- Migration committed but NOT applied — v3.2 runs in code-only mode (prod DB writes gated by the harness + a pre-existing migration-history desync). Recorded in the pending ledger for a later interactive apply.
- No extra FK repoint statements added: the planning-phase grep confirmed only self-referential `parent_id` FKs (handled by copying into `folders`, whose own `parent_id` references `folders(id)`) and the two item-column FKs reference the legacy tables.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Git warned about LF→CRLF conversion (Windows line endings) on both commits — cosmetic, no impact.

## User Setup Required
None automated. Deferred DB apply: this migration must be applied to production CRM (`mwklvkmggmsintqcqfvu`) AFTER 1226 and BEFORE deploying Phase 116 code, then parity verified per PENDING-MIGRATIONS.md ## 3.

## Next Phase Readiness
- Schema half of Phase 116 is written. Wave 2 (plans 116-03 Projects swap, 116-04 Tools swap) can now rewrite the module actions/layouts against `folders`, relying on this migration's UUID-preserving copy.
- Blocker for runtime parity (not for wave-2 code work): migration 1227 must be applied before the Phase 116 code is deployed.

## Self-Check: PASSED

- `supabase/migrations/1227_migrate_project_tool_folders.sql` — FOUND
- `.planning/.../PENDING-MIGRATIONS.md` — FOUND
- `116-02-SUMMARY.md` — FOUND
- Commit `b1e9bd31` — FOUND
- Commit `d0093c18` — FOUND

---
*Phase: 116-migrate-projects-tools-to-universal-folders*
*Completed: 2026-07-02*

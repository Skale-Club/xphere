---
phase: 116-migrate-projects-tools-to-universal-folders
plan: 01
subsystem: database
tags: [foldering, projects, tools, supabase, typescript]

# Dependency graph
requires:
  - phase: 114-universal-folders-core
    provides: shared foldering/core.ts (FolderingContext + move/reorder item logic)
  - phase: 115-migrate-workflows-to-universal-folders
    provides: workflow 'use server' wrappers that bind FolderingContext (default folder_id)
provides:
  - "itemFolderColumn?: string on FolderingContext (default 'folder_id')"
  - "moveItemToFolder reads + writes the folder-linkage column dynamically"
  - "Projects can delegate to core with itemFolderColumn: 'space_id'"
affects: [116-03-projects-swap, 116-04-tools-swap]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Config-driven column name on FolderingContext so item tables whose folder column isn't named folder_id can still delegate to the shared core"

key-files:
  created: []
  modified:
    - src/lib/foldering/core.ts

key-decisions:
  - "Only moveItemToFolder needed changing; reorderItemsInFolder never references the folder column (only position + id) so it stays untouched to avoid churn"
  - "archiveFolder/deleteFolder keep hardcoded 'folder_id' — Projects does its cascade in its own wrapper (116-03), so generalizing them would be premature"

patterns-established:
  - "Optional itemFolderColumn on FolderingContext, resolved via ctx.itemFolderColumn ?? 'folder_id' — backward-compatible with all existing default-column consumers"

requirements-completed: [UFE-04, UFE-05]

# Metrics
duration: 4min
completed: 2026-07-02
---

# Phase 116 Plan 01: Foldering core itemFolderColumn Summary

**Optional `itemFolderColumn` on `FolderingContext` (default `'folder_id'`) lets `moveItemToFolder` read and write a non-default folder-linkage column, so Projects can delegate to the shared core with `space_id`.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-07-02T12:09:00Z
- **Completed:** 2026-07-02T12:13:00Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments
- Added optional `itemFolderColumn?: string` to `FolderingContext` with a doc comment noting Projects override it with `'space_id'`.
- `moveItemToFolder` now resolves `const col = ctx.itemFolderColumn ?? 'folder_id'` once and uses it for both the tail-position `.eq(col, ...)` read filter and the `.update({ [col]: folderId, ... })` write.
- Purely additive — no existing caller passes `itemFolderColumn`, so Workflows (115), Tools, and Email continue writing `folder_id` unchanged.
- `npm run build` exits 0.

## Task Commits

Each task was committed atomically:

1. **Task 1: Add itemFolderColumn to FolderingContext and use it in moveItemToFolder** - `12edd6c0` (feat)

## Files Created/Modified
- `src/lib/foldering/core.ts` - Added `itemFolderColumn?: string` to `FolderingContext`; `moveItemToFolder` reads/writes the dynamic column via `ctx.itemFolderColumn ?? 'folder_id'`.

## Decisions Made
- `reorderItemsInFolder` left unchanged: it only touches `position` and `id`, never the folder column, so no generalization was needed (plan explicitly warned against adding churn there).
- `archiveFolder` / `deleteFolder` `.in('folder_id', ...)` calls left hardcoded — Projects runs its archive/delete cascade in its own wrapper (`spaces.ts`, plan 116-03) against `projects.space_id` directly, so generalizing the core's cascade would over-scope this plan.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Git warned about LF→CRLF conversion on commit (Windows line endings) — cosmetic, no impact.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Core now supports non-default item folder columns; plan 116-03 (Projects swap) can pass `itemFolderColumn: 'space_id'`, and plan 116-04 (Tools swap) uses the default.
- No blockers.

## Self-Check: PASSED

- `src/lib/foldering/core.ts` — FOUND
- `116-01-SUMMARY.md` — FOUND
- Commit `12edd6c0` — FOUND

---
*Phase: 116-migrate-projects-tools-to-universal-folders*
*Completed: 2026-07-02*

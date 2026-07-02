---
phase: 115-migrate-workflows-to-universal-folders
plan: 02
subsystem: api
tags: [next-server-actions, folders, workflows, supabase, refactor]

# Dependency graph
requires:
  - phase: 114-universal-folders-backend
    provides: "src/lib/foldering/core.ts shared folder + item organization contract"
  - phase: 115-01
    provides: "Migration 1226 (workflow_folders -> folders) — file committed, applied at deploy"
provides:
  - "Workflows layout reads folders from public.folders filtered by entity_type='workflow'"
  - "Folder CRUD/reorder/move/archive/delete actions delegate to the shared foldering core"
  - "moveWorkflowToFolder / reorderWorkflowsInFolder delegate to core.moveItemToFolder / core.reorderItemsInFolder"
  - "Export names + signatures + return shapes preserved — workflow-sub-nav.tsx untouched, build green"
affects: [116-migrate-projects-tools, 117-email-templates-sub-sidebar]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Thin 'use server' wrappers over @/lib/foldering/core: auth gate + revalidatePath stay in the wrapper, CRUD/cascade in the core"
    - "FolderRow (folders Row) is a structural superset of the old workflow_folders Row, so the WorkflowFolderRow alias re-points with zero downstream edits"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/workflows/_actions/folders.ts
    - src/app/(dashboard)/workflows/_actions/workflows.ts
    - src/app/(dashboard)/workflows/layout.tsx

key-decisions:
  - "Reworded a code comment to drop the literal 'workflow_folders' so folders.ts contains zero occurrences of the legacy table name (matches acceptance criteria)"
  - "database.ts workflow_folders type block left intentionally (maps to renamed _deprecated table post-1226; harmless/unused)"
  - "Runtime/data parity is deferred to post-migration-apply human-verify — cannot be checked until 1226 runs"

patterns-established:
  - "Pattern: per-module folder actions are thin wrappers binding a FolderingContext { entityType, itemTable } and delegating to the universal core"
  - "Pattern: preserve exported action names/signatures/return shapes so shared UI (DraggableTreeNav) needs no edits during a backend swap"

requirements-completed: [UFE-03]

# Metrics
duration: 6min
completed: 2026-07-02
---

# Phase 115 Plan 02: Swap Workflows onto Universal Folders Summary

**Workflows folder reads/writes now go through `src/lib/foldering/core.ts` (entity_type='workflow'); the layout queries `folders` and all folder actions are thin core-delegating wrappers, with the sub-nav untouched and `npm run build` green.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-02T15:47:20Z
- **Completed:** 2026-07-02T15:53:05Z
- **Tasks:** 3 (2 code + 1 verification)
- **Files modified:** 3

## Accomplishments
- Rewrote `_actions/folders.ts` (all 8 exports: listFolders, createFolder, renameFolder, updateFolderMeta, reorderFolders, moveFolder, archiveFolder, deleteFolder) as thin `'use server'` wrappers delegating to `@/lib/foldering/core` bound to `{ entityType: 'workflow', itemTable: 'workflows' }`; auth gate + `revalidatePath('/workflows')` preserved.
- Delegated `moveWorkflowToFolder` → `core.moveItemToFolder` and `reorderWorkflowsInFolder` → `core.reorderItemsInFolder` in `_actions/workflows.ts`, leaving the 7 other lifecycle actions untouched.
- Swapped the `layout.tsx` folders fetch from `.from('workflow_folders')` to `.from('folders').eq('entity_type','workflow')`, and re-pointed the `WorkflowFolderRow` type alias to the `folders` Row (structural superset).
- `npm run build` exits 0 (no type errors) — confirms the `FolderRow` superset-compatibility and the core delegations type-check.
- `grep -rn "workflow_folders" src/` reduces to only the two generated `src/types/database.ts` type-block lines; no runtime code queries the legacy table.

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite _actions/folders.ts as thin core delegations** - `da264346` (refactor)
2. **Task 2: Delegate folder actions in workflows.ts + swap layout.tsx fetch** - `61a85882` (refactor)
3. **Task 3: Build passes / no stray workflow_folders query** - verification only, no commit

## Files Created/Modified
- `src/app/(dashboard)/workflows/_actions/folders.ts` - 8 folder actions rewritten as thin wrappers over the foldering core; `WorkflowFolderRow` re-aliased to `FolderRow`.
- `src/app/(dashboard)/workflows/_actions/workflows.ts` - `moveWorkflowToFolder` + `reorderWorkflowsInFolder` delegate to core; added a private `folderCtx()` helper.
- `src/app/(dashboard)/workflows/layout.tsx` - folders fetch queries `folders` with `entity_type='workflow'`; type alias re-pointed to the `folders` Row.

## Decisions Made
- Reworded the `WorkflowFolderRow` comment in `folders.ts` to avoid the literal string `workflow_folders`, satisfying the acceptance criterion that the file contains zero occurrences of the legacy table name.
- Left the `workflow_folders` type block in `src/types/database.ts` as instructed — after migration 1226 it maps to the renamed `_deprecated` table; harmless and unused once code stops querying it.

## Deviations from Plan

None - plan executed exactly as written (the comment rewording is a wording adjustment to meet the stated acceptance criterion, not a behavioral change).

## Issues Encountered
- The Task-1 automated verify (`! grep -q "workflow_folders"`) initially failed because the phrase appeared in a code comment. Resolved by rewording the comment; no logic changed.
- The build log emits `[redis] error:` noise during static generation (Redis unreachable in this environment). Pre-existing, unrelated to these type-only changes, out of scope — build still exits 0.

## User Setup Required
None - no external service configuration required.

**Deferred (cannot verify until migration 1226 is applied — human-verify, NOT a gap):** existing production folders appear unchanged in the sidebar; create/rename/color/icon/nest/move/reorder/archive/delete/trash all work end-to-end. Verify post-apply per PENDING-MIGRATIONS.md.

## Next Phase Readiness
- Workflows are fully swapped onto the universal `folders` store; Phase 116 (Projects + Tools) can follow the same wrapper-over-core pattern.
- Blocker for deploy: migration 1226 must be applied to production (AFTER 1225) before this code ships — the swapped layout/actions query `folders` and would return empty until the copy runs.

## Self-Check: PASSED

- FOUND: `src/app/(dashboard)/workflows/_actions/folders.ts`
- FOUND: `src/app/(dashboard)/workflows/_actions/workflows.ts`
- FOUND: `src/app/(dashboard)/workflows/layout.tsx`
- FOUND: commit `da264346` (Task 1)
- FOUND: commit `61a85882` (Task 2)
- Build: `npm run build` exits 0
- `grep -rn "workflow_folders" src/` → only `src/types/database.ts` (2 generated-type lines)

---
*Phase: 115-migrate-workflows-to-universal-folders*
*Completed: 2026-07-02*

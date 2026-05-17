---
phase: 21-drag-and-drop
plan: 01
subsystem: tools-server-actions
tags: [server-actions, supabase, tool-folders, drag-and-drop, typescript]

# Dependency graph
requires:
  - phase: 20-folder-subfolder-crud
    provides: deleteFolderWithTools action; tool_folders.position column; folder_id FK on tool_configs
provides:
  - reorderFolders(orderedIds: string[]) exported from actions.ts
  - moveToolToFolder(toolId: string, folderId: string | null) exported from actions.ts
  - test stubs for both actions in tests/tools/actions.test.ts
affects: [21-02-PLAN.md (UI DnD plan consumes both new actions)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "reorderFolders: bulk Promise.all of N supabase .update({ position }) calls — single server round-trip"
    - "moveToolToFolder: targeted single-field update on tool_configs, avoids full-payload updateToolConfig"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/tools/actions.ts
    - tests/tools/actions.test.ts

key-decisions:
  - "reorderFolders uses Promise.all of N individual supabase updates (not RPC) — simpler, consistent with existing pattern; N is small (<20 folders typical)"
  - "moveToolToFolder is a new focused action rather than calling updateToolConfig with partial data — avoids silent field-wipe bug documented in research"

# Metrics
duration: 3min
completed: 2026-05-06
---

# Phase 21 Plan 01: Server Actions for DnD Persistence Summary

**reorderFolders and moveToolToFolder exported server actions added to actions.ts for Phase 21 DnD persistence**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-05-06T13:20:00Z
- **Completed:** 2026-05-06T13:23:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Appended `reorderFolders(orderedIds: string[])` to actions.ts: auth-gated, early-returns for empty array, bulk-updates `tool_folders.position` for each id via `Promise.all`, revalidates `/tools`
- Appended `moveToolToFolder(toolId, folderId)` to actions.ts: auth-gated, targeted `tool_configs.folder_id` update (accepts `null` for ungrouped), revalidates `/tools`
- Added 2 new `describe` blocks with 5 `it.todo` stubs each to `tests/tools/actions.test.ts`
- Build passes with no TypeScript errors; vitest run exits 0 with 34 todos

## Task Commits

1. **Task 1: Add reorderFolders and moveToolToFolder server actions** - `99aa225` (feat)
2. **Task 2: Add reorderFolders and moveToolToFolder test stubs** - `cc3730a` (test)

## Files Created/Modified

- `src/app/(dashboard)/tools/actions.ts` - Two new exported async functions appended after `deleteToolConfig`
- `tests/tools/actions.test.ts` - Two new describe blocks with 10 total it.todo stubs appended after `deleteFolderWithTools`

## Decisions Made

- `reorderFolders` uses `Promise.all` of N individual Supabase `.update()` calls rather than a stored procedure/RPC — consistent with the existing `updateFolder` pattern; folder count is bounded (<20 typical)
- `moveToolToFolder` is a new focused action instead of calling `updateToolConfig` with full payload — avoids the silent field-wipe pitfall documented in 21-RESEARCH.md (Pitfall 5)

## Deviations from Plan

**Note on merge:** The worktree was behind `main` by 28 commits (Phases 19–20 work). A `git merge main` was performed before execution so the worktree had the correct base (actions.ts with 10 existing exports, test file with 5 existing describe blocks). This is infrastructure, not a plan deviation.

**Function count discrepancy:** The plan's verification criterion says `grep -c "export async function"` should return 9 (was 7, +2). Actual result is 12 (was 10 after merge, +2). The plan was written against the state before Phase 19-20 exports landed. The two new exports are correctly added — the count discrepancy is explained by the merge catch-up.

None — plan executed exactly as written (after merge).

## Known Stubs

None. Both new functions are fully implemented. The `it.todo` stubs in the test file are intentional scaffolding (per plan spec) for future implementation.

---
*Phase: 21-drag-and-drop*
*Completed: 2026-05-06*

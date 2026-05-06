---
phase: 21-drag-and-drop
plan: 02
subsystem: ui
tags: [dnd-kit, react, drag-and-drop, tools-table, server-actions, typescript]

# Dependency graph
requires:
  - phase: 21-drag-and-drop
    plan: 01
    provides: reorderFolders and moveToolToFolder server actions in actions.ts
  - phase: 20-folder-subfolder-crud
    provides: tools-table.tsx with SortableFolderHeader, SubfolderHeader, DndContext scaffold
provides:
  - DraggableToolRow component with useDraggable grip overlay in tools-table.tsx
  - Full DnD event handlers: handleDragStart, handleDragOver, handleDragCancel, handleDragEnd (branching on type)
  - DragOverlay chip showing tool name during tool drag
  - isDropTarget visual highlight on SortableFolderHeader and SubfolderHeader
  - Folder reorder persistence via reorderFolders server action
  - Tool-to-folder move via moveToolToFolder server action with router.refresh()
affects: [Phase 21 phase gate — all three requirements FOLDER-04, MOVE-01, MOVE-02 now complete]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multi-type DnD: active.data.current?.type === 'folder' | 'tool' to branch in handleDragEnd"
    - "dragOverFolderId state pattern: set in handleDragOver, cleared in handleDragEnd + handleDragCancel — avoids double useDroppable registration"
    - "DraggableToolRow: overlay grip on first TableCell (absolute position, group-hover/row:opacity-100) — zero colSpan impact"
    - "Tool move: startTransition + moveToolToFolder + router.refresh() — no optimistic local state for tool moves"
    - "Folder reorder: optimistic arrayMove + startTransition reorderFolders for persistence"

key-files:
  created: []
  modified:
    - src/components/tools/tools-table.tsx

key-decisions:
  - "overlay grip approach for tool rows: absolute positioned GripVertical inside first TableCell — avoids colSpan change to folder headers"
  - "dragOverFolderId state instead of secondary useDroppable on folder headers — useSortable already registers droppable; double-registration causes dnd-kit warnings"
  - "router.refresh() after tool move (not optimistic local state): toolConfigs is prop-derived; refresh is the correct approach for tool state after server mutation"

patterns-established:
  - "Pattern: multi-type DnD routing by active.data.current?.type — scalable to future drag types"
  - "Pattern: cn() conditional highlight class for drop targets — clean toggle without JS style manipulation"

requirements-completed: [FOLDER-04, MOVE-01, MOVE-02]

# Metrics
duration: 6min
completed: 2026-05-06
---

# Phase 21 Plan 02: DnD UI Wiring Summary

**Full drag-and-drop interactions wired in tools-table.tsx: folder reorder persistence, tool-to-folder drag with visual highlight, DragOverlay chip, and drag cancel — all three Phase 21 requirements complete**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-05-06T17:29:37Z
- **Completed:** 2026-05-06T17:36:02Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments

- Added `DraggableToolRow` component (outside `ToolsTable`, matching `SortableFolderHeader` pattern) with `useDraggable` hook and absolutely positioned `GripVertical` grip on the first cell — opacity-0 at rest, group-hover/row:opacity-100 on row hover
- Replaced the `handleDragEnd` TODO stub with full type-branching logic: folder branch calls `reorderFolders` in `startTransition`; tool branch guards same-folder no-op then calls `moveToolToFolder` + `router.refresh()`
- Added `handleDragStart`, `handleDragOver`, `handleDragCancel`, and `resetDragState` functions; wired all to `DndContext` props
- Added `isDropTarget` prop to `SortableFolderHeader` and `SubfolderHeader` with `bg-primary/10 ring-1 ring-inset ring-primary/40` highlight class
- Added `DragOverlay` inside `DndContext` rendering tool name chip (`text-sm font-mono bg-background border shadow-md px-3 py-1.5 rounded-md opacity-90`) during tool drags
- Replaced all 3 plain `<TableRow>` tool renders (folder tools, subfolder tools, ungrouped tools) with `<DraggableToolRow>`
- Build passes 0 TypeScript errors; vitest 151 tests passing, 244 todos, 0 failures

## Task Commits

1. **Task 1: Wire DraggableToolRow + new state + DnD handlers + isDropTarget props** - `4eb686b` (feat)
2. **Task 2: Full test suite verification** - no additional commit (verification only — no files changed)

## Files Created/Modified

- `src/components/tools/tools-table.tsx` - Added DraggableToolRow component, all DnD handlers, DragOverlay, isDropTarget props; replaced 3 plain tool row renders

## Decisions Made

- Used absolute-positioned grip overlay inside existing first `TableCell` instead of adding a new column — zero colSpan impact on folder header rows
- Used `dragOverFolderId` state pattern instead of secondary `useDroppable` on folder headers — `useSortable` already registers droppable; avoids double-registration and dnd-kit warnings
- `router.refresh()` for tool state after move (not optimistic local update) — `toolConfigs` is prop-derived from server; refresh is the correct and simpler approach

## Deviations from Plan

**[Rule 1 - Bug / Rule 3 - Blocking] Resolved STATE.md merge conflict before commit**
- **Found during:** Task 1 commit
- **Issue:** `STATE.md` had `<<<<<<< Updated upstream` merge conflict markers from a prior stash rebase; `git commit` refused with "unmerged files" error
- **Fix:** Manually resolved merge conflict, kept the upstream `status: verifying` timestamp merged with stash `last_activity` annotation; staged and included in Task 1 commit
- **Files modified:** `.planning/STATE.md`
- **Verification:** `git commit` succeeded after resolution
- **Committed in:** `4eb686b`

---

**Total deviations:** 1 auto-fixed (blocking issue — merge conflict)
**Impact on plan:** No scope change; merge conflict was infrastructure, not a plan deviation.

## Issues Encountered

- Git worktree was on `worktree-agent-a9d036c8bf7077908` branch (behind main by 39 commits); execution correctly used the main repo at `/c/Users/Vanildo/Dev/operator` where Phase 21 work lives

## Known Stubs

None. All DnD interactions are fully wired. The `it.todo` stubs in `tests/tools/actions.test.ts` are intentional scaffolding from Plan 21-01 (not stubs in this plan's deliverables).

## Next Phase Readiness

- Phase 21 is complete — all three requirements met: FOLDER-04 (folder reorder with persistence), MOVE-01 (tool-to-folder drag), MOVE-02 (drop target highlight)
- `npm run build` exits 0; `npx vitest run` exits 0 with 151 tests passing
- No blockers

## Self-Check

- [x] `src/components/tools/tools-table.tsx` — modified and committed at `4eb686b`
- [x] `git log --oneline | grep 4eb686b` — commit confirmed
- [x] `grep -c "function DraggableToolRow"` = 1
- [x] `grep -c "TODO Phase 21"` = 0
- [x] build exit 0
- [x] vitest exit 0, 151 passing

## Self-Check: PASSED

---
*Phase: 21-drag-and-drop*
*Completed: 2026-05-06*

---
phase: 20-folder-subfolder-crud
plan: 03
subsystem: ui
tags: [typescript, react, tools-ui, folder-model, crud, modal, server-actions]

# Dependency graph
requires:
  - phase: 20-01
    provides: createFolder, deleteFolder, deleteFolderWithTools server actions in actions.ts
  - phase: 20-02
    provides: SortableFolderHeader with rename/collapse props; SubfolderHeader with rename/collapse props; subfoldersByParent useMemo; collapsedFolders state
provides:
  - handleAddFolder wired to createFolder(name, null) with toast + router.refresh()
  - handleAddSubfolder wired to createFolder(name, parentFolderId) with toast + router.refresh()
  - addingSubfolderTo state + newSubfolderName state + inline subfolder form row in render loop
  - folderDeleteTarget state + handleDeleteFolder function
  - Folder delete AlertDialog with Cancel, "Move tools to Ungrouped" (outline), and "Delete folder and tools" (destructive) buttons
  - Plus button on SortableFolderHeader hover actions (opens inline subfolder form)
  - Trash2 button on SortableFolderHeader and SubfolderHeader hover actions (opens delete modal)
  - StaticFolderHeader label changed from "Other" to "Ungrouped" (DISPLAY-02)
affects: [phase-21, tools-table.tsx]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-option delete modal: folderDeleteTarget state holds { folder: ToolFolder }; handleDeleteFolder(mode) branches on orphan vs delete-with-tools"
    - "Inline subfolder form row: addingSubfolderTo === folder.id renders TableRow with Input + submit/cancel buttons immediately after SortableFolderHeader"
    - "Prop callback pattern for delete: SortableFolderHeader and SubfolderHeader receive onDeleteClick callback; parent sets folderDeleteTarget with full ToolFolder object"
    - "buttonVariants({ variant: 'outline' }) applied as className to AlertDialogAction — AlertDialogAction has no variant prop"

key-files:
  created: []
  modified:
    - src/components/tools/tools-table.tsx

key-decisions:
  - "folderDeleteTarget state stores { folder: ToolFolder } — full folder object passed so modal can display folder name in title without extra lookup"
  - "onDeleteClick callback prop pattern used instead of inline setFolderDeleteTarget in header components — keeps full ToolFolder object accessible at the render loop level"
  - "handleDeleteFolder closes modal (setFolderDeleteTarget(null)) before startTransition so UI resets immediately, not after async completion"
  - "router.refresh() called inside startTransition for create/delete — revalidatePath on server triggers page re-render; useEffect in ToolsTable syncs orderedFolders from updated prop"

patterns-established:
  - "Inline add form pattern: state (addingSubfolderTo) controls which section shows the form row; form row is a TableRow sibling to the header row"
  - "Two-option delete pattern: single folderDeleteTarget state serves both folder and subfolder deletes — IDs are globally unique UUIDs"

requirements-completed:
  - FOLDER-01
  - FOLDER-03
  - SUBFOLDER-01
  - SUBFOLDER-03
  - DISPLAY-02

# Metrics
duration: 8min
completed: 2026-05-06
---

# Phase 20 Plan 03: Create Folder/Subfolder, Delete Modal, and Ungrouped Label Summary

**CRUD completion: handleAddFolder/handleAddSubfolder wired to createFolder, folder delete AlertDialog with orphan-or-cascade two-option modal, Trash2/Plus hover buttons on folder headers, and "Ungrouped" label replacing "Other"**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-06T16:30:09Z
- **Completed:** 2026-05-06T16:38:00Z
- **Tasks:** 2
- **Files modified:** 1

## Accomplishments
- Wired `handleAddFolder` to `createFolder(name, null)` with success toast and `router.refresh()` (replaces TODO stub from Phase 19)
- Added `handleAddSubfolder` wired to `createFolder(name, parentFolderId)` with inline form row that appears/disappears via `addingSubfolderTo` state
- Added Plus button and Trash2 button to `SortableFolderHeader` hover actions; Trash2 button to `SubfolderHeader` hover actions
- Added `handleDeleteFolder` with two-branch logic: `deleteFolder` (orphan) or `deleteFolderWithTools` (cascade); folder delete AlertDialog with three buttons (Cancel, Move to Ungrouped outline, Delete with tools destructive)
- Renamed `StaticFolderHeader` label from "Other" to "Ungrouped" completing DISPLAY-02
- `npm run build` exits 0; `npx vitest run` exits 0 with 151 tests passing

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire create folder/subfolder + add Trash2/Plus buttons to headers** - `1a953f0` (feat)
2. **Task 2: Add folder delete AlertDialog (two-option modal) + final build + vitest verification** - `45e21b0` (feat)

**Plan metadata:** (upcoming docs commit)

## Files Created/Modified
- `src/components/tools/tools-table.tsx` - Added createFolder/deleteFolder/deleteFolderWithTools imports; buttonVariants import; Plus/Trash2 lucide imports; addingSubfolderTo/newSubfolderName/folderDeleteTarget state; handleAddFolder wired; handleAddSubfolder added; handleDeleteFolder added; SortableFolderHeader extended with onAddSubfolder/onDeleteClick props and Plus/Trash2 buttons; SubfolderHeader extended with onDeleteClick prop and Trash2 button; inline subfolder form row in render loop; folder delete AlertDialog; "Ungrouped" label replacing "Other"

## Decisions Made
- `folderDeleteTarget` state stores the full `{ folder: ToolFolder }` object so the modal title can display the folder name without an additional lookup
- `onDeleteClick` callback prop pattern used for both header components instead of inline state setters — keeps the full folder object available at the render loop level where it is already in scope
- `handleDeleteFolder` resets state before `startTransition` so the modal closes immediately on button click, not waiting for the async server action to complete
- `buttonVariants({ variant: 'outline' })` applied as `className` to `AlertDialogAction` per Pitfall 1 in 20-RESEARCH.md — `AlertDialogAction` has no `variant` prop

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria verified. Both tasks passed build and vitest on first attempt.

## Issues Encountered
None. Build and tests passed on first attempt after all edits were complete.

## Known Stubs
None. All CRUD operations are fully wired:
- Create top-level folder: `handleAddFolder` → `createFolder(name, null)`
- Create subfolder: `handleAddSubfolder` → `createFolder(name, parentId)`
- Delete folder (orphan): `handleDeleteFolder('orphan')` → `deleteFolder(id)`
- Delete folder (cascade): `handleDeleteFolder('delete-with-tools')` → `deleteFolderWithTools(id)`
- Rename folder/subfolder: `commitRename` → `updateFolder(id, { name })` (Phase 20-02)

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 20 is complete: all FOLDER-01/03, SUBFOLDER-01/03, DISPLAY-02 requirements are implemented and verified
- Phase 21 (DnD folder reorder) can now wire drag events to persist position via `updateFolder(id, { position })`
- FOLDER-04 (folder drag reorder persistence) remains deferred to Phase 21 as planned

---
*Phase: 20-folder-subfolder-crud*
*Completed: 2026-05-06*

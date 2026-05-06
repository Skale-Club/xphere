---
phase: 20-folder-subfolder-crud
plan: 02
subsystem: ui
tags: [typescript, react, tools-ui, folder-model, collapsible, inline-rename, dnd-kit]

# Dependency graph
requires:
  - phase: 20-01
    provides: deleteFolderWithTools server action; folder Select UI in tool-config-form.tsx
  - phase: 19-03
    provides: tools-table.tsx with SortableFolderHeader, folder grouping, and DnD scaffold
provides:
  - SubfolderHeader component in tools-table.tsx — indented static row with collapse toggle + inline rename
  - collapsedFolders Set state + toggleCollapse function — controls which folders/subfolders are collapsed
  - subfoldersByParent useMemo — groups subfolders by parent_id for O(1) render lookup
  - renamingFolderId + renameValue state — shared inline rename state for both folder and subfolder levels
  - startRename + commitRename functions — wire to updateFolder server action with toast feedback
  - Extended SortableFolderHeader — now renders ChevronRight/Down, inline rename Input, and hover Pencil icon
  - useEffect prop sync — orderedFolders stays current after router.refresh() updates the folders prop
affects: [20-03, tools-table.tsx]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Collapse toggle with Set<string> state in parent component — headers receive isCollapsed bool + onToggleCollapse callback"
    - "Inline rename: shared renamingFolderId/renameValue state in ToolsTable covers both folder and subfolder levels (IDs are globally unique UUIDs)"
    - "commitRename onBlur guards: check e.relatedTarget.getAttribute('data-rename-cancel') before committing to avoid double-fire with action buttons"
    - "useEffect sync pattern: setOrderedFolders(folders.filter(f => f.parent_id === null)) in [folders] dependency to stay in sync after router.refresh()"
    - "Subfolder indentation: pl-8 on TableCell vs pl-4 (px-4) on top-level folder — 16px visual hierarchy gap"

key-files:
  created: []
  modified:
    - src/components/tools/tools-table.tsx

key-decisions:
  - "Tasks 1 and 2 implemented together in a single commit — both tasks modify the same file and Task 1 render loop references functions defined in Task 2 (startRename, commitRename); splitting commits would leave the file in a non-compiling state"
  - "StaticFolderHeader label migrated from font-medium to font-semibold alongside SortableFolderHeader — plan requires 'no font-medium remaining on folder label spans'; static header is a folder label span"
  - "SubfolderHeader rendered once per subfolder inside the parent folder's expanded region — no SortableContext wrapper per plan spec (DnD Phase 21)"

patterns-established:
  - "Collapse state lives in ToolsTable, not in header components — table row rendering (show/skip rows) must be controlled by the parent"
  - "Single renamingFolderId/renameValue pair covers multiple component levels — works because folder IDs are globally unique UUIDs"

requirements-completed:
  - DISPLAY-01
  - FOLDER-02
  - SUBFOLDER-02

# Metrics
duration: 10min
completed: 2026-05-06
---

# Phase 20 Plan 02: Collapse Toggles, Subfolder Rendering, and Inline Rename Summary

**Collapsible two-tier folder hierarchy in tools-table.tsx: SubfolderHeader component with pl-8 indent, Set-based collapse state, and shared inline rename via updateFolder server action**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-05-06T16:23:05Z
- **Completed:** 2026-05-06T16:33:00Z
- **Tasks:** 2 (committed together as one atomic unit)
- **Files modified:** 1

## Accomplishments
- Added `SubfolderHeader` component — indented static table row with collapse toggle (ChevronRight/Down), conditional rename Input vs label span, and hover-reveal Pencil button
- Extended `SortableFolderHeader` with collapse toggle, inline rename Input, hover-reveal Pencil button, and bg-muted/40 per UI-SPEC; migrated `font-medium` to `font-semibold` on all folder label spans
- Added `collapsedFolders` Set state, `subfoldersByParent` useMemo, `toggleCollapse` function, `startRename`/`commitRename` handlers, and `useEffect` prop sync in `ToolsTable`
- Updated render loop inside `SortableContext` to render subfolder rows + their tools inside the parent's expanded region; tools directly in the parent folder render after their subfolders
- `npm run build` exits 0; `npx vitest run` exits 0 (151 tests pass, no regressions)

## Task Commits

Both tasks committed atomically as one unit (file interdependency — render loop references handlers defined in same file):

1. **Tasks 1+2: Add collapse state, subfolder rendering, and inline rename to tools-table** - `fac7721` (feat)

**Plan metadata:** (upcoming docs commit)

## Files Created/Modified
- `src/components/tools/tools-table.tsx` - Added SubfolderHeader component; extended SortableFolderHeader with collapse + rename props; added collapsedFolders state, subfoldersByParent memo, useEffect sync, toggleCollapse, startRename, commitRename; updated render loop

## Decisions Made
- Tasks 1 and 2 implemented together in one commit — the render loop (Task 1) references `startRename` and `commitRename` (Task 2 scope); committing Task 1 alone would produce a TypeScript error and a non-passing build
- StaticFolderHeader `font-medium` also migrated to `font-semibold` — the plan's final verification check is "no `font-medium` remaining on folder label spans"; StaticFolderHeader has a folder label span

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Migrated StaticFolderHeader font-medium to font-semibold**
- **Found during:** Task 2 final verification
- **Issue:** Plan acceptance criteria requires no `font-medium` on folder label spans; StaticFolderHeader (the "Ungrouped" group header) still had `font-medium` and is a folder label span
- **Fix:** Changed `font-medium` to `font-semibold` in StaticFolderHeader — same migration applied to SortableFolderHeader and SubfolderHeader per UI-SPEC
- **Files modified:** src/components/tools/tools-table.tsx (line 187)
- **Verification:** `grep "font-medium" src/components/tools/tools-table.tsx | grep -v "header\|Tool\|Action\|Labels\|Integration\|Fallback\|Status"` returns empty — no folder label spans with font-medium
- **Committed in:** fac7721 (task commit)

---

**Total deviations:** 1 auto-fixed (Rule 2 — missing critical consistency fix)
**Impact on plan:** One-line CSS class change; no behavior impact; required to satisfy the plan's own final verification gate.

## Issues Encountered
None. Build and tests passed on first attempt after all edits were complete.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 20-03 can now wire the folder delete modal (two-option: orphan vs delete-with-tools) and the (+) add-subfolder button to SortableFolderHeader hover actions
- The `deleteFolderWithTools` server action (20-01) and the collapse/rename state (20-02) are both ready for 20-03 to consume
- `handleAddFolder` stub in ToolsTable still has `// TODO Phase 20` comment — Plan 20-03 should wire it to `createFolder()` server action

---
*Phase: 20-folder-subfolder-crud*
*Completed: 2026-05-06*

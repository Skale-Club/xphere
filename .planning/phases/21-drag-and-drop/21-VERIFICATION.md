---
phase: 21-drag-and-drop
verified: 2026-05-06T18:00:00Z
status: passed
score: 3/3 success criteria verified
re_verification: false
---

# Phase 21: Drag-and-Drop Verification Report

**Phase Goal:** Admins can reorder top-level folders and move tools between folders by dragging.
**Verified:** 2026-05-06T18:00:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Admin can drag a top-level folder header to a new position; order persists after page reload | VERIFIED | `SortableFolderHeader` uses `useSortable({ id, data: { type: 'folder' } })`; `handleDragEnd` branches on `dragType === 'folder'`; calls `reorderFolders(reordered.map(f => f.id))` in `startTransition`; `reorderFolders` bulk-updates `tool_folders.position` via `Promise.all` and calls `revalidatePath('/tools')` |
| 2 | Admin can drag a tool row near a folder/subfolder header and the header highlights visually | VERIFIED | `handleDragOver` sets `dragOverFolderId` when dragging a tool; both `SortableFolderHeader` and `SubfolderHeader` receive `isDropTarget` prop; apply `bg-primary/10 ring-1 ring-inset ring-primary/40` when `isDropTarget === true` (lines 135, 259) |
| 3 | Admin can drop a tool onto a folder/subfolder header; tool moves there, disappearing from previous location | VERIFIED | `handleDragEnd` branches on `dragType === 'tool'`; guards same-folder no-op; calls `moveToolToFolder(toolId, targetFolderId)` in `startTransition`; calls `router.refresh()` on success; `moveToolToFolder` updates `tool_configs.folder_id` in DB and calls `revalidatePath('/tools')` |

**Score:** 3/3 success criteria verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/tools/actions.ts` | `reorderFolders` + `moveToolToFolder` exported | VERIFIED | Both functions at lines 245 and 259; fully implemented with auth gate, DB call, revalidatePath |
| `src/components/tools/tools-table.tsx` | `DraggableToolRow` component + DnD event handlers + DragOverlay + isDropTarget highlight | VERIFIED | `DraggableToolRow` at line 320; all 4 handlers wired; `DragOverlay` at lines 17 + 1002–1008; `isDropTarget` on both header types |
| `tests/tools/actions.test.ts` | `describe('reorderFolders'` + `describe('moveToolToFolder'` stubs | VERIFIED | Both describe blocks at lines 42 and 50; 5 `it.todo` stubs each |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `handleDragEnd (dragType === 'folder')` | `reorderFolders` server action | `startTransition` + `reordered.map(f => f.id)` | WIRED | Line 447–449: `startTransition(async () => { const result = await reorderFolders(reordered.map(f => f.id)) ... })` |
| `handleDragEnd (dragType === 'tool')` | `moveToolToFolder` server action | `startTransition` + `over.id` | WIRED | Line 458–465: guards same-folder, calls `moveToolToFolder(toolId, targetFolderId)`, then `router.refresh()` |
| `handleDragOver` | `dragOverFolderId` state | `setDragOverFolderId(over?.id)` | WIRED | Line 428: `setDragOverFolderId(over ? (over.id as string) : null)` — gated on `active.data.current?.type === 'tool'` |
| `dragOverFolderId === folder.id` | `SortableFolderHeader isDropTarget` prop | prop drilling in render loop | WIRED | Line 884: `isDropTarget={dragOverFolderId === folder.id}` |
| `dragOverFolderId === sub.id` | `SubfolderHeader isDropTarget` prop | prop drilling in render loop | WIRED | Line 946: `isDropTarget={dragOverFolderId === sub.id}` |
| `reorderFolders` | `tool_folders` DB table | `supabase.from('tool_folders').update({ position: index }).eq('id', id)` | WIRED | Line 251: bulk position update via `Promise.all`; returns error on failure |
| `moveToolToFolder` | `tool_configs` DB table | `supabase.from('tool_configs').update({ folder_id: folderId }).eq('id', toolId)` | WIRED | Lines 265–269: targeted single-field update, accepts `null` for ungrouped |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `reorderFolders` | `orderedIds: string[]` | Passed from `handleDragEnd` after `arrayMove` on `orderedFolders` state | Yes — IDs come from live folder state; supabase updates `tool_folders.position` | FLOWING |
| `moveToolToFolder` | `toolId`, `folderId` | Passed from `handleDragEnd` using `active.id` and `over.id` from DnD event | Yes — IDs come from live DnD event; supabase updates `tool_configs.folder_id` | FLOWING |
| `DragOverlay` chip | `activeDragTool.tool_name` | Set in `handleDragStart` by `toolConfigs.find(t => t.id === active.id)` | Yes — `toolConfigs` is prop-derived from server data | FLOWING |
| `isDropTarget` highlight | `dragOverFolderId` | Set by `handleDragOver` from `over.id` (real DnD event) | Yes — set from real drag-over events, cleared by `resetDragState` | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED — phase produces React UI/server actions requiring a running browser to test drag interactions. Cannot exercise DnD interactions or server action calls from CLI.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FOLDER-04 | 21-01, 21-02 | Folder reorder persistence via drag | SATISFIED | `reorderFolders` bulk-updates `tool_folders.position`; `SortableFolderHeader` uses `data: { type: 'folder' }`; `handleDragEnd` branches on `dragType === 'folder'` and persists via server action |
| MOVE-01 | 21-01, 21-02 | Tool move to folder via drag | SATISFIED | `moveToolToFolder` updates `tool_configs.folder_id`; `DraggableToolRow` uses `useDraggable`; `handleDragEnd` branches on `dragType === 'tool'` and calls server action + `router.refresh()` |
| MOVE-02 | 21-02 | Drop target highlight on folder header | SATISFIED | `isDropTarget` prop added to both `SortableFolderHeader` and `SubfolderHeader`; `dragOverFolderId` state drives highlight; `bg-primary/10 ring-1 ring-inset ring-primary/40` applied via `cn()` |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tools-table.tsx` | 385 | `activeId` state declared and set but never read in render | Info | `activeId` is written in `handleDragStart` and cleared in `resetDragState` but not consumed by any JSX or conditional. Dead state — no user impact. The functional rendering path uses `activeDragType` and `activeDragTool` correctly. |

No blockers. The `activeId` orphan state is cosmetic dead code — it does not affect any of the three success criteria.

### Human Verification Required

#### 1. Folder Drag Reorder — Visual and Persistence

**Test:** With two or more folders in the Tools page, grab the grip icon on a folder header and drag it above or below another folder. Release.
**Expected:** Folders reorder immediately (optimistic); after page reload (or navigation away and back) the order is preserved.
**Why human:** DnD initiation, visual ghost, and drop require a browser with pointer events; persistence after reload requires a live Supabase connection.

#### 2. Tool Drag — DragOverlay Chip and Drop Target Highlight

**Test:** Hover over a tool row to reveal the grip icon. Begin dragging. Hover the dragged tool over a folder header, then a subfolder header.
**Expected:** A floating chip showing the tool name appears while dragging. The hovered folder/subfolder header gains the `bg-primary/10 ring` highlight; other headers do not.
**Why human:** CSS class application from DnD hover events requires a live browser; visual states cannot be verified from source alone.

#### 3. Tool Move Persistence and Escape Cancel

**Test:** Drag a tool and drop it on a different folder header. Verify it disappears from its original folder and appears under the new one. Then drag a tool and press Escape mid-drag.
**Expected:** After drop, tool appears under new folder (after `router.refresh()`). After Escape, all highlights clear and the tool stays in its original location.
**Why human:** Requires live Supabase DB write and page refresh to confirm persistence; Escape behavior requires real DnD event stream.

### Gaps Summary

No gaps. All three success criteria are fully implemented and wired:

- `reorderFolders` and `moveToolToFolder` are correctly implemented server actions in `actions.ts` (lines 245–272), with auth gates, DB calls, and `revalidatePath`.
- `tools-table.tsx` has the complete DnD implementation: `DraggableToolRow` with `useDraggable`, all four DnD event handlers (`handleDragStart`, `handleDragOver`, `handleDragCancel`, `handleDragEnd`), `DragOverlay` chip, `isDropTarget` highlight on both folder header types, and all three `DraggableToolRow` render sites (folder direct tools, subfolder tools, ungrouped tools).
- The TODO stub from Phase 20 (`// TODO Phase 21: persist reorder via updateFolder position`) is confirmed absent (0 matches).
- Commits `99aa225` and `4eb686b` are confirmed in git history.

---

_Verified: 2026-05-06T18:00:00Z_
_Verifier: Claude (gsd-verifier)_

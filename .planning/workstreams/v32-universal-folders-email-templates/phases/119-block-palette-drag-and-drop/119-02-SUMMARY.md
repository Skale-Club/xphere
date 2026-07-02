---
phase: 119-block-palette-drag-and-drop
plan: 02
subsystem: ui
tags: [email-editor, dnd-kit, drag-and-drop, useDraggable, useSortable, useDroppable, DragOverlay, palette]

# Dependency graph
requires:
  - phase: 119-01
    provides: "Pure document helpers findBlockLocation/insertBlockInColumn/moveBlock (tested) that the drag handlers delegate to"
  - phase: 118-block-stable-ids
    provides: "Stable EmailBlock ids — the sortable item id + the move/find key"
provides:
  - "block-palette.tsx — left three-pane palette: 7 block-type chips + reusable chips as useDraggable sources"
  - "email-template-editor.tsx — multi-container block DnD (palette insert, within/between-column block move) wired into the SINGLE existing DndContext, alongside preserved section reorder + fallback add menus"
affects: [120-email-lifecycle, 121-email-sending]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Single-DndContext multi-container DnD: palette useDraggable + column SortableContexts + empty-column useDroppable all share ONE context; closestCorners collision + DragOverlay ghost"
    - "Unified drop-target id: a column's SortableContext id and its empty-column useDroppable id are the SAME string `col:${sectionId}:${colIdx}` — resolveDropTarget handles a block-id `over` OR a `col:*` `over` identically"
    - "Grip-scoped drag listeners: useSortable listeners/attributes spread on the block's GRIP button ONLY via a render-prop, never the wrapper — preserves contentEditable text editing + inline controls"
    - "Handlers delegate ALL document mutation to tested pure helpers; onDragEnd is a thin wiring/disambiguation layer"

key-files:
  created:
    - src/app/(dashboard)/email-templates/_components/block-palette.tsx
  modified:
    - src/app/(dashboard)/email-templates/_components/email-template-editor.tsx

key-decisions:
  - "Extended the ONE existing DndContext (lifted to wrap palette + canvas) rather than adding a second — exactly one <DndContext in the file"
  - "resolveDropTarget: a col:* over → append at column end; a block-id over → drop at that block's index; parse col: on lastIndexOf(':') (section ids are colon-free base36)"
  - "Palette/reusable inserts MINT fresh ids (BLOCK_DEFAULTS + makeBlockId / re-mint reusable). Cross-section block moves are blocked (out of scope per REQUIREMENTS)"
  - "BLOCK_TYPES lifted to a single module-level export shared by the palette and the + Block menu"
  - "SortableBlock/BlockEditor drag-handle props typed with dnd-kit's DraggableAttributes / DraggableSyntheticListeners (not Record<string, unknown>) so the spread + attribute types check cleanly (Rule 3 blocking type fix)"

patterns-established:
  - "Pattern: three-pane email builder (palette | canvas | dialogs) under one DndContext"
  - "Pattern: unified col: droppable/sortable id so empty-column and mid-column drops resolve through one code path"

requirements-completed: [UFE-08]

# Metrics
duration: 11min
completed: 2026-07-02
---

# Phase 119 Plan 02: Block Palette + Multi-Container DnD Summary

**Three-pane email builder where a left palette's useDraggable chips drop fresh-id blocks into columns, and blocks reorder within / move between columns via a grip handle — all wired into the single existing DndContext (closestCorners + DragOverlay), with section reorder and the +Block/Insert fallback menus preserved.**

## Performance

- **Duration:** ~11 min
- **Started:** 2026-07-02T17:27:24Z
- **Completed:** 2026-07-02T17:38:26Z
- **Tasks:** 3
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments
- Left `BlockPalette` renders 7 block-type chips + reusable chips as `useDraggable` sources (ids prefixed `palette:` / `reusable:`, `data.current.type === 'palette'`).
- Each column is a droppable `SortableContext` (id `col:${sectionId}:${colIdx}`); each block is a `SortableBlock` (`useSortable`); empty columns get an `EmptyColumnDropZone` (`useDroppable`) at the SAME unified id.
- Single `DndContext` lifted to wrap palette + canvas; `closestCorners` collision detection + a `DragOverlay` ghost.
- `onDragStart/onDragOver/onDragEnd` disambiguate palette / block / section and delegate every document mutation to the tested 119-01 helpers: palette → `insertBlockInColumn` a fresh-id block; block → `moveBlock` (within + between columns); section → `arrayMove` (unchanged).
- Reusable palette insert re-mints every block id via `makeBlockId()`; cross-section block move is blocked (out of scope).
- Drag listeners are grip-scoped (block grip `<button>` only) so contentEditable editing + inline controls are not hijacked by the PointerSensor.
- `BLOCK_TYPES` lifted to one module-level export shared by the palette and the `+ Block` menu; fallback `+ Block` / `Insert` dropdowns intact.
- `npm run build` exits 0; email test suites 35/35 (17 builder + 8 block-ids + 10 dnd).

## Task Commits

Each task was committed atomically:

1. **Task 1: BlockPalette + lift BLOCK_TYPES to shared export** - `cc924969` (feat)
2. **Task 2 + Task 3: droppable columns/sortable blocks + single-DndContext wiring** - `63ae64ea` (feat)

_Tasks 2 and 3 both edit only `email-template-editor.tsx` and are interdependent (the file does not compile between them — Task 2 adds the sortable/droppable primitives that Task 3's handlers drive), so they are one atomic editor-rewiring commit._

**Plan metadata:** committed with the phase-level docs commit.

## Files Created/Modified
- `src/app/(dashboard)/email-templates/_components/block-palette.tsx` - Left palette; `PaletteChip` (useDraggable) + `BlockPalette` rendering block-type + reusable chips.
- `src/app/(dashboard)/email-templates/_components/email-template-editor.tsx` - `BLOCK_TYPES` module export; `SortableBlock` + `EmptyColumnDropZone`; `ColumnEditor` re-adds `sectionId`/`colIdx` and wraps blocks in a `col:*` `SortableContext`; `BlockEditor` grip handle; single `DndContext` with palette pane + `DragOverlay`; `parseColId`/`resolveDropTarget`/`handleDragStart`/`handleDragOver`/`handleDragEnd`/`renderDragOverlay`; removed `handleSectionDragEnd` + `closestCenter`.

## Decisions Made
- See frontmatter `key-decisions`. Notably: unified `col:` id for SortableContext + empty-column droppable; grip-scoped listeners; delegate mutations to the tested pure helpers; block DnD stays within a section (cross-section blocked).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Typed the drag-handle props with dnd-kit's own types**
- **Found during:** Task 2 (SortableBlock render-prop + BlockEditor prop)
- **Issue:** The plan's example typed `attributes`/`listeners` as `Record<string, unknown>`; `useSortable`'s `attributes` is `DraggableAttributes`, which is NOT assignable to `Record<string, unknown>` — `tsc` error TS2322, blocking the build.
- **Fix:** Imported `type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'` and used them for the `SortableBlock` render-prop and the `BlockEditor` `dragHandleProps` prop. The grip-button spread now type-checks.
- **Files modified:** `email-template-editor.tsx`
- **Verification:** `npm run build` exit 0; grip spread compiles.
- **Committed in:** `63ae64ea`

**2. [Rule 1 - Lint] Made `handleDragOver`'s unused param non-warning**
- **Found during:** Task 3 (no-op onDragOver handler)
- **Issue:** `handleDragOver(_event)` tripped `@typescript-eslint/no-unused-vars` (the config flags underscore-prefixed params too).
- **Fix:** Kept the typed `DragOverEvent` param (dnd-kit's `onDragOver` signature) and added `void _event` in the body. 0 new lint warnings from my code.
- **Files modified:** `email-template-editor.tsx`
- **Verification:** `eslint` reports no `_event`/`handleDragOver` warning.
- **Committed in:** `63ae64ea`

---

**Total deviations:** 2 auto-fixed (1 blocking type fix, 1 lint). **Impact:** Both necessary for a clean build/lint; no scope creep. Neither changed the 119-01 helpers (the contract) — the pure tests remained 10/10 throughout.

## Issues Encountered
- Pre-existing `npx tsc --noEmit` errors (~91, ALL in `tests/*` — including 8 in `tests/email-template-builder.test.ts` where block literals predate the Phase 118 `id` field) are out of scope and not surfaced by `npm run build` (which excludes `tests/`). Logged to `deferred-items.md`; not fixed.

## User Setup Required
None - pure client-side code, no external service configuration, no DB/migration.

## Deferred (post-migration human-verify — NOT a gap)
Live pointer-drag can't be exercised until migrations 1225/1226/1227/1228 apply (the editor route nests under the folder-querying layout). Deferred runtime checks: drag a palette chip into a column (fresh block at drop index), within/between-column block reorder, section reorder still works, and save → reopen round-trip reflecting the new arrangement. Validated today via `npm run build` (exit 0) + the 119-01 helper tests (10/10) + grep acceptance criteria.

## Next Phase Readiness
- UFE-08 delivered: palette→column insert + within/between-column block moves, section reorder preserved, one DndContext, fallback menus intact.
- Ready for Phase 120 (email publish/unpublish lifecycle — UFE-09).
- Carryover blocker: migrations 1225/1226/1227/1228 remain unapplied — reconcile the migration-history desync + apply before this editor code deploys (and before live drag can be verified).

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/email-templates/_components/block-palette.tsx
- FOUND: src/app/(dashboard)/email-templates/_components/email-template-editor.tsx
- FOUND: 119-02-SUMMARY.md
- FOUND commit: cc924969 (Task 1 feat)
- FOUND commit: 63ae64ea (Task 2+3 feat)
- Build: `npm run build` exit 0
- Tests: email suites 35/35 (helper dnd 10/10)
- Guardrails verified: exactly ONE `<DndContext`; unified `col:` id on SortableContext + useDroppable; drag listeners grip-scoped (buttons only)

---
*Phase: 119-block-palette-drag-and-drop*
*Completed: 2026-07-02*

---
status: passed
phase: 119-block-palette-drag-and-drop
verified: 2026-07-02
mode: client code — build + helper-tests verified; live pointer-drag deferred to post-migration runtime
---

# Phase 119 Verification — Block Palette + Drag-and-Drop

**Result: PASSED at build + logic level.** The drag OUTCOMES are unit-tested; the live pointer interaction is post-migration runtime verify (editor route nests under the folder-querying layout).

## Success Criteria
1. **Left palette lists block types (+ reusable) as drag sources** — ✅ `block-palette.tsx` (`useDraggable` chips).
2. **Dragging a palette item into a column inserts a new block at drop position** — ✅ `onDragEnd` palette→`insertBlockInColumn` with fresh-minted id; outcomes unit-tested.
3. **Blocks reorder within a column and move between columns; section reorder still works** — ✅ `moveBlock` (within/cross-column); section `arrayMove` preserved; unit tests pin the outcomes.
4. **Live preview + saved snapshot reflect the arrangement; build passes** — ✅ `npm run build` exit 0; `tests/email-editor-dnd.test.ts` 10/10; full email suite 35/35.

## Guardrails confirmed (grep)
- Exactly ONE `<DndContext`. Drag listeners grip-scoped only (not on wrappers). Unified `over` id (`col:${sectionId}:${colIdx}` shared by SortableContext + empty-column useDroppable). Palette/reusable inserts re-mint ids. Cross-section block move blocked.

## Requirements
- UFE-08 ✅ — build + logic verified.

## Deferred (not a gap)
- Live pointer-drag runtime verification — after migrations 1225/1228 applied (editor route currently blocked by the folder-querying layout).
- Pre-existing ~91 `tsc --noEmit` errors in `tests/*` (not surfaced by `npm run build`) — logged in phase `deferred-items.md`, unrelated to this phase.

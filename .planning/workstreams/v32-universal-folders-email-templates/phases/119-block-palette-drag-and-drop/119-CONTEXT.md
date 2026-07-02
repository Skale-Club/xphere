# Phase 119: Block Palette + Drag-and-Drop - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** client code (no DB). Verifiable via `npm run build` + unit tests of the extracted pure document-mutation helpers. Live pointer-drag is post-migration-apply runtime verify (the editor route now nests under the folder-querying layout).

<domain>
## Phase Boundary
Turn the email editor into a THREE-PANE builder: a left **block palette** (draggable block-type sources + reusable blocks) | the existing canvas | existing dialogs. Enable dragging a palette item INTO a column (insert new block at drop position) and reordering/moving blocks WITHIN and BETWEEN columns. Section reordering (already works) must keep working. Blocks already have stable ids (Phase 118) — required for this.
</domain>

<decisions>
## Implementation Decisions

### Layout — three panes
- Add a left sidebar (`~w-52`, border-r, scrollable) as a sibling BEFORE the existing canvas column inside the editor's top flex container. It lists the 7 block types (heading/text/image/button/divider/spacer/html, reuse the existing `BLOCK_TYPES` icon list) and the reusable blocks — each a drag source.
- Keep the existing toolbar (Settings/Reusable/Preview/Save) and canvas unchanged in structure.

### dnd-kit multi-container (extend the SINGLE existing DndContext)
- The editor already has ONE `DndContext` (sensors: Pointer+Keyboard) with a `SortableContext` for sections (verticalListSortingStrategy). EXTEND it — do NOT add a second DndContext.
- Each COLUMN becomes a droppable sortable container: `SortableContext` with `items = column.map(b => b.id)`, id = `col:${sectionId}:${colIdx}`, strategy verticalListSortingStrategy. Each block wrapper uses `useSortable({ id: block.id })`. Empty columns need a `useDroppable` zone (so you can drop into an empty column).
- Palette items are `useDraggable` with id `palette:${type}` and `data.current = { source: 'palette', blockType: type }` (or `{ source: 'reusable', reusableId }`).
- Sections keep their existing `useSortable({ id: section.id })`. Disambiguate in handlers by id prefix (`palette:` vs `col:` vs a section id vs a block id) or by `data.current.type` tags ('section' | 'block' | 'palette').

### Handlers (extract PURE helpers for testability)
Create pure functions in a new `src/lib/email/editor-dnd.ts` (or inside render-template.ts), operating on `EmailDocument`:
- `insertBlockInColumn(doc, sectionId, colIdx, index, block) => doc`
- `moveBlock(doc, blockId, toSectionId, toColIdx, toIndex) => doc` (remove from wherever it is, insert at target)
- `findBlockLocation(doc, blockId) => { sectionId, colIdx, index } | null`
Wire `onDragStart` (set active for overlay), `onDragOver` (compute over-container), `onDragEnd`:
- active is `palette:*` dropped over a column/block → `insertBlockInColumn` with a fresh block (`{ ...BLOCK_DEFAULTS[type], id: makeBlockId() }`, or re-minted reusable blocks) at the computed index; select it.
- active is a block id → `moveBlock` to the target column+index (handles within-column reorder AND cross-column move).
- active is a section id → existing `arrayMove` section reorder (unchanged).
- `collisionDetection`: use `closestCorners` (better than closestCenter for multi-container). Add a `DragOverlay` rendering a ghost of the dragged block or palette chip.

### Keep the existing add paths as fallback
- Leave the in-column `+ Block` / `Insert` dropdowns working (accessibility + non-drag flow) OR route them through the same `insertBlockInColumn` helper. Do NOT remove them.

### Verification
- `npm run build` exit 0.
- `tests/email-editor-dnd.test.ts`: unit-test the pure helpers — insert at index, reorder within column, move across columns (source shrinks / target grows, ids preserved), findBlockLocation. These prove the drag OUTCOMES without a real pointer.
- Live pointer-drag = post-apply runtime verify (record as deferred human-verify, not a gap).
</decisions>

<code_context>
## Existing Code Insights (from prior deep read)
- `src/app/(dashboard)/email-templates/_components/email-template-editor.tsx` — one `DndContext` + `SortableContext(items=sections)` (verticalListSortingStrategy), `handleSectionDragEnd` (arrayMove); `SortableSection` (useSortable by section.id); `ColumnEditor` renders blocks (now `key={block.id}` after 118) with `+ Block` (BLOCK_TYPES) and `Insert` (reusable) dropdowns; `BlockEditor` wraps each block. `addBlock`/`insertReusableBlock`/`updateBlock`/`removeBlock` are now id-based (Phase 118). `selectedBlockId` state exists.
- `src/lib/email/render-template.ts` — `EmailBlock` (all have `id` now), `BLOCK_DEFAULTS`, `makeBlockId`, `normalizeDocument`.
- dnd-kit (`@dnd-kit/core`, `@dnd-kit/sortable`) already a dependency.

## Integration point
The three-pane layout goes inside the editor's root flex; the palette is the new left column. The editor page renders under `settings/email-templates/[id]` (which after 117 nests in the folder-querying SubSidebarLayout — hence live drag can't be previewed until migrations apply, but build + helper tests fully validate the logic).
</code_context>

<specifics>
## Specific Ideas
- One DndContext only — extend it; do not nest a second.
- Blocks CANNOT be dragged across SECTIONS in this phase (only within/between the columns OF a section is the target; cross-section is out of scope per REQUIREMENTS out-of-scope). Keep section reorder as-is.
- Re-mint ids when a palette/reusable insert creates blocks (never duplicate ids).
</specifics>

<deferred>
## Deferred Ideas
- Cross-section block dragging — explicitly out of scope (REQUIREMENTS.md).
- Live pointer-drag runtime verification — after migrations applied.
- Publish lifecycle → 120. Sending → 121.
</deferred>

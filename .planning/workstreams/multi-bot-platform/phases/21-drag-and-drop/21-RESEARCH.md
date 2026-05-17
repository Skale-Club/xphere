# Phase 21: Drag and Drop - Research

**Researched:** 2026-05-06
**Domain:** @dnd-kit — mixing sortable + droppable in one DndContext; server-side position persistence
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from STATE.md Decisions)

### Locked Decisions
- Folder reorder via drag already partially exists (SortableFolderHeader with @dnd-kit), but persistence (saveFolderOrder) was removed in Phase 19 and replaced with `position` on `tool_folders` table
- Move tool between folders: drag tool row OVER a folder header (not reorder within list) — folder header highlights on hover as drop target
- `@dnd-kit` already installed and used — do NOT add new DnD libraries
- Max 2 levels only (folder > subfolder); no deeper nesting

### Claude's Discretion
- Plan breakdown (number of plans, wave structure)
- Whether to use a single DndContext for both operations or introduce onDragStart/onDragEnd routing
- Collision detection strategy for the combined use case
- Whether to add a reorderFolders(orderedIds) bulk server action or call updateFolder N times

### Deferred Ideas (OUT OF SCOPE)
- Subfolder drag reorder (drag subfolder to new position within parent)
- Drag tools to reorder within a folder
- Bulk-move multiple tools to a folder
- Folder color/icon customization
- Keyboard navigation for folder tree
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOLDER-04 | Admin can reorder top-level folders via drag and drop; order persists after page reload | `handleDragEnd` already does optimistic `arrayMove`; need persistence via server action; `updateFolder(id, { position })` exists |
| MOVE-01 | Admin can move a tool to a different folder or subfolder by dragging it over the target folder header | Requires `useDroppable` on folder/subfolder headers; `onDragEnd` branches on drag type; `updateToolConfig` exists for folder_id update |
| MOVE-02 | The target folder header highlights visually when a tool is dragged over it | `useDroppable` returns `isOver` boolean; apply highlight class conditionally |
</phase_requirements>

---

## Summary

Phase 21 completes the drag-and-drop work that was scaffolded but not persisted in Phases 19–20. There are two distinct DnD interactions inside the same `DndContext`:

1. **Folder reorder** — top-level `SortableFolderHeader` rows are already sortable via `useSortable`. `handleDragEnd` already does optimistic `arrayMove`. Phase 21 adds the server persistence step: compute new `position` values from the reordered array and call `updateFolder(id, { position })` for each affected folder. One option is calling N individual `updateFolder` calls from the client; the cleaner option is a new `reorderFolders(orderedIds: string[])` server action that batch-updates positions atomically in one RPC/transaction.

2. **Tool-to-folder move** — tool rows need to be draggable (currently they are plain `<TableRow>` elements, not wrapped in any DnD hook). Folder headers and subfolder headers need to become droppable via `useDroppable`. When a tool is dropped on a folder header, `updateToolConfig` is called to update `folder_id`.

The key design question is **how `handleDragEnd` distinguishes a folder drag from a tool drag** inside the single `DndContext`. The answer is the `data` prop on `useSortable`/`useDraggable`: each draggable item carries `data: { type: 'folder' | 'tool', ... }`. `handleDragEnd` reads `active.data.current.type` to branch.

Tool rows need their own drag handle (grip icon) via `useDraggable` (not `useSortable`, since tools do not sort — they move to a different droppable). Folder headers continue to use `useSortable`. Folder headers and subfolder headers also register as droppable targets via `useDroppable` so they receive the `isOver` signal for the highlight requirement.

**Primary recommendation:** Single `DndContext`, single `handleDragEnd`, single `onDragOver` that sets `activeToolDragOverFolderId` state. The branch is `active.data.current?.type === 'tool'` in `handleDragEnd`. No new packages needed.

---

## Standard Stack

### Core (no new packages)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@dnd-kit/core` | ^6.3.1 | `DndContext`, `DragOverlay`, `useDroppable`, `useDraggable`, sensors | Already installed and used |
| `@dnd-kit/sortable` | ^10.0.0 | `SortableContext`, `useSortable`, `arrayMove`, `verticalListSortingStrategy` | Already installed and used |
| `@dnd-kit/utilities` | ^3.2.2 | `CSS.Transform.toString` | Already installed and used |

**No new packages.** All required primitives are in the already-installed packages.

**Available imports from @dnd-kit/core (not yet imported in tools-table.tsx):**
- `DragOverlay` — renders a floating drag ghost
- `useDroppable` — marks a DOM element as a drop target, returns `isOver`
- `useDraggable` — makes a non-sortable element draggable (for tool rows)
- `DragStartEvent`, `DragOverEvent` — types for new event handlers

**Available imports from @dnd-kit/sortable (already imported):**
- `arrayMove` — already used in `handleDragEnd`

**Installation:** No new packages needed.

---

## Architecture Patterns

### Current DnD State in tools-table.tsx (what exists after Phase 20)

```
DndContext
  sensors: PointerSensor + KeyboardSensor
  collisionDetection: closestCenter
  onDragEnd: handleDragEnd
    → reads active.id, over.id
    → finds indexes in orderedFolders[]
    → arrayMove(...) optimistically
    → TODO comment: "persist reorder via updateFolder position"

SortableContext
  items: orderedFolders.map(f => f.id)
  strategy: verticalListSortingStrategy
  → each SortableFolderHeader uses useSortable({ id: folder.id })

Tool rows: plain <TableRow> — NO drag wiring at all
Subfolder headers (SubfolderHeader): plain component — NO drag wiring
```

### Target Architecture After Phase 21

```
State additions:
  activeId: string | null              — set in onDragStart; cleared in onDragEnd
  activeDragType: 'folder' | 'tool' | null
  dragOverFolderId: string | null      — which folder/subfolder is being hovered by a tool drag

DndContext
  sensors: (unchanged)
  collisionDetection: closestCenter    — works for both folder sort and folder drop targets
  onDragStart: sets activeId + activeDragType
  onDragOver: if activeDragType === 'tool', set dragOverFolderId = over?.id
  onDragEnd: branches on activeDragType
    → 'folder': arrayMove + persist positions
    → 'tool': updateToolConfig({ folder_id: over.id })
    → clears activeId, activeDragType, dragOverFolderId

SortableContext (unchanged items, unchanged strategy)
  → SortableFolderHeader: useSortable({ id, data: { type: 'folder' } })
    + useDroppable({ id: folder.id + '-drop', data: { type: 'folder-target', folderId } })
      OR reuse the same useSortable-provided droppable id
    + isOver highlight applied when dragOverFolderId === folder.id

Tool rows: new DraggableToolRow component
  → useDraggable({ id: tool.id, data: { type: 'tool', toolId: tool.id } })
  → renders grip handle
  → opacity: 0.4 when isDragging (original stays in place)

SubfolderHeader: add useDroppable({ id: sub.id, data: { type: 'folder-target' } })
  + isOver highlight when dragOverFolderId === sub.id

DragOverlay:
  → renders when activeDragType === 'tool': a compact tool name chip
  → renders when activeDragType === 'folder': nothing (SortableFolderHeader handles its own ghost via isDragging opacity)
```

### Pattern 1: Data-Typed Draggables — Distinguishing Folder Drag from Tool Drag

The `data` prop on `useSortable` and `useDraggable` is the canonical way to carry type information into event handlers:

```typescript
// SortableFolderHeader — folder row
const { attributes, listeners, setNodeRef, ... } = useSortable({
  id: folder.id,
  data: { type: 'folder' },
})

// DraggableToolRow — tool row grip
const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
  id: tool.id,
  data: { type: 'tool', toolId: tool.id },
})

// In DndContext handlers:
function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event
  const dragType = active.data.current?.type

  if (dragType === 'folder') {
    // folder reorder logic
    const oldIndex = orderedFolders.findIndex((f) => f.id === active.id)
    const newIndex = orderedFolders.findIndex((f) => f.id === over?.id)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) return
    const reordered = arrayMove(orderedFolders, oldIndex, newIndex)
    setOrderedFolders(reordered)
    // persist positions
    startTransition(async () => {
      const result = await reorderFolders(reordered.map((f) => f.id))
      if (result?.error) toast.error(result.error)
    })
  } else if (dragType === 'tool') {
    // tool move logic
    setDragOverFolderId(null)
    if (!over) return
    const targetFolderId = over.id as string
    const toolId = active.id as string
    startTransition(async () => {
      const result = await updateToolConfig(toolId, { folder_id: targetFolderId })
      if (result?.error) {
        toast.error(result.error)
      } else {
        router.refresh()
        toast.success('Tool moved.')
      }
    })
  }

  setActiveId(null)
  setActiveDragType(null)
}
```

**Confidence:** HIGH — `active.data.current` is the documented @dnd-kit pattern for multi-type drag contexts.

### Pattern 2: useDroppable on Folder Headers for Tool Drop Target

`useDroppable` is separate from `useSortable`. A single component can use BOTH hooks. However, since `SortableFolderHeader` already uses `useSortable` (which internally uses both `useDraggable` and `useDroppable`), **we do NOT add a second `useDroppable` call on the same `id`**.

Instead: read `dragOverFolderId` from parent state. Parent sets `dragOverFolderId` in `onDragOver` whenever `activeDragType === 'tool'`. The folder header receives it as a prop `isDropTarget` and applies highlight.

```typescript
// In DndContext:
function handleDragOver(event: DragOverEvent) {
  const { active, over } = event
  if (active.data.current?.type === 'tool') {
    setDragOverFolderId(over ? (over.id as string) : null)
  }
}

// In SortableFolderHeader and SubfolderHeader — new prop:
isDropTarget: boolean  // = dragOverFolderId === folder.id

// Applied as className condition:
<TableRow
  ref={setNodeRef}
  style={style}
  className={cn(
    "bg-muted/40 hover:bg-muted/60 group",
    isDropTarget && "bg-primary/10 ring-1 ring-primary/40"
  )}
>
```

**Why this approach vs adding `useDroppable` inside the header component:** The `useSortable` hook already registers each folder header as a droppable with its folder id. The `closestCenter` collision detection will already set `over.id` to a folder id when a tool row is dragged near it. No additional `useDroppable` call is needed. Reading `over.id` in `onDragOver` and storing it in `dragOverFolderId` state is simpler and avoids double-registration.

**Confidence:** HIGH — verified by reading the @dnd-kit source: `useSortable` composes `useDraggable` + `useDroppable` on the same id; the droppable is already registered.

### Pattern 3: DraggableToolRow — Making Tool Rows Draggable

Tool rows are currently plain `<TableRow>` elements with `flexRender`. Phase 21 wraps the tool row rendering in a new component or inline logic using `useDraggable`:

```typescript
function DraggableToolRow({
  tool,
  row,
  isDragActive,
}: {
  tool: ToolConfigWithIntegration
  row: Row<ToolConfigWithIntegration>
  isDragActive: boolean
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tool.id,
    data: { type: 'tool', toolId: tool.id },
  })

  return (
    <TableRow
      ref={setNodeRef}
      className={cn(isDragging && "opacity-40")}
    >
      <TableCell className="w-6 px-2">
        <span
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground inline-flex"
          aria-label="Drag to move tool to folder"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </span>
      </TableCell>
      {row.getVisibleCells().map((cell) => (
        <TableCell key={cell.id}>
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  )
}
```

**Column count note:** Adding a grip column to tool rows means the `colSpan` on folder header rows needs to increase by 1. Currently `colSpan={columns.length}` (7 columns). After adding the grip column, `colSpan` becomes 8. The `columns` array definition (in the `useReactTable` call) does NOT need to include the grip column — the grip is rendered outside the table column definitions, using a manual `<TableCell>` prepended to the row. So the `colSpan` must be `columns.length + 1`.

**Alternative (simpler):** Do not add a grip as a true column; instead overlay a grip icon on the existing first cell using `group-hover` opacity-0/opacity-100 pattern. This avoids the colSpan change. **Recommended**: keep colSpan intact by using overlay pattern on the first cell (tool name cell) — add `relative` class to TableCell and absolutely position the GripVertical with `group-hover:opacity-100`.

### Pattern 4: Folder Position Persistence — reorderFolders Server Action

The `updateFolder(id, { position })` action exists and accepts a `position` number. To persist a folder reorder, the plan must update every folder's `position` to match its new array index. Two options:

**Option A — N individual `updateFolder` calls:**
```typescript
// After arrayMove:
const reordered = arrayMove(orderedFolders, oldIndex, newIndex)
setOrderedFolders(reordered)
startTransition(async () => {
  // Fire N updates — unordered promises
  const results = await Promise.all(
    reordered.map((folder, index) => updateFolder(folder.id, { position: index }))
  )
  const failed = results.find((r) => r && 'error' in r && r.error)
  if (failed) toast.error('Failed to save folder order.')
})
```
Pros: no new server action. Cons: N round-trips; any individual failure leaves positions inconsistent.

**Option B — Single `reorderFolders(orderedIds: string[])` server action:**
```typescript
// New server action in actions.ts
export async function reorderFolders(orderedIds: string[]): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  // Update each folder's position to its array index
  const updates = orderedIds.map((id, index) =>
    supabase.from('tool_folders').update({ position: index }).eq('id', id)
  )
  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed) return { error: 'Failed to save folder order.' }
  revalidatePath('/tools')
}
```
Pros: single server action call, single `revalidatePath`, consistent. Cons: still N Supabase queries internally (PostgREST does not support bulk updates in one statement without RPC).

**Recommendation: Option B (new `reorderFolders` action).** It's one server round-trip from the client's perspective, centralizes the logic, and matches the existing action pattern. The N internal Supabase queries are negligible for the expected folder count (< 20 folders typical).

### Pattern 5: DragOverlay

`DragOverlay` renders a floating clone that follows the cursor during drag. It must be inside `DndContext`:

```tsx
// New state: activeDragTool: ToolConfigWithIntegration | null
// Set in onDragStart when type === 'tool'

<DndContext ... onDragStart={handleDragStart}>
  {/* ... table ... */}
  <DragOverlay>
    {activeDragType === 'tool' && activeDragTool ? (
      <div className="bg-background border rounded px-3 py-1.5 text-sm font-mono shadow-md opacity-90">
        {activeDragTool.tool_name}
      </div>
    ) : null}
  </DragOverlay>
</DndContext>
```

For folder drags, `DragOverlay` renders nothing — the `SortableFolderHeader` already applies `opacity: isDragging ? 0.5 : 1` via the `style` object from `useSortable`, which gives a visual indicator without a separate overlay.

### Pattern 6: Collision Detection — closestCenter Works for Both Operations

The current `collisionDetection={closestCenter}` strategy works for both folder reorder and tool-to-folder-drop. When a tool row is dragged over a folder header, `closestCenter` identifies the closest registered droppable by center distance. Since folder headers are registered as droppables by `useSortable`, the tool drag will correctly detect the nearest folder header.

No change to `collisionDetection` is needed.

**Caveat:** If the user drags a tool into an empty area (no folder header nearby), `over` will be `null`. `handleDragEnd` must guard against `null` over: `if (!over) { reset state; return }`.

### Anti-Patterns to Avoid

- **Adding `useDroppable` to folder headers in addition to `useSortable`:** `useSortable` already registers the element as a droppable. A second `useDroppable({ id: folder.id })` would double-register and cause dnd-kit warnings. Use `dragOverFolderId` state instead.
- **Wrapping tool rows in `SortableContext`:** Tools do not sort among themselves in this phase. `useDraggable` (not `useSortable`) is the correct hook for tool rows.
- **Persisting folder order on every `onDragOver` event:** `onDragOver` fires many times per drag. Only persist in `onDragEnd`.
- **Updating `toolConfigs` local state after tool move without router.refresh():** After `updateToolConfig`, the tool's `folder_id` changes on the server. The local `toolConfigs` state (initialized from `initialToolConfigs`) is now stale. Call `router.refresh()` — the `useEffect` that syncs `orderedFolders` from props will handle folder state; tool state requires `router.refresh()` since `toolConfigs` is also prop-derived.
- **Forgetting to reset `dragOverFolderId` in `onDragEnd`:** If not reset, the highlight persists after drop.
- **Not guarding `active.data.current` as potentially undefined:** TypeScript types for dnd-kit mark `data.current` as `Record<string, any> | undefined`. Always use optional chaining: `active.data.current?.type`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Drag ghost / floating clone | Custom absolute-positioned clone via mouseMove | `DragOverlay` from @dnd-kit/core | Already in package; handles touch, keyboard, pointer events |
| Collision detection | Custom distance math | `closestCenter` (already configured) | Works for both sortable and droppable detection in the same context |
| Folder position integers | Gap-based numbering (0, 10, 20...) | Contiguous 0-based index after each reorder | Simpler; folders are reordered as a complete list each time |
| Tool move persistence | Custom fetch to /api | `updateToolConfig(id, { folder_id })` server action | Already exists, already handles auth + RLS |

---

## Server Action Inventory

### Already Exists — No Changes Needed
| Action | Signature | Phase 21 Use |
|--------|-----------|--------------|
| `updateFolder(id, data)` | `(string, { name?, position? }) => Promise<void \| {error}>` | Called by `reorderFolders` internally (or directly in Option A) |
| `updateToolConfig(id, data)` | `(string, { toolName, actionType, integrationId, fallbackMessage, folder_id?, ... }) => Promise<void \| {error}>` | Called on tool drop — **problem: requires full tool data, not just folder_id** |

### Problem: updateToolConfig Requires Full Payload

`updateToolConfig` in `actions.ts` (lines 162–199) requires `toolName`, `actionType`, `integrationId`, and `fallbackMessage` — it does a full update, not a partial patch. To move a tool to a folder by dragging, we either:

**Option A:** Pass the full existing tool data to `updateToolConfig`:
```typescript
await updateToolConfig(tool.id, {
  toolName: tool.tool_name,
  actionType: tool.action_type,
  integrationId: tool.integration_id,
  fallbackMessage: tool.fallback_message,
  config: tool.config as Record<string, unknown>,
  folder_id: targetFolderId,
  labels: tool.labels,
})
```
The `DraggableToolRow` receives the full `tool: ToolConfigWithIntegration` object, so all fields are available. This works but is semantically awkward (updating unrelated fields just to move a folder).

**Option B (recommended):** Add a new focused server action `moveToolToFolder(toolId: string, folderId: string | null)`:
```typescript
export async function moveToolToFolder(
  toolId: string,
  folderId: string | null
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('tool_configs')
    .update({ folder_id: folderId })
    .eq('id', toolId)
  if (error) return { error: error.message }
  revalidatePath('/tools')
}
```
This is a clean, single-purpose action. No full payload required.

**Recommendation: Option B.** Matches project pattern of single-purpose actions. Two new server actions for Phase 21: `reorderFolders` and `moveToolToFolder`.

### New Actions Needed (2)
| Action | Signature | Purpose |
|--------|-----------|---------|
| `reorderFolders(orderedIds)` | `(string[]) => Promise<void \| {error}>` | Bulk-update folder positions after drag reorder |
| `moveToolToFolder(toolId, folderId)` | `(string, string \| null) => Promise<void \| {error}>` | Update tool's folder_id after drag drop |

---

## Common Pitfalls

### Pitfall 1: `active.data.current` is undefined for useSortable items unless `data` prop is passed
**What goes wrong:** `handleDragEnd` calls `active.data.current?.type` and gets `undefined` — the code falls through to no-op.
**Why it happens:** `useSortable({ id })` without a `data` prop leaves `data.current` as `{}` (empty object, not undefined), so `type` is `undefined`. The `handleDragEnd` type check `=== 'folder'` fails.
**How to avoid:** Always pass `data: { type: 'folder' }` in `useSortable` inside `SortableFolderHeader`. Pass `data: { type: 'tool' }` in `useDraggable` inside the tool row component.
**Warning signs:** Both folder reorder and tool move silently fail — no toast, no state change.

### Pitfall 2: `dragOverFolderId` not reset on `onDragEnd` / `onDragCancel`
**What goes wrong:** The highlighted folder header stays highlighted after the user drops or cancels the drag.
**Why it happens:** `dragOverFolderId` state is set in `onDragOver` but only cleared in `onDragEnd`. If the user presses Escape to cancel, `onDragEnd` is not called; `onDragCancel` fires instead.
**How to avoid:** Add `onDragCancel` handler alongside `onDragEnd`:
```typescript
function handleDragCancel() {
  setActiveId(null)
  setActiveDragType(null)
  setDragOverFolderId(null)
}
// On DndContext: onDragCancel={handleDragCancel}
```

### Pitfall 3: Tool rows inside collapsed folders are not rendered — drag source is unmounted
**What goes wrong:** If a folder is collapsed, its tool rows are not in the DOM. If the user somehow initiates a drag on a collapsed tool (not possible via UI, but relevant for keyboard DnD), the drag source is unmounted.
**Why it happens:** The render loop skips tool rows when `collapsedFolders.has(folder.id)`.
**How to avoid:** This is not actually a problem in the current UI since collapsed folders hide the drag handles — no visible grip means no drag initiation. Document as a known constraint and move on.

### Pitfall 4: colSpan mismatch when grip column is added to tool rows
**What goes wrong:** Folder header rows use `colSpan={columns.length}` (currently 7). If a grip cell is added to tool rows as a real `<TableCell>`, the row has 8 cells. The folder header with `colSpan={7}` leaves a gap.
**Why it happens:** `columns.length` counts only the columns registered with `useReactTable`. The grip cell is not in the column definitions.
**How to avoid:** Use the overlay/hover approach (absolutely positioned grip icon inside the tool name cell's relative container) instead of a new TableCell. This avoids any colSpan change. OR update `colSpan` to `columns.length + 1` everywhere and add an empty header cell in `TableHeader`.
**Recommendation:** Use absolute positioning overlay — zero colSpan impact, no header change required.

### Pitfall 5: `updateToolConfig` requires full tool payload — forgetting this causes silent field wipe
**What goes wrong:** If `updateToolConfig` is called with only `folder_id` and no other fields, `tool_name`, `action_type`, etc. become empty strings or null — silently wiping tool data.
**Why it happens:** `updateToolConfig` does a full `.update({...})` with all provided fields. Missing fields default to `undefined` → `null` in the Supabase payload.
**How to avoid:** Use the new `moveToolToFolder(toolId, folderId)` server action which only touches `folder_id`. Never call `updateToolConfig` with a partial payload.

### Pitfall 6: `reorderFolders` called with subfolders in the array
**What goes wrong:** If subfolders are accidentally included in the `orderedIds` array passed to `reorderFolders`, their positions are updated, potentially conflicting with their parent folder's position ordering.
**Why it happens:** If `orderedFolders` state were to include subfolders (it shouldn't — it's filtered to `parent_id === null` on init and in the `useEffect` sync).
**How to avoid:** `reorderFolders` server action should add a guard: only update folders where `parent_id IS NULL`. Or rely on the client-side invariant that `orderedFolders` is always top-level only (enforced by the `useEffect` sync).

---

## Code Examples

### handleDragStart — set active state
```typescript
// Source: @dnd-kit/core DragStartEvent type
import { type DragStartEvent, type DragOverEvent, type DragEndEvent } from '@dnd-kit/core'

function handleDragStart(event: DragStartEvent) {
  const { active } = event
  setActiveId(active.id as string)
  const type = active.data.current?.type as 'folder' | 'tool' | undefined
  setActiveDragType(type ?? null)
  if (type === 'tool') {
    const tool = toolConfigs.find((t) => t.id === active.id)
    setActiveDragTool(tool ?? null)
  }
}
```

### handleDragOver — track which folder a tool is hovering
```typescript
function handleDragOver(event: DragOverEvent) {
  const { active, over } = event
  if (active.data.current?.type === 'tool') {
    setDragOverFolderId(over ? (over.id as string) : null)
  }
}
```

### handleDragEnd — branch on type
```typescript
function handleDragEnd(event: DragEndEvent) {
  const { active, over } = event
  const dragType = active.data.current?.type as 'folder' | 'tool' | undefined

  if (dragType === 'folder') {
    if (!over || active.id === over.id) { resetDragState(); return }
    const oldIndex = orderedFolders.findIndex((f) => f.id === active.id)
    const newIndex = orderedFolders.findIndex((f) => f.id === over.id)
    if (oldIndex === -1 || newIndex === -1 || oldIndex === newIndex) { resetDragState(); return }
    const reordered = arrayMove(orderedFolders, oldIndex, newIndex)
    setOrderedFolders(reordered)
    startTransition(async () => {
      const result = await reorderFolders(reordered.map((f) => f.id))
      if (result && 'error' in result && result.error) toast.error(result.error)
    })
  } else if (dragType === 'tool') {
    if (over) {
      const targetFolderId = over.id as string
      const toolId = active.id as string
      startTransition(async () => {
        const result = await moveToolToFolder(toolId, targetFolderId)
        if (result && 'error' in result && result.error) {
          toast.error(result.error)
        } else {
          toast.success('Tool moved.')
          router.refresh()
        }
      })
    }
  }
  resetDragState()
}

function resetDragState() {
  setActiveId(null)
  setActiveDragType(null)
  setActiveDragTool(null)
  setDragOverFolderId(null)
}
```

### reorderFolders server action (new, in actions.ts)
```typescript
export async function reorderFolders(orderedIds: string[]): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const updates = orderedIds.map((id, index) =>
    supabase.from('tool_folders').update({ position: index }).eq('id', id)
  )
  const results = await Promise.all(updates)
  const failed = results.find((r) => r.error)
  if (failed) return { error: 'Failed to save folder order.' }
  revalidatePath('/tools')
}
```

### moveToolToFolder server action (new, in actions.ts)
```typescript
export async function moveToolToFolder(
  toolId: string,
  folderId: string | null
): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase
    .from('tool_configs')
    .update({ folder_id: folderId })
    .eq('id', toolId)
  if (error) return { error: error.message }
  revalidatePath('/tools')
}
```

### SortableFolderHeader — data prop addition + isDropTarget highlight
```typescript
// In useSortable call (inside SortableFolderHeader):
const { ... } = useSortable({ id, data: { type: 'folder' } })

// TableRow with highlight:
<TableRow
  ref={setNodeRef}
  style={style}
  className={cn(
    "bg-muted/40 hover:bg-muted/60 group",
    isDragging && "opacity-50",
    isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary/40"
  )}
>
```

### DraggableToolRow — grip overlay on first cell
```typescript
// Uses 'relative' on first TableCell + absolutely positioned grip
function DraggableToolRow({ tool, row }: { tool: ToolConfigWithIntegration, row: Row<ToolConfigWithIntegration> }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tool.id,
    data: { type: 'tool' },
  })
  return (
    <TableRow ref={setNodeRef} className={cn(isDragging && "opacity-40 bg-muted/20")}>
      {row.getVisibleCells().map((cell, i) => (
        <TableCell key={cell.id} className={i === 0 ? "relative group/row" : undefined}>
          {i === 0 && (
            <span
              {...attributes}
              {...listeners}
              className="absolute left-1 top-1/2 -translate-y-1/2 cursor-grab active:cursor-grabbing text-muted-foreground opacity-0 group-hover/row:opacity-100 transition-opacity"
              aria-label="Drag to move to folder"
            >
              <GripVertical className="h-3 w-3" />
            </span>
          )}
          {flexRender(cell.column.columnDef.cell, cell.getContext())}
        </TableCell>
      ))}
    </TableRow>
  )
}
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `saveFolderOrder(ids: string[])` on organizations.tool_folder_order | `reorderFolders(ids)` updating `tool_folders.position` per row | Phase 19 | Proper relational model; position is per-folder not a global JSON array |
| Folder drag with `handleDragEnd` TODO stub | Full `handleDragEnd` routing by drag type | Phase 21 | Persistence lands in this phase |
| Tool rows are plain `<TableRow>` | Tool rows are `DraggableToolRow` with `useDraggable` | Phase 21 | Enables tool-to-folder drag |

---

## Environment Availability

Step 2.6: SKIPPED — this phase is pure TypeScript/React changes within the existing Next.js project. No new external tools, services, databases, or CLIs are required. @dnd-kit is already installed.

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run tests/tools/actions.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOLDER-04 | `reorderFolders(ids)` updates position for each folder and revalidates | unit | `npx vitest run tests/tools/actions.test.ts` | ❌ Wave 0 — add describe block |
| MOVE-01 | `moveToolToFolder(toolId, folderId)` updates folder_id and revalidates | unit | `npx vitest run tests/tools/actions.test.ts` | ❌ Wave 0 — add describe block |
| MOVE-02 | Folder header highlight when tool dragged over it | manual/visual | `npm run build` (type safety only) | N/A |

### Sampling Rate
- **Per task commit:** `npm run build`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** `npm run build` green + `npx vitest run` green (151+ tests pass)

### Wave 0 Gaps
- [ ] `tests/tools/actions.test.ts` — add `describe('reorderFolders: ...')` and `describe('moveToolToFolder: ...')` blocks with `it.todo` stubs

*(Existing test file has stubs for the Phase 19/20 actions. Phase 21 Wave 0 adds two new describe blocks.)*

---

## Open Questions

1. **Should `DraggableToolRow` be a named inner function or inlined in the map?**
   - What we know: `tools-table.tsx` is currently ~991 lines. Phase 21 adds ~80-120 more lines.
   - What's unclear: Whether a function defined inside the component causes unnecessary re-creation.
   - Recommendation: Named function defined outside `ToolsTable` (like `SortableFolderHeader` and `SubfolderHeader`) to avoid re-creation on each render. Receives `tool`, `row`, and no callbacks (uses `useDraggable` internally). No prop drilling needed for the drag interaction itself.

2. **Should `moveToolToFolder` also accept `null` to move a tool to Ungrouped?**
   - What we know: The action signature `(toolId, folderId: string | null)` already handles null.
   - What's unclear: Whether Phase 21 should support dragging a tool ONTO the "Ungrouped" section (currently `StaticFolderHeader` is not droppable).
   - Recommendation: Out of scope for Phase 21. `StaticFolderHeader` stays non-droppable. MOVE-01 only requires dragging onto folder/subfolder headers. Moving to Ungrouped is done via the tool edit form.

3. **What happens if the user drops a tool onto the folder it already belongs to?**
   - What we know: `handleDragEnd` would call `moveToolToFolder(tool.id, tool.folder_id)` — same value, no real change.
   - Recommendation: Guard in `handleDragEnd`: `if (tool.folder_id === targetFolderId) { resetDragState(); return }`. Avoids unnecessary server call and toast.

---

## Sources

### Primary (HIGH confidence)
- `src/components/tools/tools-table.tsx` — full file read; current DnD setup, all state, `handleDragEnd` TODO stub, `SortableFolderHeader`, `SubfolderHeader`, `DndContext` props verified
- `src/app/(dashboard)/tools/actions.ts` — full file read; all action signatures, `updateFolder(id, {position?})` exists, `updateToolConfig` requires full payload verified
- `tests/tools/actions.test.ts` — confirmed existing stubs, no Phase 21 stubs yet
- `package.json` — verified: `@dnd-kit/core ^6.3.1`, `@dnd-kit/sortable ^10.0.0`, `@dnd-kit/utilities ^3.2.2`
- `.planning/STATE.md` — locked decisions verified
- `.planning/REQUIREMENTS.md` — FOLDER-04, MOVE-01, MOVE-02 descriptions verified

### Secondary (MEDIUM confidence)
- [dnd-kit docs — useDroppable](https://github.com/dnd-kit/docs/blob/master/api-documentation/droppable/usedroppable.md) — `isOver` return value, `setNodeRef`, `data` prop confirmed
- [dnd-kit docs — useDraggable React hook](https://dndkit.com/react/hooks/use-draggable/) — `data` prop, `type` parameter, `isDragging` return confirmed
- [dnd-kit collision detection](https://dndkit.com/legacy/api-documentation/context-provider/collision-detection-algorithms/) — `closestCenter` works for both sortable and droppable use cases confirmed
- `active.data.current?.type` pattern — confirmed via @dnd-kit source and community discussions as the canonical way to distinguish drag types in a multi-type context

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all required primitives confirmed in installed packages
- Architecture (data-typed drags, single DndContext): HIGH — `active.data.current` is documented @dnd-kit pattern; verified via docs and source
- Server actions (reorderFolders, moveToolToFolder): HIGH — both are simple Supabase `.update()` actions following the established pattern in actions.ts
- Visual highlight pattern (dragOverFolderId state): HIGH — simpler and more reliable than secondary `useDroppable` on already-sortable headers
- Pitfalls: HIGH — all derived from direct reading of current tools-table.tsx and @dnd-kit behavior

**Research date:** 2026-05-06
**Valid until:** Stable within this milestone — valid until tools-table.tsx, actions.ts, or @dnd-kit packages are changed; 60 days minimum

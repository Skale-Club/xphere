# Phase 20: Folder & Subfolder CRUD - Research

**Researched:** 2026-05-06
**Domain:** React UI patterns — inline rename, collapsible sections, delete confirmation modal, folder Select in form
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from STATE.md Decisions)

### Locked Decisions
- Layout: inline collapsible sections in the tools table (not a sidebar tree)
- Max 2 levels only (folder > subfolder); no deeper nesting
- Inline rename — click label → input, Enter confirms, Escape cancels
- Delete modal: two options — orphan tools OR delete tools with folder
- Create subfolder: (+) button on parent folder header (on hover)
- `@dnd-kit` already installed — do NOT add new DnD in this phase (Phase 21 owns DnD)
- `handleAddFolder` stubbed in tools-table.tsx — Phase 20 wires it to `createFolder()` server action
- `handleDragEnd` local reorder only (Phase 21 persists to server)
- Folder text input removed from tool-config-form — Phase 20 adds proper folder Select

### Claude's Discretion
- Plan breakdown (number of plans, wave structure)
- Whether inline rename state lives in `SortableFolderHeader` or in a shared state in `ToolsTable`
- Whether the delete-with-tools variant uses an additional server action or a parameter on `deleteFolder`
- Exact indentation/visual treatment for subfolders

### Deferred Ideas (OUT OF SCOPE)
- FOLDER-04 (folder reorder DnD) — Phase 21
- MOVE-01/MOVE-02 (tool drag to folder) — Phase 21
- Bulk-move multiple tools
- Folder color/icon customization
- Keyboard navigation for folder tree
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FOLDER-01 | Admin can create a named top-level folder | `handleAddFolder` stub in tools-table.tsx wires to `createFolder(name, null)`; toolbar already has FolderPlus button + inline form |
| FOLDER-02 | Admin can rename a folder inline (Enter confirms, Escape cancels) | Inline rename pattern: controlled input in SortableFolderHeader; `updateFolder(id, { name })` server action exists |
| FOLDER-03 | Admin can delete a folder via modal with orphan-or-delete choice | AlertDialog already used in tools-table; `deleteFolder(id)` handles orphan; need `deleteFolderWithTools(id)` action for cascade |
| SUBFOLDER-01 | Admin can create a subfolder via (+) on parent folder header | `createFolder(name, parentId)` signature already accepts parentId |
| SUBFOLDER-02 | Admin can rename a subfolder inline (same pattern as top-level) | Same inline rename pattern; same `updateFolder` action |
| SUBFOLDER-03 | Admin can delete a subfolder via same confirmation modal | Same delete modal; subfolder delete = same as folder delete |
| DISPLAY-01 | Folders and subfolders render as collapsible sections inline | tools-table.tsx already renders folders; needs collapse toggle + subfolder nesting |
| DISPLAY-02 | Ungrouped section at bottom for tools with no folder_id | `otherTools` already computed; "Other" label needs rename to "Ungrouped" |
</phase_requirements>

---

## Summary

Phase 20 is a pure UI phase. All server-side infrastructure (DB schema, server actions, TypeScript types) is complete from Phase 19. The work is entirely in `tools-table.tsx`, `tool-config-form.tsx`, and a small addition to `actions.ts` (one new `deleteFolderWithTools` action for the "delete with folder" modal option).

The current `tools-table.tsx` already groups tools by `folder_id`, renders `SortableFolderHeader` rows with DnD wiring, and stubs `handleAddFolder`. Phase 20 unwires the stubs, adds collapsible state per folder, adds inline rename state, adds the subfolder rendering tier, adds the delete confirmation modal for folders, and wires the folder selector into `tool-config-form.tsx`.

**Primary recommendation:** Implement everything as state additions and component extensions within the existing `tools-table.tsx` and `tool-config-form.tsx` files. Do not extract a separate file unless `tools-table.tsx` grows beyond ~800 lines with the additions.

---

## Standard Stack

### Core (already installed — no new packages)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React `useState` | 18.x (project-pinned) | Collapse state, inline rename state, delete target state | Already used throughout tools-table.tsx |
| `@dnd-kit/core` + `@dnd-kit/sortable` | 6.3.1 / 10.0.0 | DnD context wrapping folders; DnD MUST NOT be changed in this phase | Already installed and used |
| `lucide-react` | ^1.7.0 | ChevronRight/ChevronDown for collapse; Pencil for rename; Trash2 for delete; Plus for subfolder add | Already used in tools-table.tsx |
| shadcn `AlertDialog` | Radix ^1.1.15 | Two-option delete confirmation modal | Already imported in tools-table.tsx |
| shadcn `Input` | Radix (via shadcn) | Inline rename input field | Already imported in tools-table.tsx |
| shadcn `Select` | Radix ^2.2.6 | Folder picker in tool-config-form | Already imported in tool-config-form.tsx |
| `sonner` toast | project-pinned | Error/success feedback on CRUD | Already used in tools-table.tsx |
| `useTransition` (React) | 18.x | Non-blocking server action calls | Already used in tools-table.tsx for deleteToolConfig |

**Installation:** No new packages needed.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| CSS height transition for collapse | Radix Collapsible | Radix Collapsible requires an additional Radix primitive install; plain `hidden` class toggle is sufficient here since tool rows are TableRows, not block elements |
| Inline rename in SortableFolderHeader | Separate dialog | Inline rename is the locked decision; dialog would be a deviation |

---

## Architecture Patterns

### Component Topology After Phase 20

```
tools-table.tsx (ToolsTable)
  ├── state: orderedFolders (ToolFolder[])    — top-level folders, order preserved from Phase 19
  ├── state: collapsedFolders (Set<string>)   — folder IDs that are collapsed
  ├── state: renamingFolderId (string | null) — which folder is in inline-rename mode
  ├── state: renameValue (string)             — controlled input value for inline rename
  ├── state: deleteFolderTarget ({ folder: ToolFolder, mode: 'orphan' | 'delete-with-tools' } | null)
  ├── state: addingSubfolderTo (string | null) — parent folder ID for inline subfolder add form
  ├── state: newSubfolderName (string)
  ├── SortableFolderHeader (extended)
  │     ├── Shows label OR inline rename Input
  │     ├── Hover actions: rename icon, delete icon, (+) for subfolder
  │     └── Chevron collapse toggle
  ├── SubfolderHeader (new static row, not DnD — Phase 21 owns DnD)
  │     ├── Shows indented label OR inline rename Input
  │     └── Hover actions: rename icon, delete icon
  ├── AlertDialog (folder delete confirmation — 2 options)
  └── AlertDialog (tool delete — already exists, unchanged)

tool-config-form.tsx
  └── folder_id FormField: Select showing flat list of folders/subfolders with indentation
```

### Pattern 1: Collapse Toggle with Set State

State lives in `ToolsTable`, not inside header components. Header receives `isCollapsed` boolean and `onToggleCollapse` callback.

```typescript
// In ToolsTable
const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())

function toggleCollapse(folderId: string) {
  setCollapsedFolders((prev) => {
    const next = new Set(prev)
    if (next.has(folderId)) next.delete(folderId)
    else next.add(folderId)
    return next
  })
}

// In render: skip tool rows when folder is collapsed
{!collapsedFolders.has(folder.id) && tools.map((tool) => (...))}

// Also skip subfolder rows when parent is collapsed
```

**Why Set over boolean per-folder:** Single state value; easily serialized to localStorage if persistence is desired in a future phase; O(1) lookup.

### Pattern 2: Inline Rename with onKeyDown

State lives in `ToolsTable`. `renamingFolderId` tracks which folder is being edited; `renameValue` holds the controlled input.

```typescript
// In ToolsTable
const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
const [renameValue, setRenameValue] = useState('')

function startRename(folder: ToolFolder) {
  setRenamingFolderId(folder.id)
  setRenameValue(folder.name)
}

async function commitRename(folderId: string) {
  const trimmed = renameValue.trim()
  setRenamingFolderId(null)
  setRenameValue('')
  if (!trimmed) return // empty = cancel
  startTransition(async () => {
    const result = await updateFolder(folderId, { name: trimmed })
    if (result && 'error' in result && result.error) {
      toast.error(result.error)
    } else {
      // Optimistic: update local orderedFolders state + subfolder list
      setOrderedFolders((prev) =>
        prev.map((f) => f.id === folderId ? { ...f, name: trimmed } : f)
      )
      toast.success('Folder renamed.')
    }
  })
}

// In SortableFolderHeader when renamingFolderId === folder.id:
<Input
  autoFocus
  value={renameValue}
  onChange={(e) => setRenameValue(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === 'Enter') commitRename(folder.id)
    if (e.key === 'Escape') { setRenamingFolderId(null); setRenameValue('') }
  }}
  onBlur={() => commitRename(folder.id)}  // blur = confirm
  className="h-6 text-xs w-32 py-0"
/>
```

**Key behavior:** `onBlur` commits (same as Enter). Escape cancels without saving. Empty string on Enter/blur = cancel.

**Subfolder rename:** Same pattern using the same `renamingFolderId`/`renameValue` state — folder IDs are globally unique, so a single pair of state values covers both levels.

### Pattern 3: Subfolder Rendering (Indented Static Rows)

Subfolders are rendered inside the parent folder's collapsed/expanded region. They are NOT wrapped in SortableContext for Phase 20 (DnD for subfolder reorder is out of scope; Phase 21 handles it).

```typescript
// Compute subfolders per parent — derived from full folders prop
const subfoldersByParent = useMemo(() => {
  const map = new Map<string, ToolFolder[]>()
  for (const f of folders) {
    if (f.parent_id !== null) {
      if (!map.has(f.parent_id)) map.set(f.parent_id, [])
      map.get(f.parent_id)!.push(f)
    }
  }
  return map
}, [folders])

// In render, inside each orderedFolder's Fragment:
{!collapsedFolders.has(folder.id) && (
  <>
    {/* subfolders */}
    {(subfoldersByParent.get(folder.id) ?? []).map((sub) => (
      <Fragment key={`sub-${sub.id}`}>
        <SubfolderHeader ... />
        {/* tools in subfolder */}
        {!collapsedFolders.has(sub.id) && (toolsByFolder.get(sub.id) ?? []).map(...)}
      </Fragment>
    ))}
    {/* tools directly in this top-level folder */}
    {(toolsByFolder.get(folder.id) ?? []).map(...)}
  </>
)}
```

Subfolder header indentation: `pl-8` (vs folder header `pl-4`) in the `TableCell`.

### Pattern 4: Add Subfolder (Inline Form in Header Row)

When `addingSubfolderTo === folder.id`, render an extra `TableRow` immediately below the folder header (before its subfolders):

```typescript
{addingSubfolderTo === folder.id && (
  <TableRow>
    <TableCell colSpan={columns.length} className="py-1 pl-10">
      <form onSubmit={(e) => handleAddSubfolder(e, folder.id)} className="flex items-center gap-1">
        <Input autoFocus value={newSubfolderName} onChange={...} onKeyDown={escapeHandler} placeholder="Subfolder name" className="h-7 w-36 text-xs" />
        <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">Add</Button>
        <Button type="button" size="sm" variant="ghost" className="h-7 text-xs" onClick={cancelSubfolder}>Cancel</Button>
      </form>
    </TableCell>
  </TableRow>
)}
```

The (+) button appears on hover of the folder header row (using a `group` class on the TableRow and `opacity-0 group-hover:opacity-100` on the button). This matches the existing pattern in `integrations-table.tsx` (ChevronRight with `opacity-0 group-hover:opacity-100`).

### Pattern 5: Delete Folder Modal (Two Options)

The current delete target state for tools (`deleteTarget: ToolConfigWithIntegration | null`) is already used. Add a parallel state for folder deletion:

```typescript
type FolderDeleteTarget = {
  folder: ToolFolder
} | null

const [folderDeleteTarget, setFolderDeleteTarget] = useState<FolderDeleteTarget>(null)
```

The modal offers two `AlertDialogAction` buttons:

```tsx
<AlertDialog open={!!folderDeleteTarget} onOpenChange={(open) => !open && setFolderDeleteTarget(null)}>
  <AlertDialogContent>
    <AlertDialogHeader>
      <AlertDialogTitle>Delete "{folderDeleteTarget?.folder.name}"?</AlertDialogTitle>
      <AlertDialogDescription>
        Choose what happens to the tools inside this folder.
      </AlertDialogDescription>
    </AlertDialogHeader>
    <AlertDialogFooter className="flex-col sm:flex-row gap-2">
      <AlertDialogCancel>Cancel</AlertDialogCancel>
      <AlertDialogAction
        variant="outline"
        onClick={() => handleDeleteFolder('orphan')}
      >
        Move tools to Ungrouped
      </AlertDialogAction>
      <AlertDialogAction
        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        onClick={() => handleDeleteFolder('delete-with-tools')}
      >
        Delete folder and tools
      </AlertDialogAction>
    </AlertDialogFooter>
  </AlertDialogContent>
</AlertDialog>
```

**"Move tools to Ungrouped"** calls existing `deleteFolder(id)` — the DB `ON DELETE SET NULL` on `tool_configs.folder_id` already orphans the tools automatically.

**"Delete folder and tools"** requires a new server action `deleteFolderWithTools(id)` that: (1) deletes all `tool_configs` WHERE `folder_id = id` (or any subfolder), then (2) deletes the folder. The cascade `ON DELETE CASCADE` on `tool_folders.parent_id` handles subfolders automatically when the parent is deleted.

### Pattern 6: Create Top-Level Folder (Wire the Existing Stub)

The existing `handleAddFolder` in `tools-table.tsx` already has the form UI. The only change is wiring it to `createFolder()`:

```typescript
// Replace TODO comment:
startTransition(async () => {
  const result = await createFolder(name)
  if (result && 'error' in result && result.error) {
    toast.error(result.error)
  } else {
    router.refresh() // getFolders() re-runs on the server; or optimistic update
    toast.success('Folder created.')
  }
})
```

`router.refresh()` re-fetches server data (triggers `page.tsx` to re-call `getFolders()`) which is the correct pattern for this project. Alternatively, optimistic update: append a temporary ToolFolder with a fake id and update after refresh. **Recommendation: use `router.refresh()` for simplicity**; optimistic update is not necessary here.

### Pattern 7: Folder Select in tool-config-form

The `folder_id` field in `toolConfigSchema` exists but has no visible UI (Phase 19 stub). Phase 20 adds a `<Select>` for it. The selector shows a flat list with visual hierarchy:

```tsx
<FormField
  control={form.control}
  name="folder_id"
  render={({ field }) => (
    <FormItem>
      <FormLabel>Folder <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
      <Select
        onValueChange={(v) => field.onChange(v === '__none__' ? null : v)}
        value={field.value ?? '__none__'}
      >
        <FormControl>
          <SelectTrigger>
            <SelectValue placeholder="No folder" />
          </SelectTrigger>
        </FormControl>
        <SelectContent>
          <SelectItem value="__none__">No folder</SelectItem>
          {existingFolders
            ?.filter((f) => f.parent_id === null)
            .map((folder) => (
              <Fragment key={folder.id}>
                <SelectItem value={folder.id}>{folder.name}</SelectItem>
                {existingFolders
                  .filter((sub) => sub.parent_id === folder.id)
                  .map((sub) => (
                    <SelectItem key={sub.id} value={sub.id}>
                      &nbsp;&nbsp;{sub.name}
                    </SelectItem>
                  ))}
              </Fragment>
            ))}
        </SelectContent>
      </Select>
      <FormMessage />
    </FormItem>
  )}
/>
```

`existingFolders` prop is already typed as `ToolFolder[]` and passed from `ToolsTable` → `ToolConfigForm`.

### Anti-Patterns to Avoid

- **Collapse state inside SortableFolderHeader:** State must live in ToolsTable so the table row rendering (skip/show tool rows) can be controlled. Headers only receive props.
- **New DnD primitives or hooks:** The phase 20 description explicitly says "do NOT add new DnD". SubfolderHeader is a plain static TableRow, NOT wrapped in useSortable.
- **Separate `/api` route for delete-with-tools:** This is a server action, not a route handler. Stay consistent with the existing pattern in actions.ts.
- **Calling `router.refresh()` inside `startTransition`:** `router.refresh()` from `next/navigation` must be called outside `startTransition` or will be a no-op in some React versions. Use `revalidatePath` (server side) as the canonical invalidation signal, which triggers the page re-render.
- **Renaming "Other" to "Ungrouped" in a separate PR:** The current tools-table.tsx uses `label="Other"` for the ungrouped section (line 506). DISPLAY-02 requires the label "Ungrouped". This is a one-line change included in Plan 1.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Delete cascade to subfolders | Loop in JS to delete each subfolder | PostgreSQL `ON DELETE CASCADE` on `tool_folders.parent_id` | Already in the DB schema from Phase 19; atomic, cannot be skipped |
| Orphan tools on folder delete | Update loop in JS to NULL out folder_id | PostgreSQL `ON DELETE SET NULL` on `tool_configs.folder_id` | Already in the DB schema from Phase 19 |
| Modal animation | Custom CSS keyframes | AlertDialog from shadcn (Radix) | Already imported in tools-table.tsx |
| Hover show/hide for action buttons | mouseEnter/mouseLeave event handlers | Tailwind `group` + `opacity-0 group-hover:opacity-100` | Pattern already used in integrations-table.tsx |
| Controlled select null value | z.string().uuid() fails for "no folder" | Use sentinel value `'__none__'` → convert to null before submit | Radix Select requires a non-null value for the empty option |

---

## Server Action Inventory (What Exists vs What Phase 20 Needs)

### Already Exists (NO changes needed)
| Action | Signature | Phase 20 Use |
|--------|-----------|--------------|
| `getFolders()` | `(): Promise<ToolFolder[]>` | Called by page.tsx; data flows to ToolsTable via `folders` prop |
| `createFolder(name, parentId?)` | `(string, string | null): Promise<void | {error}>` | Wire from `handleAddFolder` (top-level) and `handleAddSubfolder` (subfolder) |
| `updateFolder(id, data)` | `(string, {name?, position?}): Promise<void | {error}>` | Inline rename for folders and subfolders |
| `deleteFolder(id)` | `(string): Promise<void | {error}>` | "Move tools to Ungrouped" option — DB cascade handles orphaning |

### Needs Adding (1 new action in actions.ts)
| Action | Signature | Purpose |
|--------|-----------|---------|
| `deleteFolderWithTools(id)` | `(string): Promise<void | {error}>` | "Delete folder and tools" option — deletes all tool_configs in folder/subfolders, then deletes folder |

**`deleteFolderWithTools` implementation:**

```typescript
export async function deleteFolderWithTools(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()

  // Delete all tools in this folder or any subfolder of it
  // First, collect subfolder IDs
  const { data: subfolders } = await supabase
    .from('tool_folders')
    .select('id')
    .eq('parent_id', id)

  const subfolderIds = (subfolders ?? []).map((s) => s.id)
  const folderIds = [id, ...subfolderIds]

  // Delete tools in all these folders
  const { error: toolsError } = await supabase
    .from('tool_configs')
    .delete()
    .in('folder_id', folderIds)

  if (toolsError) return { error: toolsError.message }

  // Delete the folder (cascade removes subfolders automatically)
  const { error: folderError } = await supabase
    .from('tool_folders')
    .delete()
    .eq('id', id)

  if (folderError) return { error: folderError.message }
  revalidatePath('/tools')
}
```

**Why only 1 level of subfolder lookup:** Phase 20 enforces max 2 levels (folder > subfolder). There are no sub-subfolders, so one level of subfolder lookup is sufficient. No recursion needed.

---

## Current State: Key Stubs to Wire in Phase 20

From `19-03-SUMMARY.md` Known Stubs:

1. **`handleAddFolder` in tools-table.tsx** (line ~191-202) — form UI exists, create button exists, but the function body has `// TODO Phase 20: call createFolder(name) server action here`. Phase 20 wires this.

2. **`folder_id` field in tool-config-form.tsx** (line ~261) — schema field and `defaultValues` wiring are present, but a comment says `Phase 20 will add a proper folder selector UI here`. The `<FormField>` JSX block is absent.

3. **"Other" label in tools-table.tsx** (line ~506) — `label="Other"` should become `label="Ungrouped"` per DISPLAY-02.

4. **`orderedFolders` state** — currently only holds top-level folders (filtered by `parent_id === null`). The subfolder rendering needs a separate `subfoldersByParent` map (see Pattern 3 above). The `orderedFolders` state itself is correct as-is.

---

## Common Pitfalls

### Pitfall 1: AlertDialog `AlertDialogAction` does not accept `variant` prop
**What goes wrong:** The `AlertDialogAction` component in shadcn is NOT a Button — it is `AlertDialogPrimitive.Action` with `buttonVariants()` applied via `cn()`. It does not forward a `variant` prop directly.
**Why it happens:** Looking at `alert-dialog.tsx`, `AlertDialogAction` uses `className={cn(buttonVariants(), className)}` — the variant is baked in. There is no `variant` prop.
**How to avoid:** Pass a custom className to override button styles. For the secondary "orphan" button, use `className={cn(buttonVariants({ variant: 'outline' }))}`. For the destructive button, use `className="bg-destructive text-destructive-foreground hover:bg-destructive/90"` as the existing delete modal already does.

### Pitfall 2: Radix Select does not accept `null` or `undefined` as value
**What goes wrong:** If `field.value` is `null` (no folder assigned), passing it directly as `<Select value={null}>` causes a Radix type error and the placeholder does not render.
**Why it happens:** Radix Select expects a `string` value. `null` is not a valid Select value.
**How to avoid:** Use a sentinel string `'__none__'` for the "No folder" state. On submit, convert back: `folder_id: values.folder_id === '__none__' ? null : values.folder_id`. In `defaultValues`, convert the stored `null` to `'__none__'`: `folder_id: toolConfig?.folder_id ?? '__none__'`. Also update the zod schema for this field: `folder_id: z.string().optional()` (not `.uuid()`, since `'__none__'` is not a UUID) and validate the UUID only when it's not the sentinel.

### Pitfall 3: `router.refresh()` does not update local `orderedFolders` state
**What goes wrong:** After `createFolder()` succeeds, calling `router.refresh()` triggers a server re-render and the `folders` prop on `ToolsTable` gets fresh data — BUT React does not re-initialize `orderedFolders` from the updated prop because `useState` only uses its initializer once.
**Why it happens:** `useState(() => folders.filter(...))` runs only on mount. `router.refresh()` sends fresh data to the server component (page.tsx), which re-renders with the new `folders` prop, but the client component's `orderedFolders` state is stale.
**How to avoid:** Two options:
  - Option A (recommended): Use a `useEffect` that syncs `orderedFolders` from the `folders` prop when the prop changes. `useEffect(() => { setOrderedFolders(folders.filter(f => f.parent_id === null)) }, [folders])`. This handles all cases (add, delete, rename from server).
  - Option B: Use optimistic updates — append/remove from local state immediately, then `router.refresh()` confirms. More responsive but more code.
  Recommendation: Option A is simpler and correct for this phase. Optimistic updates are a Phase 21 concern.

### Pitfall 4: Inline rename `onBlur` fires when clicking the Cancel button
**What goes wrong:** When the user clicks Cancel, the input loses focus first (triggering `onBlur` → `commitRename`) before the Cancel button's `onClick` fires.
**Why it happens:** Browser focus events precede click events.
**How to avoid:** In `onBlur`, check if the related target is the cancel button before committing:
```typescript
onBlur={(e) => {
  if (e.relatedTarget?.getAttribute('data-rename-cancel') === 'true') return
  commitRename(folderId)
}}
```
And add `data-rename-cancel="true"` to the cancel button. Alternatively, use `mousedown` on Cancel with `e.preventDefault()` to prevent the blur from firing before the click.

### Pitfall 5: `SortableFolderHeader` renders a `<tr>` which cannot directly contain an `<input>`
**What goes wrong:** TableRow renders as `<tr>`. An `<input>` inside `<td>` is valid, but rendering the Input in the wrong place causes hydration errors.
**Why it happens:** In the existing `SortableFolderHeader`, the label is in `<TableCell colSpan={colSpan}>`. The inline rename replaces the `<span>` label inside `TableCell` with an `<Input>` — this is valid HTML (`<td>` can contain any flow content).
**How to avoid:** Ensure the Input is inside `<TableCell>`, not directly inside `<TableRow>`. The existing structure already puts content inside `<TableCell>`, so this is safe as long as the Input replaces only the label `<span>`.

### Pitfall 6: `createFolder` position collisions
**What goes wrong:** All folders are created with `position: 0` (Phase 19 decision). If the user creates multiple folders rapidly, they all have `position: 0`, and the `getFolders()` query (ordered by `position ASC`) returns them in arbitrary order.
**Why it happens:** `createFolder` in actions.ts hardcodes `position: 0`.
**How to avoid:** Phase 20 does NOT need to fix this — position management is Phase 21 scope (drag reorder). The user-visible order after creation is based on database insertion order when positions tie. Document as a known limitation until Phase 21.

---

## Code Examples

### Verified: Existing SortableFolderHeader (Phase 19 output)
```typescript
// Source: src/components/tools/tools-table.tsx (current state)
function SortableFolderHeader({ id, label, count, colSpan }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  // ...
  return (
    <TableRow ref={setNodeRef} style={style} className="bg-muted/30 hover:bg-muted/40">
      <TableCell colSpan={colSpan} className="py-1.5 px-4">
        <div className="flex items-center gap-2">
          <span {...attributes} {...listeners} className="cursor-grab ...">
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
          <span className="text-xs text-muted-foreground">({count})</span>
        </div>
      </TableCell>
    </TableRow>
  )
}
```

**Phase 20 extends this with:** chevron collapse toggle, conditional Input vs label span, hover action buttons (rename, add-subfolder, delete).

### Verified: Hover button pattern from integrations-table.tsx
```typescript
// Source: src/components/integrations/integrations-table.tsx
<ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
// TableRow has className="group" to enable group-hover
```

### Verified: handleAddFolder stub (Phase 19 output)
```typescript
// Source: src/components/tools/tools-table.tsx lines 191-202
function handleAddFolder(e: React.FormEvent) {
  e.preventDefault()
  const name = newFolderName.trim()
  if (!name) {
    setAddingFolder(false)
    setNewFolderName('')
    return
  }
  // TODO Phase 20: call createFolder(name) server action here
  setAddingFolder(false)
  setNewFolderName('')
}
```

### Verified: deleteFolder action signature (Phase 19 output)
```typescript
// Source: src/app/(dashboard)/tools/actions.ts
export async function deleteFolder(id: string): Promise<{ error?: string } | void> {
  const user = await getUser()
  if (!user) return { error: 'Not authenticated.' }
  const supabase = await createClient()
  const { error } = await supabase.from('tool_folders').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/tools')
}
```

DB `ON DELETE SET NULL` on `tool_configs.folder_id` orphans tools automatically. No JS loop needed.

---

## Environment Availability

Step 2.6: SKIPPED — this phase is pure UI/TypeScript changes. No new external tools, services, databases, or CLIs are required beyond what is already running.

---

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest |
| Config file | `vitest.config.ts` (assumed, not checked — existing tests run with `npx vitest run`) |
| Quick run command | `npx vitest run tests/tools/actions.test.ts` |
| Full suite command | `npx vitest run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOLDER-01 | `createFolder(name, null)` creates row and revalidates | unit | `npx vitest run tests/tools/actions.test.ts` | ✅ (stub only — implement) |
| FOLDER-02 | `updateFolder(id, {name})` renames and revalidates | unit | `npx vitest run tests/tools/actions.test.ts` | ✅ (stub only — implement) |
| FOLDER-03 | `deleteFolder(id)` orphans tools (DB cascade); `deleteFolderWithTools(id)` deletes tools | unit | `npx vitest run tests/tools/actions.test.ts` | ✅ (partial stubs — need `deleteFolderWithTools` stub) |
| SUBFOLDER-01 | `createFolder(name, parentId)` with non-null parentId | unit | `npx vitest run tests/tools/actions.test.ts` | ✅ (same test file) |
| SUBFOLDER-02 | Same `updateFolder` action | unit | same | ✅ |
| SUBFOLDER-03 | Same `deleteFolder` action on a subfolder | unit | same | ✅ |
| DISPLAY-01 | Collapsible sections render correctly | manual/visual | `npm run build` (type safety) | N/A |
| DISPLAY-02 | "Ungrouped" label appears for tools with `folder_id = null` | manual/visual | `npm run build` | N/A |

### Sampling Rate
- **Per task commit:** `npm run build` (catches TypeScript errors)
- **Per wave merge:** `npx vitest run`
- **Phase gate:** `npm run build` green + `npx vitest run` green (151+ tests pass)

### Wave 0 Gaps
- [ ] `tests/tools/actions.test.ts` — existing stubs need implementation (currently all `it.todo`). Add `deleteFolderWithTools` stubs to match the new action.

*(The test file exists; it has stubs from Phase 19 Wave 0. Phase 20 Wave 0 just needs to add `deleteFolderWithTools` describe block and implement the stubs.)*

---

## Open Questions

1. **Should `deleteFolderWithTools` be a separate action or a parameter on `deleteFolder`?**
   - What we know: `deleteFolder(id)` currently does a simple delete. Adding `mode: 'orphan' | 'delete-with-tools'` parameter would keep the API surface smaller.
   - What's unclear: Whether adding a parameter changes the action signature in a way that breaks type inference for callers.
   - Recommendation: Separate `deleteFolderWithTools(id)` action is clearer — each action has one purpose. The modal handler decides which to call based on user choice.

2. **Should tools-table.tsx be split into sub-components in Phase 20?**
   - What we know: The file is currently ~593 lines. Phase 20 adds inline rename state, collapse state, subfolder rendering, subfolder add form, folder delete modal — estimated addition of ~150-200 lines.
   - What's unclear: Whether ~750-800 lines is acceptable or triggers a split.
   - Recommendation: Keep as one file for Phase 20. Extract `FolderSection` as a sub-component (but not a separate file) only if lines exceed 900. Phase 21 (DnD) may require restructuring anyway.

3. **Should `collapsedFolders` state persist across page navigations?**
   - What we know: Currently no persistence pattern is established; all state is in-memory.
   - What's unclear: Whether users will find it annoying to re-expand folders on each navigation.
   - Recommendation: No persistence for Phase 20 (start expanded by default). This is a future enhancement.

---

## Sources

### Primary (HIGH confidence)
- `src/components/tools/tools-table.tsx` — current state after Phase 19; all existing patterns, stubs, and imports verified by direct file read
- `src/app/(dashboard)/tools/actions.ts` — exact action signatures verified by direct file read
- `src/components/tools/tool-config-form.tsx` — current state, folder_id stub location, form patterns
- `src/app/(dashboard)/tools/page.tsx` — confirmed getFolders() call and folders prop passing
- `src/components/ui/alert-dialog.tsx` — confirmed AlertDialogAction does not accept variant prop
- `src/components/ui/select.tsx` — confirmed Radix Select requires string value (not null)
- `src/components/integrations/integrations-table.tsx` — hover button pattern with `group`/`opacity-0 group-hover:opacity-100`
- `tests/tools/actions.test.ts` — confirmed test stubs exist; `deleteFolderWithTools` not yet stubbed
- `.planning/STATE.md` — locked design decisions verified
- `.planning/REQUIREMENTS.md` — requirement IDs and descriptions verified
- `.planning/phases/19-db-foundation/19-02-SUMMARY.md` — action signatures confirmed
- `.planning/phases/19-db-foundation/19-03-SUMMARY.md` — stub locations confirmed

### Secondary (MEDIUM confidence)
- `package.json` — confirmed @dnd-kit/core 6.3.1, @dnd-kit/sortable 10.0.0, lucide-react ^1.7.0 installed

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified as already installed; no new installs needed
- Architecture patterns: HIGH — all patterns derived from direct file reads of current codebase
- Server action changes: HIGH — one new action needed (`deleteFolderWithTools`); all others exist with correct signatures
- Pitfalls: HIGH — all derived from direct inspection of shadcn component source (alert-dialog.tsx, select.tsx) and React event ordering knowledge
- Subfolder rendering: HIGH — direct read of tools-table.tsx confirms the extension points

**Research date:** 2026-05-06
**Valid until:** Stable within this milestone — valid until tools-table.tsx, actions.ts, or shadcn components are changed; 60 days minimum

'use client'

// Generic drag-and-drop tree navigation used by the workflows and projects
// sub-sidebars. Renders an "Unfiled" group plus sortable folders, each holding
// sortable items. Items can be dragged between folders; folders can be
// reordered. Folders support inline rename and cascade delete.
//
// Callers supply the domain bits (how to render an item's icon, its href, how
// to delete it) and the server actions; everything else is shared here.

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  Check,
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  GripVertical,
  MoreHorizontal,
  Palette,
  Pencil,
  RotateCcw,
  Smile,
  Trash2,
  X,
} from 'lucide-react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  useDroppable,
  pointerWithin,
  rectIntersection,
  getFirstCollision,
  type CollisionDetection,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSubSidebar } from '@/components/layout/sub-sidebar'

const UNFILED_ID = '__unfiled__'

// Folder customization palettes. Colors match the project-creation dialog.
const FOLDER_COLORS = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316',
  '#eab308', '#22c55e', '#14b8a6', '#06b6d4', '#3b82f6',
]
const FOLDER_EMOJIS = [
  '📁', '📌', '⭐', '🚀', '💡', '🔥',
  '✅', '🎯', '📊', '💼', '🧩', '🔔',
  '📨', '🗂️', '🏷️', '🟢', '🔵', '🟣',
]

export interface TreeNavItem {
  id: string
  name: string
  folder_id?: string | null
}

export interface TreeNavFolder {
  id: string
  name: string
  color: string | null
  icon: string | null
  parent_id: string | null
  position: number
}

type ActionResult = { ok: true; data?: unknown } | { ok: false; error: string }

export interface TreeNavActions {
  reorderFolders: (orderedIds: string[]) => Promise<ActionResult>
  deleteFolder: (id: string, opts?: { cascadeChildren?: boolean }) => Promise<ActionResult>
  renameFolder: (id: string, input: { name: string }) => Promise<ActionResult>
  updateFolderMeta: (
    id: string,
    input: { color?: string | null; icon?: string | null },
  ) => Promise<ActionResult>
  moveItemToFolder: (itemId: string, folderId: string | null) => Promise<ActionResult>
  reorderItemsInFolder: (
    folderId: string | null,
    orderedIds: string[],
  ) => Promise<ActionResult>
}

interface DraggableTreeNavProps<T extends TreeNavItem> {
  items: T[]
  folders: TreeNavFolder[]
  /** Singular noun for aria labels and empty-folder hint, e.g. "workflow". */
  itemNoun: string
  getHref: (item: T) => string
  renderItemIcon: (item: T) => React.ReactNode
  /** Performs the soft-delete (incl. its own toast). Refresh is handled here. */
  onDeleteItem: (item: T) => Promise<void>
  actions: TreeNavActions
  /** Enables the per-folder icon (emoji) picker. Color is always available. */
  enableFolderIcon?: boolean
  toolbar: React.ReactNode
  footer?: React.ReactNode
  emptyState: React.ReactNode
}

type DragData = { type: 'item' | 'folder'; folderId: string | null }

// ─── Root component ──────────────────────────────────────────────────────────

export function DraggableTreeNav<T extends TreeNavItem>({
  items,
  folders,
  itemNoun,
  getHref,
  renderItemIcon,
  onDeleteItem,
  actions,
  enableFolderIcon,
  toolbar,
  footer,
  emptyState,
}: DraggableTreeNavProps<T>) {
  const router = useRouter()

  const [localItems, setLocalItems] = React.useState(items)
  const [localFolders, setLocalFolders] = React.useState(folders)
  React.useEffect(() => setLocalItems(items), [items])
  React.useEffect(() => setLocalFolders(folders), [folders])

  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [activeType, setActiveType] = React.useState<'item' | 'folder' | null>(null)
  const [overGroupId, setOverGroupId] = React.useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
  )

  const collisionDetection: CollisionDetection = React.useCallback((args) => {
    const pointer = pointerWithin(args)
    if (pointer.length > 0) {
      const first = getFirstCollision(pointer, 'id')
      if (first != null) return pointer.filter((c) => c.id === first)
      return pointer
    }
    return rectIntersection(args)
  }, [])

  const groups = React.useMemo(() => {
    const map = new Map<string | null, T[]>()
    map.set(null, [])
    for (const f of localFolders) map.set(f.id, [])
    for (const it of localItems) {
      const key = it.folder_id ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(it)
    }
    return map
  }, [localItems, localFolders])

  const unfiled = groups.get(null) ?? []

  const activeItem =
    activeType === 'item' && activeId
      ? (localItems.find((it) => it.id === activeId) ?? null)
      : null
  const activeFolder =
    activeType === 'folder' && activeId
      ? (localFolders.find((f) => f.id === activeId) ?? null)
      : null

  function handleDragStart(e: DragStartEvent) {
    const data = e.active.data.current as DragData | undefined
    setActiveId(String(e.active.id))
    setActiveType(data?.type ?? null)
  }

  function handleDragOver(e: DragOverEvent) {
    const { over } = e
    if (!over) return setOverGroupId(null)
    const d = over.data.current as { type?: string; folderId?: string | null } | undefined
    if (d?.type === 'folder' || d?.type === 'item') {
      const fid = d.folderId ?? null
      setOverGroupId(fid === null ? UNFILED_ID : String(fid))
    } else {
      setOverGroupId(null)
    }
  }

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e
    const aData = active.data.current as DragData | undefined
    const oData = over?.data.current as { type?: string; folderId?: string | null } | undefined
    setActiveId(null)
    setActiveType(null)
    setOverGroupId(null)
    if (!over || !aData) return

    // ── Reorder folders ──────────────────────────────────────────────────────
    if (aData.type === 'folder') {
      if (oData?.type !== 'folder') return
      if (over.id === active.id) return
      const oldIdx = localFolders.findIndex((f) => f.id === active.id)
      const newIdx = localFolders.findIndex((f) => f.id === over.id)
      if (oldIdx < 0 || newIdx < 0) return
      const next = arrayMove(localFolders, oldIdx, newIdx)
      setLocalFolders(next)
      const res = await actions.reorderFolders(next.map((f) => f.id))
      if (!res.ok) {
        toast.error(res.error)
        setLocalFolders(folders)
      }
      router.refresh()
      return
    }

    // ── Move / reorder item ──────────────────────────────────────────────────
    if (aData.type === 'item') {
      const item = localItems.find((it) => it.id === active.id)
      if (!item) return
      let targetFolderId: string | null
      if (oData?.type === 'item' || oData?.type === 'folder') {
        targetFolderId = oData.folderId ?? null
      } else return

      const sourceFolderId = item.folder_id ?? null
      const targetList = (groups.get(targetFolderId) ?? []).filter((it) => it.id !== item.id)
      let insertIdx = targetList.length
      if (oData?.type === 'item' && over.id !== active.id) {
        const idx = targetList.findIndex((it) => it.id === over.id)
        if (idx >= 0) insertIdx = idx
      }
      const newIds = [
        ...targetList.slice(0, insertIdx).map((it) => it.id),
        item.id,
        ...targetList.slice(insertIdx).map((it) => it.id),
      ]

      // No-op if dropped in the same place within the same folder.
      if (sourceFolderId === targetFolderId) {
        const cur = (groups.get(sourceFolderId) ?? []).map((it) => it.id)
        if (cur.length === newIds.length && cur.every((id, i) => id === newIds[i])) return
      }

      setLocalItems((prev) => {
        const updated = prev.map((it) =>
          it.id === item.id ? { ...it, folder_id: targetFolderId } : it,
        )
        const idMap = new Map(updated.map((it) => [it.id, it]))
        const inTarget = newIds.map((id) => idMap.get(id)).filter(Boolean) as T[]
        const others = updated.filter((it) => (it.folder_id ?? null) !== targetFolderId)
        return [...others, ...inTarget]
      })

      if (sourceFolderId !== targetFolderId) {
        const res = await actions.moveItemToFolder(item.id, targetFolderId)
        if (!res.ok) {
          toast.error(res.error)
          setLocalItems(items)
          return
        }
      }
      const res2 = await actions.reorderItemsInFolder(targetFolderId, newIds)
      if (!res2.ok) {
        toast.error(res2.error)
        setLocalItems(items)
        return
      }
      router.refresh()
    }
  }

  const isEmpty = localItems.length === 0 && localFolders.length === 0

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {/* Full-height column: toolbar (top) · scrollable list (middle) · footer (base) */}
      <div className="flex min-h-0 flex-1 flex-col">
        {/* Toolbar */}
        <div className="flex shrink-0 items-center gap-1 border-b border-border-subtle px-2 py-2">
          {toolbar}
        </div>

        {/* Scrollable list */}
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="flex flex-col gap-px py-1">
            {unfiled.length > 0 && (
              <UnfiledSection
                items={unfiled}
                isOver={overGroupId === UNFILED_ID}
                getHref={getHref}
                renderItemIcon={renderItemIcon}
                onDeleteItem={onDeleteItem}
                itemNoun={itemNoun}
              />
            )}

            <SortableContext
              items={localFolders.map((f) => f.id)}
              strategy={verticalListSortingStrategy}
            >
              {localFolders.map((folder) => (
                <FolderSection
                  key={folder.id}
                  folder={folder}
                  items={groups.get(folder.id) ?? []}
                  isOver={overGroupId === folder.id}
                  getHref={getHref}
                  renderItemIcon={renderItemIcon}
                  onDeleteItem={onDeleteItem}
                  actions={actions}
                  itemNoun={itemNoun}
                  enableFolderIcon={enableFolderIcon}
                  onPatched={(id, patch) =>
                    setLocalFolders((prev) =>
                      prev.map((f) => (f.id === id ? { ...f, ...patch } : f)),
                    )
                  }
                />
              ))}
            </SortableContext>

            {isEmpty && emptyState}
          </div>
        </div>

        {/* Footer pinned to the base */}
        {footer && (
          <div className="flex shrink-0 flex-col gap-px border-t border-border-subtle px-2 py-2">
            {footer}
          </div>
        )}
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <DragOverlay
            dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.18,0.89,0.32,1.28)' }}
          >
            {activeItem ? (
              <ItemDragGhost name={activeItem.name} icon={renderItemIcon(activeItem)} />
            ) : activeFolder ? (
              <FolderDragGhost folder={activeFolder} />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  )
}

// ─── Unfiled section ─────────────────────────────────────────────────────────

function UnfiledSection<T extends TreeNavItem>({
  items,
  isOver,
  getHref,
  renderItemIcon,
  onDeleteItem,
  itemNoun,
}: {
  items: T[]
  isOver: boolean
  getHref: (item: T) => string
  renderItemIcon: (item: T) => React.ReactNode
  onDeleteItem: (item: T) => Promise<void>
  itemNoun: string
}) {
  const [open, setOpen] = React.useState(true)
  const { setNodeRef } = useDroppable({
    id: UNFILED_ID,
    data: { type: 'folder', folderId: null },
  })

  return (
    <div ref={setNodeRef} className={cn(isOver && 'bg-accent/5 rounded-[7px]')}>
      {/* Header mirrors the folder row layout (grip spacer + chevron + label +
          menu spacer) so "Unfiled" sits at the SAME level as folders, not as
          their parent. */}
      <div className="flex items-center gap-1 rounded-[6px] px-1.5 py-1">
        <span className="w-3 shrink-0" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex flex-1 min-w-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <ChevronRight
            className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
          />
          <span className="flex-1 min-w-0 truncate text-left">Unfiled</span>
          <span className="text-[10px] tabular-nums shrink-0">{items.length}</span>
        </button>
        <span className="w-5 shrink-0" />
      </div>
      {open && (
        <div className="pl-5">
          <SortableContext
            items={items.map((it) => it.id)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                folderId={null}
                getHref={getHref}
                renderItemIcon={renderItemIcon}
                onDeleteItem={onDeleteItem}
                itemNoun={itemNoun}
              />
            ))}
          </SortableContext>
        </div>
      )}
    </div>
  )
}

// ─── Folder section ──────────────────────────────────────────────────────────

function FolderSection<T extends TreeNavItem>({
  folder,
  items,
  isOver,
  getHref,
  renderItemIcon,
  onDeleteItem,
  actions,
  itemNoun,
  enableFolderIcon,
  onPatched,
}: {
  folder: TreeNavFolder
  items: T[]
  isOver: boolean
  getHref: (item: T) => string
  renderItemIcon: (item: T) => React.ReactNode
  onDeleteItem: (item: T) => Promise<void>
  actions: TreeNavActions
  itemNoun: string
  enableFolderIcon?: boolean
  onPatched: (
    id: string,
    patch: Partial<Pick<TreeNavFolder, 'name' | 'color' | 'icon'>>,
  ) => void
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(true)
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(folder.name)
  const [saving, setSaving] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: folder.id,
    data: { type: 'folder', folderId: folder.id },
  })
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition }

  const colorStyle = folder.color ? { color: folder.color } : { color: '#f59e0b' }
  // The folder glyph: a chosen emoji icon when set, otherwise the colored
  // open/closed folder icon.
  const glyph = folder.icon ? (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[12px] leading-none">
      {folder.icon}
    </span>
  ) : open ? (
    <FolderOpen className="h-3.5 w-3.5 shrink-0" style={colorStyle} />
  ) : (
    <FolderIcon className="h-3.5 w-3.5 shrink-0" style={colorStyle} />
  )

  function beginRename() {
    setDraft(folder.name)
    setEditing(true)
  }

  async function commitRename() {
    const name = draft.trim()
    if (!name || name === folder.name) {
      setEditing(false)
      return
    }
    setSaving(true)
    const res = await actions.renameFolder(folder.id, { name })
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    onPatched(folder.id, { name })
    setEditing(false)
    router.refresh()
  }

  async function applyMeta(patch: { color?: string | null; icon?: string | null }) {
    onPatched(folder.id, patch) // optimistic
    setMenuOpen(false)
    const res = await actions.updateFolderMeta(folder.id, patch)
    if (!res.ok) toast.error(res.error)
    router.refresh()
  }

  async function handleDelete() {
    const res = await actions.deleteFolder(folder.id, { cascadeChildren: true })
    if (!res.ok) toast.error(res.error)
    else router.refresh()
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(isDragging && 'opacity-40', isOver && 'bg-accent/5 rounded-[7px]')}
    >
      <div className="group flex items-center gap-1 rounded-[6px] px-1.5 py-1 hover:bg-bg-tertiary/60 transition-colors">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-text-tertiary/60 hover:text-text-secondary transition-opacity shrink-0"
          aria-label="Drag folder"
        >
          <GripVertical className="h-3 w-3" />
        </button>

        {editing ? (
          <div className="flex flex-1 min-w-0 items-center gap-1">
            {glyph}
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') setEditing(false)
              }}
              autoFocus
              disabled={saving}
              maxLength={120}
              className="h-6 flex-1 min-w-0 px-1.5 py-0 text-[12px]"
            />
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-5 w-5 shrink-0 text-emerald-500"
              onClick={commitRename}
              disabled={saving}
              aria-label="Save folder name"
            >
              <Check className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="h-5 w-5 shrink-0 text-text-tertiary"
              onClick={() => setEditing(false)}
              disabled={saving}
              aria-label="Cancel rename"
            >
              <X className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              className="flex flex-1 min-w-0 items-center gap-1.5"
            >
              <ChevronRight
                className={cn(
                  'h-3 w-3 shrink-0 text-text-tertiary transition-transform',
                  open && 'rotate-90',
                )}
              />
              {glyph}
              <span className="flex-1 min-w-0 truncate text-left text-[12px] font-medium text-text-secondary">
                {folder.name}
              </span>
              <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">
                {items.length}
              </span>
            </button>

            <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Folder actions"
                >
                  <MoreHorizontal className="h-3 w-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40">
                <DropdownMenuItem onSelect={beginRename}>
                  <Pencil className="h-3 w-3" />
                  Rename
                </DropdownMenuItem>

                <DropdownMenuSub>
                  <DropdownMenuSubTrigger>
                    <Palette className="h-3 w-3" />
                    Color
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="min-w-0">
                    <div className="grid grid-cols-5 gap-1.5 p-1.5">
                      {FOLDER_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => applyMeta({ color: c })}
                          className="h-5 w-5 rounded-full transition-transform hover:scale-110"
                          style={{
                            backgroundColor: c,
                            boxShadow:
                              folder.color === c
                                ? `0 0 0 2px var(--bg-primary), 0 0 0 3.5px ${c}`
                                : undefined,
                          }}
                          aria-label={`Color ${c}`}
                        />
                      ))}
                    </div>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onSelect={() => applyMeta({ color: null })}>
                      <RotateCcw className="h-3 w-3" />
                      Default color
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>

                {enableFolderIcon && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Smile className="h-3 w-3" />
                      Icon
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="min-w-0">
                      <div className="grid grid-cols-6 gap-1 p-1.5">
                        {FOLDER_EMOJIS.map((e) => (
                          <button
                            key={e}
                            type="button"
                            onClick={() => applyMeta({ icon: e })}
                            className={cn(
                              'flex h-7 w-7 items-center justify-center rounded-md text-[15px] leading-none hover:bg-bg-tertiary',
                              folder.icon === e && 'bg-accent/15',
                            )}
                            aria-label={`Icon ${e}`}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={() => applyMeta({ icon: null })}>
                        <RotateCcw className="h-3 w-3" />
                        Default icon
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}

                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-rose-500 focus:text-rose-500"
                  onSelect={handleDelete}
                >
                  <Trash2 className="h-3 w-3" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        )}
      </div>

      {open && (
        <div className="pl-5">
          <SortableContext
            items={items.map((it) => it.id)}
            strategy={verticalListSortingStrategy}
          >
            {items.map((it) => (
              <ItemRow
                key={it.id}
                item={it}
                folderId={folder.id}
                getHref={getHref}
                renderItemIcon={renderItemIcon}
                onDeleteItem={onDeleteItem}
                itemNoun={itemNoun}
              />
            ))}
          </SortableContext>
          {items.length === 0 && (
            <p className="px-2 py-1.5 text-[11px] text-text-tertiary italic">
              Drop a {itemNoun} here
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Item row ─────────────────────────────────────────────────────────────────

function ItemRow<T extends TreeNavItem>({
  item,
  folderId,
  getHref,
  renderItemIcon,
  onDeleteItem,
  itemNoun,
}: {
  item: T
  folderId: string | null
  getHref: (item: T) => string
  renderItemIcon: (item: T) => React.ReactNode
  onDeleteItem: (item: T) => Promise<void>
  itemNoun: string
}) {
  const pathname = usePathname()
  const { onNavigate } = useSubSidebar()
  const href = getHref(item)
  const isActive = pathname === href || pathname.startsWith(href + '/')

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: item.id,
    data: { type: 'item', folderId },
  })
  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'group relative flex items-center rounded-[6px] transition-colors',
        isDragging && 'opacity-40',
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-[60%] w-[2px] rounded-r-full bg-accent" />
      )}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="ml-1 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-text-tertiary/60 hover:text-text-secondary transition-opacity shrink-0"
        aria-label={`Drag ${itemNoun}`}
        tabIndex={-1}
      >
        <GripVertical className="h-3 w-3" />
      </button>
      <Link
        href={href}
        onClick={onNavigate}
        className={cn(
          'flex flex-1 min-w-0 items-center gap-2 px-2 py-1.5 text-[12px] rounded-[6px]',
          isActive
            ? 'text-text-primary font-medium bg-accent/8'
            : 'text-text-secondary hover:bg-bg-tertiary/60 hover:text-text-primary',
        )}
      >
        <span className="flex h-3 w-3 shrink-0 items-center justify-center">
          {renderItemIcon(item)}
        </span>
        <span className="truncate">{item.name}</span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mr-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            aria-label={`${itemNoun} actions`}
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem asChild>
            <Link href={href} onClick={onNavigate}>
              Open
            </Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-rose-500 focus:text-rose-500"
            onSelect={() => onDeleteItem(item)}
          >
            <Trash2 className="h-3 w-3" />
            Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ─── Drag ghosts ──────────────────────────────────────────────────────────────

function ItemDragGhost({ name, icon }: { name: string; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-primary px-3 py-1.5 shadow-lg">
      <span className="flex h-3 w-3 shrink-0 items-center justify-center">{icon}</span>
      <span className="max-w-[180px] truncate text-[12px] font-medium text-text-primary">
        {name}
      </span>
    </div>
  )
}

function FolderDragGhost({ folder }: { folder: TreeNavFolder }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-primary px-3 py-1.5 shadow-lg">
      {folder.icon ? (
        <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center text-[12px] leading-none">
          {folder.icon}
        </span>
      ) : (
        <FolderIcon
          className="h-3.5 w-3.5 shrink-0"
          style={folder.color ? { color: folder.color } : { color: '#f59e0b' }}
        />
      )}
      <span className="max-w-[180px] truncate text-[12px] font-medium text-text-secondary">
        {folder.name}
      </span>
    </div>
  )
}

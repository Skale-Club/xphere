'use client'

import { useState, useEffect, useTransition, useMemo, Fragment } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  flexRender,
  type SortingState,
  type ColumnDef,
  type Row,
} from '@tanstack/react-table'
import {
  DndContext,
  DragOverlay,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  useDraggable,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Wrench, MoreHorizontal, FolderPlus, GripVertical, ScrollText, ChevronRight, ChevronDown, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import type { ToolConfigWithIntegration, ToolFolder } from '@/app/(dashboard)/workflows/actions'
import type { IntegrationForDisplay } from '@/app/(dashboard)/integrations/actions'
import { deleteToolConfig, updateFolder, createFolder, deleteFolder, deleteFolderWithTools, reorderFolders, moveToolToFolder } from '@/app/(dashboard)/workflows/actions'
import { cn } from '@/lib/utils'
import { Button, buttonVariants } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { DesktopOnly } from '@/components/layout/desktop-only'

const ACTION_TYPE_LABELS: Record<string, string> = {
  send_email: 'Send Email',
  create_contact: 'Create Contact',
  get_availability: 'Check Availability',
  create_appointment: 'Book Appointment',
  send_sms: 'Send SMS',
  knowledge_base: 'Knowledge Base',
  custom_webhook: 'Custom Webhook',
}

interface ToolsTableProps {
  toolConfigs: ToolConfigWithIntegration[]
  integrations: IntegrationForDisplay[]
  folders: ToolFolder[]
  children?: React.ReactNode
}

// ─── Sortable folder header row ───────────────────────────────────────────────

function SortableFolderHeader({
  id,
  label,
  count,
  colSpan,
  isCollapsed,
  isRenaming,
  renameValue,
  onToggleCollapse,
  onStartRename,
  onRenameChange,
  onRenameKeyDown,
  onRenameBlur,
  onAddSubfolder,
  onDeleteClick,
  isDropTarget,
}: {
  id: string
  label: string
  count: number
  colSpan: number
  isCollapsed: boolean
  isRenaming: boolean
  renameValue: string
  onToggleCollapse: () => void
  onStartRename: () => void
  onRenameChange: (v: string) => void
  onRenameKeyDown: (e: React.KeyboardEvent) => void
  onRenameBlur: (e: React.FocusEvent) => void
  onAddSubfolder: () => void
  onDeleteClick: () => void
  isDropTarget: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, data: { type: 'folder' } })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }
  return (
    <TableRow ref={setNodeRef} style={style} className={cn("bg-muted/40 hover:bg-muted/60 group", isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary/40")}>
      <TableCell colSpan={colSpan} className="py-1.5 px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleCollapse}
            className="text-muted-foreground hover:text-foreground"
            aria-label={isCollapsed ? `Expand ${label}` : `Collapse ${label}`}
          >
            {isCollapsed
              ? <ChevronRight className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          <span
            {...attributes}
            {...listeners}
            className="cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground"
            aria-label="Drag to reorder folder"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </span>
          {isRenaming ? (
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={onRenameKeyDown}
              onBlur={onRenameBlur}
              className="h-6 text-xs font-semibold bg-transparent border-b border-input focus:outline-none w-32 py-0"
            />
          ) : (
            <span
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer"
              onClick={onStartRename}
            >
              {label}
            </span>
          )}
          <span className="text-xs text-muted-foreground">({count})</span>
          <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={onStartRename}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label={`Rename ${label}`}
              data-rename-cancel="false"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onAddSubfolder}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label={`Add subfolder to ${label}`}
              data-rename-cancel="true"
            >
              <Plus className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onDeleteClick}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label={`Delete ${label}`}
              data-rename-cancel="true"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  )
}

// ─── Static folder header (for "Ungrouped" | not draggable) ─────────────────────

function StaticFolderHeader({ label, count, colSpan }: { label: string; count: number; colSpan: number }) {
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={colSpan} className="py-1.5 px-4">
        <div className="flex items-center gap-2">
          <span className="w-3.5" />
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            {label}
          </span>
          <span className="text-xs text-muted-foreground">({count})</span>
        </div>
      </TableCell>
    </TableRow>
  )
}

// ─── Subfolder header row (static | DnD is Phase 21 scope) ───────────────────

function SubfolderHeader({
  folder,
  count,
  colSpan,
  isCollapsed,
  isRenaming,
  renameValue,
  onToggleCollapse,
  onStartRename,
  onRenameChange,
  onRenameKeyDown,
  onRenameBlur,
  onDeleteClick,
  isDropTarget,
}: {
  folder: ToolFolder
  count: number
  colSpan: number
  isCollapsed: boolean
  isRenaming: boolean
  renameValue: string
  onToggleCollapse: () => void
  onStartRename: () => void
  onRenameChange: (v: string) => void
  onRenameKeyDown: (e: React.KeyboardEvent) => void
  onRenameBlur: (e: React.FocusEvent) => void
  onDeleteClick: () => void
  isDropTarget: boolean
}) {
  return (
    <TableRow className={cn("bg-muted/30 hover:bg-muted/40 group", isDropTarget && "bg-primary/10 ring-1 ring-inset ring-primary/40")}>
      <TableCell colSpan={colSpan} className="py-1.5 pl-8 pr-4">
        <div className="flex items-center gap-2">
          {/* Grip spacer | aligns with SortableFolderHeader; DnD Phase 21 */}
          <span className="w-3.5" />
          <button
            type="button"
            onClick={onToggleCollapse}
            className="text-muted-foreground hover:text-foreground"
            aria-label={isCollapsed ? `Expand ${folder.name}` : `Collapse ${folder.name}`}
          >
            {isCollapsed
              ? <ChevronRight className="h-3.5 w-3.5" />
              : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {isRenaming ? (
            <Input
              autoFocus
              value={renameValue}
              onChange={(e) => onRenameChange(e.target.value)}
              onKeyDown={onRenameKeyDown}
              onBlur={onRenameBlur}
              className="h-6 text-xs font-semibold bg-transparent border-b border-input focus:outline-none w-32 py-0"
            />
          ) : (
            <span
              className="text-xs font-semibold text-muted-foreground uppercase tracking-wide cursor-pointer"
              onClick={onStartRename}
            >
              {folder.name}
            </span>
          )}
          <span className="text-xs text-muted-foreground">({count})</span>
          <div className="ml-auto flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={onStartRename}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label={`Rename ${folder.name}`}
              data-rename-cancel="false"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onDeleteClick}
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              aria-label={`Delete ${folder.name}`}
              data-rename-cancel="true"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </TableCell>
    </TableRow>
  )
}

// ─── Draggable tool row ───────────────────────────────────────────────────────

function DraggableToolRow({
  tool,
  row,
}: {
  tool: ToolConfigWithIntegration
  row: Row<ToolConfigWithIntegration>
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: tool.id,
    data: { type: 'tool' },
  })
  return (
    <TableRow
      ref={setNodeRef}
      className={cn('group/row', isDragging && 'opacity-40 bg-muted/20')}
    >
      {row.getVisibleCells().map((cell, i) => (
        <TableCell key={cell.id} className={i === 0 ? 'relative group/row' : undefined}>
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

// ─── Main component ───────────────────────────────────────────────────────────

export function ToolsTable({
  toolConfigs: initialToolConfigs,
  integrations,
  folders,
  children,
}: ToolsTableProps) {
  const [toolConfigs, setToolConfigs] = useState<ToolConfigWithIntegration[]>(initialToolConfigs)
  const [sorting, setSorting] = useState<SortingState>([])
  const [isSheetOpen, setIsSheetOpen] = useState(false)
  const [editingTool, setEditingTool] = useState<ToolConfigWithIntegration | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ToolConfigWithIntegration | null>(null)
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const [addingFolder, setAddingFolder] = useState(false)
  const [newFolderName, setNewFolderName] = useState('')

  // Canonical ordered folder list: top-level folders ordered by position
  const [orderedFolders, setOrderedFolders] = useState<ToolFolder[]>(() =>
    folders.filter((f) => f.parent_id === null)
  )
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set())
  const [renamingFolderId, setRenamingFolderId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [addingSubfolderTo, setAddingSubfolderTo] = useState<string | null>(null)
  const [newSubfolderName, setNewSubfolderName] = useState('')
  const [folderDeleteTarget, setFolderDeleteTarget] = useState<{ folder: ToolFolder } | null>(null)

  // DnD state | Phase 21
  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeDragType, setActiveDragType] = useState<'folder' | 'tool' | null>(null)
  const [activeDragTool, setActiveDragTool] = useState<ToolConfigWithIntegration | null>(null)
  const [dragOverFolderId, setDragOverFolderId] = useState<string | null>(null)

  // Full folder list passed to form for Phase 20 picker
  const existingFolders = useMemo(
    () => folders,
    [folders]
  )

  // Sync orderedFolders when the folders prop changes (e.g. after router.refresh())
  useEffect(() => {
    setOrderedFolders(folders.filter((f) => f.parent_id === null))
  }, [folders])

  // DnD sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  function resetDragState() {
    setActiveId(null)
    setActiveDragType(null)
    setActiveDragTool(null)
    setDragOverFolderId(null)
  }

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

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event
    if (active.data.current?.type === 'tool') {
      setDragOverFolderId(over ? (over.id as string) : null)
    }
  }

  function handleDragCancel() {
    resetDragState()
  }

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
        // Guard: no-op if tool is already in this folder
        const tool = toolConfigs.find((t) => t.id === toolId)
        if (tool?.folder_id === targetFolderId) { resetDragState(); return }
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

  function toggleCollapse(folderId: string) {
    setCollapsedFolders((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  function startRename(folder: ToolFolder) {
    setRenamingFolderId(folder.id)
    setRenameValue(folder.name)
  }

  function commitRename(folderId: string) {
    const trimmed = renameValue.trim()
    setRenamingFolderId(null)
    setRenameValue('')
    if (!trimmed) return
    startTransition(async () => {
      const result = await updateFolder(folderId, { name: trimmed })
      if (result && 'error' in result && result.error) {
        toast.error(result.error)
      } else {
        setOrderedFolders((prev) =>
          prev.map((f) => f.id === folderId ? { ...f, name: trimmed } : f)
        )
        toast.success('Folder renamed.')
      }
    })
  }

  function handleAddFolder(e: React.FormEvent) {
    e.preventDefault()
    const name = newFolderName.trim()
    if (!name) {
      setAddingFolder(false)
      setNewFolderName('')
      return
    }
    setAddingFolder(false)
    setNewFolderName('')
    startTransition(async () => {
      const result = await createFolder(name, null)
      if (result && 'error' in result && result.error) {
        toast.error(result.error)
      } else {
        toast.success('Folder created.')
        router.refresh()
      }
    })
  }

  function handleAddSubfolder(e: React.FormEvent, parentFolderId: string) {
    e.preventDefault()
    const name = newSubfolderName.trim()
    if (!name) {
      setAddingSubfolderTo(null)
      setNewSubfolderName('')
      return
    }
    setAddingSubfolderTo(null)
    setNewSubfolderName('')
    startTransition(async () => {
      const result = await createFolder(name, parentFolderId)
      if (result && 'error' in result && result.error) {
        toast.error(result.error)
      } else {
        toast.success('Subfolder created.')
        router.refresh()
      }
    })
  }

  function handleDeleteFolder(mode: 'orphan' | 'delete-with-tools') {
    if (!folderDeleteTarget) return
    const { folder } = folderDeleteTarget
    setFolderDeleteTarget(null)
    startTransition(async () => {
      let result: { error?: string } | void
      if (mode === 'orphan') {
        result = await deleteFolder(folder.id)
        if (result && 'error' in result && result.error) {
          toast.error(result.error)
        } else {
          toast.success('Folder deleted. Tools moved to Ungrouped.')
          router.refresh()
        }
      } else {
        result = await deleteFolderWithTools(folder.id)
        if (result && 'error' in result && result.error) {
          toast.error(result.error)
        } else {
          toast.success('Folder and its tools deleted.')
          router.refresh()
        }
      }
    })
  }

  function openCreateSheet() {
    setEditingTool(null)
    setIsSheetOpen(true)
  }

  function openEditSheet(tool: ToolConfigWithIntegration) {
    setEditingTool(tool)
    setIsSheetOpen(true)
  }

  function handleSheetSuccess() {
    setIsSheetOpen(false)
    setEditingTool(null)
    router.refresh()
  }

  function handleDeleteConfirm() {
    if (!deleteTarget) return
    const id = deleteTarget.id
    setDeleteTarget(null)
    startTransition(async () => {
      const result = await deleteToolConfig(id)
      if (result && 'error' in result && result.error) {
        toast.error('Failed to delete tool config. Try again.')
      } else {
        setToolConfigs((prev) => prev.filter((t) => t.id !== id))
        toast.success('Tool configuration deleted.')
      }
    })
  }

  const columns: ColumnDef<ToolConfigWithIntegration>[] = [
    {
      accessorKey: 'tool_name',
      header: () => <span className="text-xs font-medium">Tool Name</span>,
      cell: ({ row }) => (
        <Link
          href={`/workflows/${row.original.id}`}
          className="font-mono text-sm underline-offset-4 hover:underline"
        >
          {row.getValue('tool_name')}
        </Link>
      ),
    },
    {
      accessorKey: 'action_type',
      header: () => <span className="text-xs font-medium">Action Type</span>,
      cell: ({ row }) => {
        const actionType = row.getValue<string>('action_type')
        return <span className="text-sm">{ACTION_TYPE_LABELS[actionType] ?? actionType}</span>
      },
    },
    {
      id: 'labels',
      header: () => <span className="text-xs font-medium">Labels</span>,
      cell: ({ row }) => {
        const labels = row.original.labels ?? []
        if (labels.length === 0) return <span className="text-muted-foreground text-sm">-</span>
        return (
          <div className="flex flex-wrap gap-1">
            {labels.map((label) => (
              <Badge key={label} variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                {label}
              </Badge>
            ))}
          </div>
        )
      },
    },
    {
      id: 'integration',
      header: () => <span className="text-xs font-medium">Integration</span>,
      cell: ({ row }) => (
        <span className="text-sm">{row.original.integrations?.name ?? '-'}</span>
      ),
    },
    {
      accessorKey: 'fallback_message',
      header: () => <span className="text-xs font-medium">Fallback Message</span>,
      cell: ({ row }) => {
        const message = row.getValue<string>('fallback_message')
        const truncated = message.length > 40 ? message.slice(0, 40) + '…' : message
        return <span className="text-sm text-muted-foreground">{truncated}</span>
      },
    },
    {
      accessorKey: 'is_active',
      header: () => <span className="text-xs font-medium">Status</span>,
      cell: ({ row }) => {
        const isActive = row.getValue<boolean>('is_active')
        return (
          <Badge
            variant="outline"
            className={isActive ? 'bg-emerald-500/15 text-emerald-400' : 'bg-zinc-500/15 text-zinc-400'}
          >
            {isActive ? 'Active' : 'Inactive'}
          </Badge>
        )
      },
    },
    {
      id: 'actions',
      header: () => null,
      cell: ({ row }) => {
        const tool = row.original
        return (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label="Row actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem asChild>
                <Link href={`/workflows/${tool.id}`}>View Logs</Link>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => openEditSheet(tool)}>
                Edit Tool Config
              </DropdownMenuItem>
              <DropdownMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteTarget(tool)}
              >
                Delete Tool Config
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )
      },
    },
  ]

  const table = useReactTable({
    data: toolConfigs,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  // Build a row lookup by tool id for efficient rendering
  const rowById = useMemo(() => {
    const map = new Map(table.getRowModel().rows.map((r) => [r.original.id, r]))
    return map
  }, [table])

  // Tools grouped by folder_id
  const toolsByFolder = useMemo(() => {
    const map = new Map<string, ToolConfigWithIntegration[]>()
    for (const tool of toolConfigs) {
      const key = tool.folder_id ?? '__other__'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(tool)
    }
    return map
  }, [toolConfigs])

  // Subfolders grouped by parent folder id
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

  const otherTools = toolsByFolder.get('__other__') ?? []

  // Show section headers when there's more than one distinct group
  // (at least one named folder, or named folder + ungrouped)
  const showHeaders =
    orderedFolders.length > 1 ||
    (orderedFolders.length === 1 && otherTools.length > 0) ||
    (orderedFolders.length === 0 && otherTools.length > 0 && toolConfigs.some((t) => t.folder_id))

  if (isPending && toolConfigs.length === 0) {
    return <ToolsTableSkeleton />
  }

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
        <div>{children}</div>
        <div className="flex items-center gap-2">
          {addingFolder ? (
            <form onSubmit={handleAddFolder} className="flex items-center gap-1">
              <Input
                autoFocus
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setAddingFolder(false)
                    setNewFolderName('')
                  }
                }}
                placeholder="Folder name"
                className="h-8 w-40 text-sm"
              />
              <Button type="submit" size="sm" variant="outline" className="h-8">
                Add
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8"
                onClick={() => {
                  setAddingFolder(false)
                  setNewFolderName('')
                }}
              >
                Cancel
              </Button>
            </form>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddingFolder(true)}
              aria-label="Add folder"
              className="h-9 w-9 p-0"
            >
              <FolderPlus className="h-4 w-4" />
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link href="/workflows/logs">
              <ScrollText className="h-4 w-4 mr-1.5" />
              Logs
            </Link>
          </Button>
          <Button onClick={openCreateSheet}>Add Tool</Button>
        </div>
      </div>

      {/* Empty state */}
      {toolConfigs.length === 0 && orderedFolders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-4 text-center">
          <Wrench className="h-12 w-12 text-muted-foreground" />
          <div>
            <h2 className="text-xl font-semibold">No tool configurations yet</h2>
            <p className="text-sm text-muted-foreground mt-1">
              Add your first tool to route LLM tool calls from voice, chat, and inbound webhooks through platform actions.
            </p>
          </div>
          <Button onClick={openCreateSheet}>Add Tool</Button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
          onDragCancel={handleDragCancel}
        >
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(header.column.columnDef.header, header.getContext())}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {/* Named folder groups | sortable */}
              <SortableContext
                  items={orderedFolders.map((f) => f.id)}
                  strategy={verticalListSortingStrategy}
                >
                  {orderedFolders.map((folder) => {
                    const folderTools = toolsByFolder.get(folder.id) ?? []
                    const subfolders = subfoldersByParent.get(folder.id) ?? []
                    const isCollapsed = collapsedFolders.has(folder.id)
                    return (
                      <Fragment key={`folder-${folder.id}`}>
                        {showHeaders && (
                          <SortableFolderHeader
                            id={folder.id}
                            label={folder.name}
                            count={folderTools.length + subfolders.reduce((acc, sub) => acc + (toolsByFolder.get(sub.id) ?? []).length, 0)}
                            colSpan={columns.length}
                            isCollapsed={isCollapsed}
                            isRenaming={renamingFolderId === folder.id}
                            renameValue={renameValue}
                            onToggleCollapse={() => toggleCollapse(folder.id)}
                            onStartRename={() => startRename(folder)}
                            onRenameChange={setRenameValue}
                            onRenameKeyDown={(e) => {
                              if (e.key === 'Enter') commitRename(folder.id)
                              if (e.key === 'Escape') { setRenamingFolderId(null); setRenameValue('') }
                            }}
                            onRenameBlur={(e) => {
                              if (e.relatedTarget?.getAttribute('data-rename-cancel') === 'true') return
                              commitRename(folder.id)
                            }}
                            onAddSubfolder={() => { setAddingSubfolderTo(folder.id); setNewSubfolderName('') }}
                            onDeleteClick={() => setFolderDeleteTarget({ folder })}
                            isDropTarget={dragOverFolderId === folder.id}
                          />
                        )}
                        {addingSubfolderTo === folder.id && (
                          <TableRow>
                            <TableCell colSpan={columns.length} className="py-1 pl-10">
                              <form onSubmit={(e) => handleAddSubfolder(e, folder.id)} className="flex items-center gap-1">
                                <Input
                                  autoFocus
                                  value={newSubfolderName}
                                  onChange={(e) => setNewSubfolderName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                      setAddingSubfolderTo(null)
                                      setNewSubfolderName('')
                                    }
                                  }}
                                  placeholder="Subfolder name"
                                  className="h-7 w-36 text-xs"
                                />
                                <Button type="submit" size="sm" variant="outline" className="h-7 text-xs">
                                  Add Subfolder
                                </Button>
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="ghost"
                                  className="h-7 text-xs"
                                  onClick={() => { setAddingSubfolderTo(null); setNewSubfolderName('') }}
                                >
                                  Cancel
                                </Button>
                              </form>
                            </TableCell>
                          </TableRow>
                        )}
                        {!isCollapsed && (
                          <>
                            {subfolders.map((sub) => {
                              const subTools = toolsByFolder.get(sub.id) ?? []
                              const subIsCollapsed = collapsedFolders.has(sub.id)
                              return (
                                <Fragment key={`sub-${sub.id}`}>
                                  <SubfolderHeader
                                    folder={sub}
                                    count={subTools.length}
                                    colSpan={columns.length}
                                    isCollapsed={subIsCollapsed}
                                    isRenaming={renamingFolderId === sub.id}
                                    renameValue={renameValue}
                                    onToggleCollapse={() => toggleCollapse(sub.id)}
                                    onStartRename={() => startRename(sub)}
                                    onRenameChange={setRenameValue}
                                    onRenameKeyDown={(e) => {
                                      if (e.key === 'Enter') commitRename(sub.id)
                                      if (e.key === 'Escape') { setRenamingFolderId(null); setRenameValue('') }
                                    }}
                                    onRenameBlur={(e) => {
                                      if (e.relatedTarget?.getAttribute('data-rename-cancel') === 'true') return
                                      commitRename(sub.id)
                                    }}
                                    onDeleteClick={() => setFolderDeleteTarget({ folder: sub })}
                                    isDropTarget={dragOverFolderId === sub.id}
                                  />
                                  {!subIsCollapsed && subTools.map((tool) => {
                                    const row = rowById.get(tool.id)
                                    if (!row) return null
                                    return (
                                      <DraggableToolRow key={tool.id} tool={tool} row={row} />
                                    )
                                  })}
                                </Fragment>
                              )
                            })}
                            {folderTools.map((tool) => {
                              const row = rowById.get(tool.id)
                              if (!row) return null
                              return (
                                <DraggableToolRow key={tool.id} tool={tool} row={row} />
                              )
                            })}
                          </>
                        )}
                      </Fragment>
                    )
                  })}
                </SortableContext>

              {/* "Ungrouped" group | not sortable, always last */}
              {otherTools.length > 0 && (
                <>
                  {showHeaders && (
                    <StaticFolderHeader
                      label="Ungrouped"
                      count={otherTools.length}
                      colSpan={columns.length}
                    />
                  )}
                  {otherTools.map((tool) => {
                    const row = rowById.get(tool.id)
                    if (!row) return null
                    return (
                      <DraggableToolRow key={tool.id} tool={tool} row={row} />
                    )
                  })}
                </>
              )}

              {toolConfigs.length === 0 && orderedFolders.length > 0 && (
                <TableRow>
                  <TableCell colSpan={columns.length} className="h-16 text-center text-sm text-muted-foreground">
                    No tools yet. Add a tool and assign it to a folder.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <DragOverlay>
          {activeDragType === 'tool' && activeDragTool ? (
            <div className="text-sm font-mono bg-background border shadow-md px-3 py-1.5 rounded-md flex items-center gap-2 opacity-90">
              {activeDragTool.tool_name}
            </div>
          ) : null}
        </DragOverlay>
        </DndContext>
      )}

      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent side="right" className="p-0 sm:max-w-lg">
          <VisuallyHidden>
            <SheetTitle>
              {editingTool ? 'Edit Tool Configuration' : 'New Tool Configuration'}
            </SheetTitle>
            <SheetDescription>
              Configure a tool that the agent can call during conversations.
            </SheetDescription>
          </VisuallyHidden>
          <div className="p-6 text-sm text-muted-foreground">
            Legacy tool configurations are read-only. To create or edit tools, use Workflows.
          </div>
        </SheetContent>
      </Sheet>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Tool Configuration</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the &quot;{deleteTarget?.tool_name}&quot; tool configuration.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Folder delete confirmation modal | two options */}
      <AlertDialog
        open={!!folderDeleteTarget}
        onOpenChange={(open) => !open && setFolderDeleteTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete &quot;{folderDeleteTarget?.folder.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Choose what happens to the tools inside this folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col sm:flex-row gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={buttonVariants({ variant: 'outline' })}
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
    </>
  )
}

function ToolsTableSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 h-12">
          <Skeleton className="h-4 w-[160px]" />
          <Skeleton className="h-4 w-[120px]" />
          <Skeleton className="h-4 w-[140px]" />
          <Skeleton className="h-4 w-[180px]" />
          <Skeleton className="h-4 w-[80px]" />
          <Skeleton className="h-4 w-[32px] ml-auto" />
        </div>
      ))}
    </div>
  )
}

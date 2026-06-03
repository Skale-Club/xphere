'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  GripVertical,
  MoreHorizontal,
  Pencil,
  Trash2,
  Archive,
  ScrollText,
  Trash,
} from 'lucide-react'
import {
  CursorClick,
  CalendarBlank,
  ClockCountdown,
  Lightning,
  WebhooksLogo,
  FlowArrow,
  type Icon,
} from '@phosphor-icons/react'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useSubSidebar } from '@/components/layout/sub-sidebar'
import {
  deleteFolder,
  renameFolder,
  reorderFolders,
} from '@/app/(dashboard)/workflows/_actions/folders'
import {
  moveWorkflowToFolder,
  reorderWorkflowsInFolder,
  softDeleteWorkflow,
} from '@/app/(dashboard)/workflows/_actions/workflows'
import { NewWorkflowButton } from '@/components/flows/new-workflow-button'
import { NewFolderButton } from '@/components/workflows/new-folder-button'

const UNFILED_ID = '__unfiled__'

interface WorkflowItem {
  id: string
  name: string
  kind: 'tool' | 'flow'
  trigger_type: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
  folder_id?: string | null
}

interface FolderItem {
  id: string
  name: string
  color: string | null
  parent_id: string | null
  position: number
}

interface Props {
  workflows: WorkflowItem[]
  folders: FolderItem[]
}

type DragData =
  | { type: 'workflow'; folderId: string | null }
  | { type: 'folder'; folderId: string | null }

const TRIGGER_ICONS: Record<WorkflowItem['trigger_type'], Icon> = {
  tool_call: CursorClick,
  event: CalendarBlank,
  schedule: ClockCountdown,
  manual: Lightning,
  webhook_url: WebhooksLogo,
}

const TRIGGER_COLORS: Record<WorkflowItem['trigger_type'], string> = {
  tool_call: '#6366f1',
  event: '#f59e0b',
  schedule: '#06b6d4',
  manual: '#64748b',
  webhook_url: '#f97316',
}

function workflowHref(w: WorkflowItem) {
  return w.kind === 'flow' ? `/workflows/flows/${w.id}` : `/workflows/${w.id}`
}

// ─── Root component ──────────────────────────────────────────────────────────

export function WorkflowSubNav({ workflows, folders }: Props) {
  const router = useRouter()
  const { collapse } = useSubSidebar()

  const [localWorkflows, setLocalWorkflows] = React.useState(workflows)
  const [localFolders, setLocalFolders] = React.useState(folders)
  React.useEffect(() => setLocalWorkflows(workflows), [workflows])
  React.useEffect(() => setLocalFolders(folders), [folders])

  const [activeId, setActiveId] = React.useState<string | null>(null)
  const [activeType, setActiveType] = React.useState<'workflow' | 'folder' | null>(null)
  const [overGroupId, setOverGroupId] = React.useState<string | null>(null)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
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
    const map = new Map<string | null, WorkflowItem[]>()
    map.set(null, [])
    for (const f of localFolders) map.set(f.id, [])
    for (const w of localWorkflows) {
      const key = w.folder_id ?? null
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(w)
    }
    return map
  }, [localWorkflows, localFolders])

  const unfiled = groups.get(null) ?? []

  const activeWorkflow =
    activeType === 'workflow' && activeId
      ? (localWorkflows.find((w) => w.id === activeId) ?? null)
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
    if (d?.type === 'folder' || d?.type === 'workflow') {
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

    if (aData.type === 'folder') {
      if (oData?.type !== 'folder') return
      if (over.id === active.id) return
      const oldIdx = localFolders.findIndex((f) => f.id === active.id)
      const newIdx = localFolders.findIndex((f) => f.id === over.id)
      if (oldIdx < 0 || newIdx < 0) return
      const next = arrayMove(localFolders, oldIdx, newIdx)
      setLocalFolders(next)
      const res = await reorderFolders(next.map((f) => f.id))
      if (!res.ok) {
        toast.error(res.error)
        setLocalFolders(folders)
      }
      router.refresh()
      return
    }

    if (aData.type === 'workflow') {
      const wf = localWorkflows.find((w) => w.id === active.id)
      if (!wf) return
      let targetFolderId: string | null
      if (oData?.type === 'workflow' || oData?.type === 'folder') {
        targetFolderId = oData.folderId ?? null
      } else return

      const sourceFolderId = wf.folder_id ?? null
      const targetList = (groups.get(targetFolderId) ?? []).filter((w) => w.id !== wf.id)
      let insertIdx = targetList.length
      if (oData?.type === 'workflow' && over.id !== active.id) {
        const idx = targetList.findIndex((w) => w.id === over.id)
        if (idx >= 0) insertIdx = idx
      }
      const newIds = [
        ...targetList.slice(0, insertIdx).map((w) => w.id),
        wf.id,
        ...targetList.slice(insertIdx).map((w) => w.id),
      ]

      if (sourceFolderId === targetFolderId) {
        const cur = (groups.get(sourceFolderId) ?? []).map((w) => w.id)
        if (cur.length === newIds.length && cur.every((id, i) => id === newIds[i])) return
      }

      setLocalWorkflows((prev) => {
        const updated = prev.map((w) =>
          w.id === wf.id ? { ...w, folder_id: targetFolderId } : w,
        )
        const idMap = new Map(updated.map((w) => [w.id, w]))
        const inTarget = newIds.map((id) => idMap.get(id)).filter(Boolean) as WorkflowItem[]
        const others = updated.filter((w) => (w.folder_id ?? null) !== targetFolderId)
        return [...others, ...inTarget]
      })

      if (sourceFolderId !== targetFolderId) {
        const res = await moveWorkflowToFolder(wf.id, targetFolderId)
        if (!res.ok) { toast.error(res.error); setLocalWorkflows(workflows); return }
      }
      const res2 = await reorderWorkflowsInFolder(targetFolderId, newIds)
      if (!res2.ok) { toast.error(res2.error); setLocalWorkflows(workflows); return }
      router.refresh()
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-1 border-b border-border-subtle px-2 py-2">
        <NewWorkflowButton label="Workflow" className="h-6 flex-1 text-[11px]" />
        <NewFolderButton iconOnly className="h-6 w-6 px-0" />
      </div>

      <div className="flex flex-col gap-px py-1">
        {/* Unfiled (only shown when has items) */}
        {unfiled.length > 0 && (
          <UnfiledSection
            workflows={unfiled}
            isOver={overGroupId === UNFILED_ID}
            onNavigate={collapse}
          />
        )}

        {/* Folders */}
        <SortableContext
          items={localFolders.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          {localFolders.map((folder) => (
            <FolderSection
              key={folder.id}
              folder={folder}
              workflows={groups.get(folder.id) ?? []}
              isOver={overGroupId === folder.id}
              onNavigate={collapse}
            />
          ))}
        </SortableContext>

        {localWorkflows.length === 0 && localFolders.length === 0 && (
          <div className="px-4 py-8 text-center">
            <FlowArrow className="mx-auto mb-2 h-6 w-6 text-text-tertiary" weight="fill" />
            <p className="text-[11px] text-text-tertiary">No workflows yet</p>
          </div>
        )}
      </div>

      {/* Footer links */}
      <div className="mt-auto border-t border-border-subtle px-2 py-2 flex flex-col gap-px">
        <Link
          href="/workflows/logs"
          onClick={collapse}
          className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[12px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
        >
          <ScrollText className="h-3.5 w-3.5" />
          Logs
        </Link>
        <Link
          href="/workflows/trash"
          onClick={collapse}
          className="flex items-center gap-2 rounded-[6px] px-2.5 py-1.5 text-[12px] text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
        >
          <Trash className="h-3.5 w-3.5" />
          Trash
        </Link>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <DragOverlay
            dropAnimation={{ duration: 220, easing: 'cubic-bezier(0.18,0.89,0.32,1.28)' }}
          >
            {activeWorkflow ? (
              <WorkflowDragGhost workflow={activeWorkflow} />
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

function UnfiledSection({
  workflows,
  isOver,
  onNavigate,
}: {
  workflows: WorkflowItem[]
  isOver: boolean
  onNavigate: () => void
}) {
  const [open, setOpen] = React.useState(true)
  const { setNodeRef } = useDroppable({
    id: UNFILED_ID,
    data: { type: 'folder', folderId: null },
  })

  return (
    <div ref={setNodeRef} className={cn(isOver && 'bg-accent/5 rounded-[7px]')}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 rounded-[6px] px-2 py-1 text-[11.5px] font-medium uppercase tracking-wider text-text-tertiary hover:bg-bg-tertiary hover:text-text-secondary transition-colors"
      >
        <ChevronRight
          className={cn('h-3 w-3 shrink-0 transition-transform', open && 'rotate-90')}
        />
        <span className="truncate">Unfiled</span>
        <span className="ml-auto text-[10px] tabular-nums">{workflows.length}</span>
      </button>
      {open && (
        <div className="pl-3">
          <SortableContext
            items={workflows.map((w) => w.id)}
            strategy={verticalListSortingStrategy}
          >
            {workflows.map((w) => (
              <WorkflowNavItem key={w.id} workflow={w} folderId={null} onNavigate={onNavigate} />
            ))}
          </SortableContext>
        </div>
      )}
    </div>
  )
}

// ─── Folder section ──────────────────────────────────────────────────────────

function FolderSection({
  folder,
  workflows,
  isOver,
  onNavigate,
}: {
  folder: FolderItem
  workflows: WorkflowItem[]
  isOver: boolean
  onNavigate: () => void
}) {
  const router = useRouter()
  const [open, setOpen] = React.useState(true)
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: folder.id,
    data: { type: 'folder', folderId: folder.id },
  })

  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition }

  async function handleDelete() {
    const res = await deleteFolder(folder.id, { cascadeChildren: true })
    if (!res.ok) toast.error(res.error ?? 'Failed to delete folder')
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
          className="opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-text-tertiary/60 hover:text-text-secondary transition-opacity"
          aria-label="Drag folder"
        >
          <GripVertical className="h-3 w-3" />
        </button>
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
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
          ) : (
            <FolderIcon
              className="h-3.5 w-3.5 shrink-0"
              style={folder.color ? { color: folder.color } : { color: '#f59e0b' }}
            />
          )}
          <span className="flex-1 min-w-0 truncate text-left text-[12px] font-medium text-text-secondary">
            {folder.name}
          </span>
          <span className="text-[10px] text-text-tertiary tabular-nums shrink-0">
            {workflows.length}
          </span>
        </button>

        <DropdownMenu>
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
          <DropdownMenuContent align="end" className="w-36">
            <DropdownMenuItem disabled>
              <Pencil className="h-3 w-3" />
              Rename
            </DropdownMenuItem>
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
      </div>

      {open && (
        <div className="pl-5">
          <SortableContext
            items={workflows.map((w) => w.id)}
            strategy={verticalListSortingStrategy}
          >
            {workflows.map((w) => (
              <WorkflowNavItem key={w.id} workflow={w} folderId={folder.id} onNavigate={onNavigate} />
            ))}
          </SortableContext>
          {workflows.length === 0 && (
            <p className="px-2 py-1.5 text-[11px] text-text-tertiary italic">
              Drop a workflow here
            </p>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Workflow nav item ────────────────────────────────────────────────────────

function WorkflowNavItem({
  workflow,
  folderId,
  onNavigate,
}: {
  workflow: WorkflowItem
  folderId: string | null
  onNavigate: () => void
}) {
  const router = useRouter()
  const pathname = usePathname()
  const href = workflowHref(workflow)
  const isActive = pathname === href || pathname.startsWith(href + '/')
  const Icon = TRIGGER_ICONS[workflow.trigger_type]
  const iconColor = TRIGGER_COLORS[workflow.trigger_type]

  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: workflow.id,
    data: { type: 'workflow', folderId },
  })

  const style: React.CSSProperties = { transform: CSS.Transform.toString(transform), transition }

  async function handleDelete() {
    const res = await softDeleteWorkflow(workflow.id)
    if (!res.ok) toast.error(res.error ?? 'Failed to delete')
    else { toast.success(`Moved "${workflow.name}" to trash`); router.refresh() }
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn('group relative flex items-center rounded-[6px] transition-colors', isDragging && 'opacity-40')}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-[60%] w-[2px] rounded-r-full bg-accent" />
      )}
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="ml-1 opacity-0 group-hover:opacity-100 cursor-grab active:cursor-grabbing text-text-tertiary/60 hover:text-text-secondary transition-opacity shrink-0"
        aria-label="Drag workflow"
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
        <Icon
          className="h-3 w-3 shrink-0"
          weight="fill"
          style={{ color: iconColor }}
        />
        <span className="truncate">{workflow.name}</span>
      </Link>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mr-1 h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
            aria-label="Workflow actions"
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-36">
          <DropdownMenuItem asChild>
            <Link href={href} onClick={onNavigate}>Open</Link>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className="text-rose-500 focus:text-rose-500"
            onSelect={handleDelete}
          >
            <Archive className="h-3 w-3" />
            Move to trash
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

// ─── Drag ghosts ──────────────────────────────────────────────────────────────

function WorkflowDragGhost({ workflow }: { workflow: WorkflowItem }) {
  const Icon = TRIGGER_ICONS[workflow.trigger_type]
  const color = TRIGGER_COLORS[workflow.trigger_type]
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-primary px-3 py-1.5 shadow-lg">
      <Icon className="h-3 w-3" weight="fill" style={{ color }} />
      <span className="max-w-[180px] truncate text-[12px] font-medium text-text-primary">
        {workflow.name}
      </span>
    </div>
  )
}

function FolderDragGhost({ folder }: { folder: FolderItem }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-primary px-3 py-1.5 shadow-lg">
      <FolderIcon className="h-3.5 w-3.5 text-amber-500" />
      <span className="max-w-[180px] truncate text-[12px] font-medium text-text-secondary">
        {folder.name}
      </span>
    </div>
  )
}

'use client'

// SEED-025 Phase E: unified workflows list.
// SEED-038: groups workflows by folder. Unfoldered workflows render in an
// untitled group at the top; each folder is a collapsible section with a
// rename/delete menu. Each workflow row has a [...] menu with
// "Move to folder", "Archive", and "Delete" actions.
//
// Drag-and-drop:
//   - Drag a workflow row to reorder it within a group.
//   - Drag a workflow row onto another group (a folder header, an empty
//     folder area, or any row inside it) to move it there.
//   - Drag a folder header to reorder folders amongst themselves.

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  ChevronRight,
  Folder as FolderIcon,
  FolderOpen,
  MoreHorizontal,
  Archive,
  Trash2,
  FolderInput,
  Pencil,
  GripVertical,
} from 'lucide-react'
import {
  CalendarBlank,
  ClockCountdown,
  CursorClick,
  FlowArrow,
  Lightning,
  WebhooksLogo,
  type Icon,
} from '@phosphor-icons/react'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { toast } from 'sonner'
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

import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { NewWorkflowButton } from '@/components/flows/new-workflow-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  DropdownMenuPortal,
} from '@/components/ui/dropdown-menu'

import { WorkflowToggle } from './workflow-toggle'
import {
  archiveWorkflow,
  moveWorkflowToFolder,
  reorderWorkflowsInFolder,
  softDeleteWorkflow,
} from '@/app/(dashboard)/workflows/_actions/workflows'
import {
  deleteFolder,
  renameFolder,
  reorderFolders,
} from '@/app/(dashboard)/workflows/_actions/folders'

const UNFILED_ID = '__unfiled__'

interface WorkflowSummary {
  id: string
  name: string
  slug: string
  description: string | null
  is_active: boolean
  kind: 'tool' | 'flow'
  trigger_type: 'tool_call' | 'event' | 'schedule' | 'manual' | 'webhook_url'
  trigger_config: Record<string, unknown>
  health_blocked: boolean
  health_blocked_reason: string | null
  updated_at: string
  folder_id?: string | null
}

interface WorkflowFolder {
  id: string
  org_id: string
  name: string
  color: string | null
  icon: string | null
  parent_id: string | null
  position: number
  created_by: string | null
  created_at: string
  updated_at: string
}

interface Props {
  workflows: WorkflowSummary[]
  folders?: WorkflowFolder[]
}

type DragData =
  | { type: 'workflow'; folderId: string | null }
  | { type: 'folder'; folderId: string | null }

const TRIGGER_META: Record<
  WorkflowSummary['trigger_type'],
  { label: string; Icon: Icon; color: string }
> = {
  tool_call:   { label: 'Tool call', Icon: CursorClick,    color: '#6366f1' },
  event:       { label: 'Event',     Icon: CalendarBlank,  color: '#f59e0b' },
  schedule:    { label: 'Schedule',  Icon: ClockCountdown, color: '#06b6d4' },
  manual:      { label: 'Manual',    Icon: Lightning,      color: '#64748b' },
  webhook_url: { label: 'Webhook',   Icon: WebhooksLogo,   color: '#f97316' },
}

function triggerLabel(workflow: WorkflowSummary): string {
  const meta = TRIGGER_META[workflow.trigger_type]
  if (workflow.trigger_type === 'event') {
    const eventName = workflow.trigger_config?.event as string | undefined
    return eventName ? eventName.replace('meeting.', 'Meeting · ') : meta.label
  }
  if (workflow.trigger_type === 'tool_call') {
    const toolName = workflow.trigger_config?.tool_name as string | undefined
    return toolName ? `Tool · ${toolName}` : meta.label
  }
  if (workflow.trigger_type === 'schedule') {
    const cron = workflow.trigger_config?.cron as string | undefined
    return cron ? `Cron · ${cron}` : meta.label
  }
  return meta.label
}

export function WorkflowsList({ workflows, folders = [] }: Props) {
  const router = useRouter()

  // Optimistic local state — drag-and-drop should feel instant.
  const [localWorkflows, setLocalWorkflows] = useState(workflows)
  const [localFolders, setLocalFolders] = useState(folders)
  useEffect(() => setLocalWorkflows(workflows), [workflows])
  useEffect(() => setLocalFolders(folders), [folders])

  const [activeId, setActiveId] = useState<string | null>(null)
  const [activeType, setActiveType] = useState<'workflow' | 'folder' | null>(null)
  const [overGroupId, setOverGroupId] = useState<string | null>(null)

  // Wider distance so clicks register as clicks, not drags.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const collisionDetectionStrategy: CollisionDetection = useCallback((args) => {
    const pointerCollisions = pointerWithin(args)
    if (pointerCollisions.length > 0) {
      const firstId = getFirstCollision(pointerCollisions, 'id')
      if (firstId != null) {
        return pointerCollisions.filter((c) => c.id === firstId)
      }
      return pointerCollisions
    }
    return rectIntersection(args)
  }, [])

  const groups = useMemo(() => {
    const byFolder = new Map<string | null, WorkflowSummary[]>()
    byFolder.set(null, [])
    for (const f of localFolders) byFolder.set(f.id, [])
    for (const w of localWorkflows) {
      const key = w.folder_id ?? null
      if (!byFolder.has(key)) byFolder.set(key, [])
      byFolder.get(key)!.push(w)
    }
    return byFolder
  }, [localWorkflows, localFolders])

  const unfiled = groups.get(null) ?? []

  const activeWorkflow =
    activeType === 'workflow' && activeId
      ? localWorkflows.find((w) => w.id === activeId) ?? null
      : null
  const activeFolder =
    activeType === 'folder' && activeId
      ? localFolders.find((f) => f.id === activeId) ?? null
      : null

  function handleDragStart(event: DragStartEvent) {
    const data = event.active.data.current as DragData | undefined
    setActiveId(String(event.active.id))
    setActiveType(data?.type ?? null)
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event
    if (!over) return setOverGroupId(null)
    const overData = over.data.current as
      | { type?: string; folderId?: string | null }
      | undefined
    if (overData?.type === 'folder' || overData?.type === 'workflow') {
      const fid = overData.folderId ?? null
      setOverGroupId(fid === null ? UNFILED_ID : String(fid))
    } else {
      setOverGroupId(null)
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event
    const activeData = active.data.current as DragData | undefined
    const overData = over?.data.current as
      | { type?: string; folderId?: string | null }
      | undefined
    setActiveId(null)
    setActiveType(null)
    setOverGroupId(null)
    if (!over || !activeData) return

    // ─── Folder reorder ────────────────────────────────────────────────────
    if (activeData.type === 'folder') {
      if (overData?.type !== 'folder') return
      if (over.id === active.id) return
      const oldIndex = localFolders.findIndex((f) => f.id === active.id)
      const newIndex = localFolders.findIndex((f) => f.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return
      const newOrder = arrayMove(localFolders, oldIndex, newIndex)
      setLocalFolders(newOrder)
      const res = await reorderFolders(newOrder.map((f) => f.id))
      if (!res.ok) {
        toast.error(res.error)
        setLocalFolders(folders)
        return
      }
      router.refresh()
      return
    }

    // ─── Workflow drag (reorder or move to a folder) ───────────────────────
    if (activeData.type === 'workflow') {
      const workflow = localWorkflows.find((w) => w.id === active.id)
      if (!workflow) return

      // Resolve target folder from whatever we landed on.
      let targetFolderId: string | null
      if (overData?.type === 'workflow' || overData?.type === 'folder') {
        targetFolderId = overData.folderId ?? null
      } else {
        return
      }

      const sourceFolderId = workflow.folder_id ?? null

      // Build the new ordered ID list for the target folder.
      const targetList = (groups.get(targetFolderId) ?? []).filter(
        (w) => w.id !== workflow.id,
      )
      let insertIndex = targetList.length
      if (overData?.type === 'workflow' && over.id !== active.id) {
        const idx = targetList.findIndex((w) => w.id === over.id)
        if (idx >= 0) insertIndex = idx
      }
      const newTargetIds = [
        ...targetList.slice(0, insertIndex).map((w) => w.id),
        workflow.id,
        ...targetList.slice(insertIndex).map((w) => w.id),
      ]

      // Skip no-op within same folder.
      if (sourceFolderId === targetFolderId) {
        const currentIds = (groups.get(sourceFolderId) ?? []).map((w) => w.id)
        const sameOrder =
          currentIds.length === newTargetIds.length &&
          currentIds.every((id, i) => id === newTargetIds[i])
        if (sameOrder) return
      }

      // Optimistic local update.
      setLocalWorkflows((prev) => {
        const updated = prev.map((w) =>
          w.id === workflow.id ? { ...w, folder_id: targetFolderId } : w,
        )
        // Reorder target group within prev to match newTargetIds.
        const idToWorkflow = new Map(updated.map((w) => [w.id, w]))
        const inTarget = newTargetIds
          .map((id) => idToWorkflow.get(id))
          .filter(Boolean) as WorkflowSummary[]
        const others = updated.filter(
          (w) => (w.folder_id ?? null) !== targetFolderId,
        )
        return [...others, ...inTarget]
      })

      // Persist: re-parent first (if needed), then write positions.
      if (sourceFolderId !== targetFolderId) {
        const moveRes = await moveWorkflowToFolder(workflow.id, targetFolderId)
        if (!moveRes.ok) {
          toast.error(moveRes.error)
          setLocalWorkflows(workflows)
          return
        }
      }
      const reorderRes = await reorderWorkflowsInFolder(
        targetFolderId,
        newTargetIds,
      )
      if (!reorderRes.ok) {
        toast.error(reorderRes.error)
        setLocalWorkflows(workflows)
        return
      }
      router.refresh()
    }
  }

  if (localWorkflows.length === 0 && localFolders.length === 0) {
    return (
      <Card>
        <CardContent className="p-12 text-center">
          <FlowArrow className="mx-auto h-8 w-8 text-text-tertiary mb-3" weight="fill" />
          <p className="text-sm font-medium text-text-primary mb-1">No workflows yet</p>
          <p className="text-sm text-text-secondary mb-4">
            Build your first workflow visually, or ask Copilot to create one from a single sentence.
          </p>
          <div className="inline-block">
            <NewWorkflowButton />
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetectionStrategy}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
    >
      <div className="space-y-3">
        {/* Unfoldered bucket — only render when it has rows */}
        {unfiled.length > 0 && (
          <UnfiledGroup
            workflows={unfiled}
            folders={localFolders}
            isOver={overGroupId === UNFILED_ID}
          />
        )}

        <SortableContext
          items={localFolders.map((f) => f.id)}
          strategy={verticalListSortingStrategy}
        >
          {localFolders.map((folder) => (
            <FolderGroup
              key={folder.id}
              folder={folder}
              workflows={groups.get(folder.id) ?? []}
              folders={localFolders}
              isOver={overGroupId === folder.id}
            />
          ))}
        </SortableContext>
      </div>

      {typeof document !== 'undefined' &&
        createPortal(
          <DragOverlay
            dropAnimation={{
              duration: 220,
              easing: 'cubic-bezier(0.18, 0.89, 0.32, 1.28)',
            }}
          >
            {activeWorkflow ? (
              <WorkflowDragPreview workflow={activeWorkflow} />
            ) : activeFolder ? (
              <FolderDragPreview folder={activeFolder} />
            ) : null}
          </DragOverlay>,
          document.body,
        )}
    </DndContext>
  )
}

// ─── Unfiled (non-reorderable) group ───────────────────────────────────────

function UnfiledGroup({
  workflows,
  folders,
  isOver,
}: {
  workflows: WorkflowSummary[]
  folders: WorkflowFolder[]
  isOver: boolean
}) {
  const [open, setOpen] = useState(true)
  const { setNodeRef } = useDroppable({
    id: UNFILED_ID,
    data: { type: 'folder', folderId: null },
  })

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'rounded-lg border bg-bg-secondary/30 overflow-hidden transition-colors',
        isOver ? 'border-accent/60 bg-accent-muted/10' : 'border-border-subtle',
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary/60 border-b border-border-subtle">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 text-left flex-1 min-w-0"
        >
          <ChevronRight
            className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${
              open ? 'rotate-90' : ''
            }`}
          />
          <span className="text-xs font-medium uppercase tracking-wide text-text-secondary truncate">
            Unfiled
          </span>
          <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full bg-bg-tertiary text-[10px] font-semibold text-text-tertiary tabular-nums">
            {workflows.length}
          </span>
        </button>
      </div>

      {open && (
        <GroupBody
          workflows={workflows}
          folders={folders}
          folderId={null}
          emptyLabel="No workflows."
          isOver={isOver}
        />
      )}
    </div>
  )
}

// ─── Folder group (sortable + droppable) ───────────────────────────────────

function FolderGroup({
  folder,
  workflows,
  folders,
  isOver,
}: {
  folder: WorkflowFolder
  workflows: WorkflowSummary[]
  folders: WorkflowFolder[]
  isOver: boolean
}) {
  const [open, setOpen] = useState(true)
  const [renameOpen, setRenameOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: folder.id,
    data: { type: 'folder', folderId: folder.id },
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'rounded-lg border bg-bg-secondary/30 overflow-hidden transition-colors',
        isDragging && 'opacity-40',
        isOver ? 'border-accent/60 bg-accent-muted/10' : 'border-border-subtle',
      )}
    >
      <div className="flex items-center justify-between px-3 py-2 bg-bg-secondary/60 border-b border-border-subtle">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <button
            type="button"
            {...attributes}
            {...listeners}
            className="flex h-6 w-5 items-center justify-center text-text-tertiary hover:text-text-secondary cursor-grab active:cursor-grabbing"
            aria-label="Drag folder"
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-2 text-left flex-1 min-w-0"
          >
            <ChevronRight
              className={`h-3.5 w-3.5 text-text-tertiary transition-transform ${
                open ? 'rotate-90' : ''
              }`}
            />
            {open ? (
              <FolderOpen className="h-4 w-4 text-amber-500" />
            ) : (
              <FolderIcon className="h-4 w-4 text-amber-500" />
            )}
            <span className="text-xs font-medium uppercase tracking-wide text-text-secondary truncate">
              {folder.name}
            </span>
            <span className="inline-flex items-center justify-center min-w-[20px] h-[18px] px-1.5 rounded-full bg-bg-tertiary text-[10px] font-semibold text-text-tertiary tabular-nums">
              {workflows.length}
            </span>
          </button>
        </div>

        <FolderMenu
          onRename={() => setRenameOpen(true)}
          onDelete={() => setDeleteOpen(true)}
        />
      </div>

      {open && (
        <GroupBody
          workflows={workflows}
          folders={folders}
          folderId={folder.id}
          emptyLabel="Empty folder. Drop a workflow here or use the row menu."
          isOver={isOver}
        />
      )}

      <RenameFolderDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        folder={folder}
      />
      <DeleteFolderDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        folder={folder}
        workflowCount={workflows.length}
      />
    </div>
  )
}

// ─── Group body (table of sortable rows, or empty state) ───────────────────

function GroupBody({
  workflows,
  folders,
  folderId,
  emptyLabel,
  isOver,
}: {
  workflows: WorkflowSummary[]
  folders: WorkflowFolder[]
  folderId: string | null
  emptyLabel: string
  isOver: boolean
}) {
  if (workflows.length === 0) {
    return (
      <div
        className={cn(
          'px-4 py-6 text-center text-xs transition-colors',
          isOver ? 'text-accent' : 'text-text-tertiary',
        )}
      >
        {emptyLabel}
      </div>
    )
  }
  return (
    <SortableContext
      items={workflows.map((w) => w.id)}
      strategy={verticalListSortingStrategy}
    >
      <table className="w-full text-sm">
        <thead className="bg-bg-secondary/40">
          <tr className="text-xs text-text-tertiary uppercase tracking-wide">
            <th className="w-8 px-1 py-2" />
            <th className="w-10 px-2 py-2" />
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-left font-medium px-4 py-2">Trigger</th>
            <th className="text-left font-medium px-4 py-2">Status</th>
            <th className="text-right font-medium px-4 py-2">Updated</th>
            <th className="w-10 px-2 py-2" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border-subtle">
          {workflows.map((w) => (
            <WorkflowRow
              key={w.id}
              workflow={w}
              folders={folders}
              folderId={folderId}
            />
          ))}
        </tbody>
      </table>
    </SortableContext>
  )
}

// ─── Row ────────────────────────────────────────────────────────────────────

interface RowProps {
  workflow: WorkflowSummary
  folders: WorkflowFolder[]
  folderId: string | null
}

function WorkflowRow({ workflow: w, folders, folderId }: RowProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const { Icon, color } = TRIGGER_META[w.trigger_type]

  const {
    setNodeRef,
    attributes,
    listeners,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: w.id,
    data: { type: 'workflow', folderId },
  })

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  function handleMove(targetFolderId: string | null) {
    startTransition(async () => {
      const res = await moveWorkflowToFolder(w.id, targetFolderId)
      if (!res.ok) {
        toast.error(`Could not move workflow: ${res.error}`)
        return
      }
      toast.success(
        targetFolderId
          ? `Moved "${w.name}" to folder.`
          : `Moved "${w.name}" out of its folder.`,
      )
      router.refresh()
    })
  }

  function handleArchive() {
    if (w.is_active) {
      toast.error('Deactivate the workflow before archiving it.')
      return
    }
    startTransition(async () => {
      const res = await archiveWorkflow(w.id)
      if (!res.ok) {
        toast.error(res.error ?? 'Could not archive workflow.')
        return
      }
      toast.success(`Archived "${w.name}".`)
      router.refresh()
    })
  }

  function handleSoftDelete() {
    if (w.is_active) {
      toast.error('Deactivate the workflow before moving it to trash.')
      setConfirmDelete(false)
      return
    }
    startTransition(async () => {
      const res = await softDeleteWorkflow(w.id)
      if (!res.ok) {
        toast.error(res.error ?? 'Could not move workflow to trash.')
        return
      }
      toast.success(`Moved "${w.name}" to trash.`)
      setConfirmDelete(false)
      router.refresh()
    })
  }

  const currentFolderId = w.folder_id ?? null

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={cn(
        'hover:bg-bg-secondary/40 transition-colors',
        isDragging && 'opacity-40',
      )}
    >
      <td className="w-8 px-1 py-3">
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="flex h-7 w-7 items-center justify-center text-text-tertiary hover:text-text-secondary cursor-grab active:cursor-grabbing"
          aria-label="Drag workflow"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
      </td>
      <td className="pl-0 pr-0 py-3 w-10">
        <div
          className="flex h-8 w-8 items-center justify-center rounded-[7px] shrink-0"
          style={{ backgroundColor: color }}
        >
          <Icon className="h-4 w-4 text-white" weight="fill" />
        </div>
      </td>
      <td className="px-4 py-3">
        <Link
          href={w.kind === 'flow' ? `/workflows/flows/${w.id}` : `/workflows/${w.id}`}
          className="block group"
        >
          <p className="text-sm font-medium text-text-primary group-hover:underline truncate">
            {w.name}
          </p>
          {w.description && (
            <p className="text-[11px] text-text-tertiary mt-0.5 line-clamp-1">
              {w.description}
            </p>
          )}
        </Link>
      </td>
      <td className="px-4 py-3">
        <span className="inline-flex items-center gap-1.5 text-xs text-text-secondary">
          <Icon className="h-3.5 w-3.5" weight="fill" style={{ color }} />
          {triggerLabel(w)}
        </span>
      </td>
      <td className="px-4 py-3">
        <WorkflowToggle
          workflowId={w.id}
          initialActive={w.is_active}
          blocked={w.health_blocked}
          blockedReason={w.health_blocked_reason}
        />
      </td>
      <td className="px-4 py-3 text-right text-[11px] text-text-tertiary tabular-nums">
        {formatDistanceToNow(parseISO(w.updated_at), { addSuffix: true })}
      </td>
      <td className="pr-2 pl-0 py-3 w-10 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              aria-label="Workflow actions"
              disabled={isPending}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuSub>
              <DropdownMenuSubTrigger>
                <FolderInput className="h-3.5 w-3.5" />
                <span>Move to folder</span>
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className="w-56">
                  <DropdownMenuItem
                    disabled={currentFolderId === null}
                    onSelect={() => handleMove(null)}
                  >
                    <FolderIcon className="h-3.5 w-3.5 opacity-50" />
                    <span>(no folder)</span>
                  </DropdownMenuItem>
                  {folders.length > 0 && <DropdownMenuSeparator />}
                  {folders.map((f) => (
                    <DropdownMenuItem
                      key={f.id}
                      disabled={currentFolderId === f.id}
                      onSelect={() => handleMove(f.id)}
                    >
                      <FolderIcon className="h-3.5 w-3.5 text-amber-500" />
                      <span className="truncate">{f.name}</span>
                    </DropdownMenuItem>
                  ))}
                  {folders.length === 0 && (
                    <DropdownMenuItem disabled>
                      <span className="text-text-tertiary">No folders yet</span>
                    </DropdownMenuItem>
                  )}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={handleArchive}>
              <Archive className="h-3.5 w-3.5" />
              <span>Archive</span>
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault()
                setConfirmDelete(true)
              }}
              className="text-rose-500 focus:text-rose-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>Delete</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Move workflow to trash?</AlertDialogTitle>
              <AlertDialogDescription>
                &ldquo;{w.name}&rdquo; will be moved to the Trash. You can restore it from there
                until it&rsquo;s permanently deleted.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={isPending}
                onClick={(e) => {
                  e.preventDefault()
                  handleSoftDelete()
                }}
                className="bg-rose-500 text-white hover:bg-rose-600"
              >
                Move to trash
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </td>
    </tr>
  )
}

// ─── Drag overlays ─────────────────────────────────────────────────────────

function WorkflowDragPreview({ workflow }: { workflow: WorkflowSummary }) {
  const { Icon, color } = TRIGGER_META[workflow.trigger_type]
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border-subtle bg-bg-primary shadow-lg px-4 py-2.5">
      <GripVertical className="h-3.5 w-3.5 text-text-tertiary" />
      <div
        className="flex h-8 w-8 items-center justify-center rounded-[7px] shrink-0"
        style={{ backgroundColor: color }}
      >
        <Icon className="h-4 w-4 text-white" weight="fill" />
      </div>
      <span className="text-sm font-medium text-text-primary truncate max-w-[280px]">
        {workflow.name}
      </span>
    </div>
  )
}

function FolderDragPreview({ folder }: { folder: WorkflowFolder }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-bg-primary shadow-lg px-3 py-2">
      <GripVertical className="h-3.5 w-3.5 text-text-tertiary" />
      <FolderIcon className="h-4 w-4 text-amber-500" />
      <span className="text-xs font-medium uppercase tracking-wide text-text-secondary truncate max-w-[260px]">
        {folder.name}
      </span>
    </div>
  )
}

// ─── Folder menu (header) ───────────────────────────────────────────────────

interface FolderMenuProps {
  onRename: () => void
  onDelete: () => void
}

function FolderMenu({ onRename, onDelete }: FolderMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0"
          aria-label="Folder actions"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onSelect={onRename}>
          <Pencil className="h-3.5 w-3.5" />
          <span>Rename</span>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault()
            onDelete()
          }}
          className="text-rose-500 focus:text-rose-500"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span>Delete</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ─── Rename folder dialog ───────────────────────────────────────────────────

function RenameFolderDialog({
  open,
  onOpenChange,
  folder,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: WorkflowFolder
}) {
  const router = useRouter()
  const [name, setName] = useState(folder.name)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Folder name is required.')
      return
    }
    if (trimmed === folder.name) {
      onOpenChange(false)
      return
    }
    startTransition(async () => {
      const res = await renameFolder(folder.id, { name: trimmed })
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      toast.success('Folder renamed.')
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setName(folder.name)
        onOpenChange(o)
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <form onSubmit={handleSubmit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Rename folder</DialogTitle>
            <DialogDescription>Choose a new name for this folder.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="folder-rename">Name</Label>
            <Input
              id="folder-rename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              disabled={isPending}
              maxLength={120}
            />
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

// ─── Delete folder dialog ───────────────────────────────────────────────────

function DeleteFolderDialog({
  open,
  onOpenChange,
  folder,
  workflowCount,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  folder: WorkflowFolder
  workflowCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleDelete() {
    startTransition(async () => {
      const res = await deleteFolder(folder.id, { cascadeChildren: true })
      if (!res.ok) {
        toast.error(`Could not delete folder: ${res.error}`)
        return
      }
      toast.success(
        workflowCount > 0
          ? `Deleted "${folder.name}". ${workflowCount} workflow${
              workflowCount !== 1 ? 's' : ''
            } moved to trash.`
          : `Deleted "${folder.name}".`,
      )
      onOpenChange(false)
      router.refresh()
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete folder &ldquo;{folder.name}&rdquo;?</AlertDialogTitle>
          <AlertDialogDescription>
            {workflowCount > 0
              ? `This folder contains ${workflowCount} workflow${
                  workflowCount !== 1 ? 's' : ''
                }. They will be moved to the Trash. You can restore them from there.`
              : 'The folder will be removed. No workflows are inside, so nothing else is affected.'}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={isPending}
            onClick={(e) => {
              e.preventDefault()
              handleDelete()
            }}
            className="bg-rose-500 text-white hover:bg-rose-600"
          >
            Delete folder
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

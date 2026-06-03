'use client'

// Redesigned task detail modal (visual + structural refactor + subtask drill).
//
// Layout:
//   ┌─ Dialog ────────────────────────────────────────────────────────────┐
//   │  TaskHeader (project · ancestor crumbs · #id · title · ⋯)           │
//   │  Meta row  (Step · Priority · Validation · Assignee · DateRange)    │
//   │  ┌──────────────────────────────┐  ┌──────────────────────────┐    │
//   │  │  Tabs (Details | AI | Activity) │  SubtasksPanel            │    │
//   │  │  Content (scrolls)           │  (children of focused task) │    │
//   │  └──────────────────────────────┘  └──────────────────────────┘    │
//   └─────────────────────────────────────────────────────────────────────┘
//
// Focus stack:
//   focusStack[]  = chain of { id, name } from root → currently focused task.
//   Click a subtask in the right panel → push.
//   Click a breadcrumb crumb → slice (pop to that depth).
//   The whole TaskBody re-fetches whenever the focused id changes.

import * as React from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Loader2 } from 'lucide-react'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui/tabs'

import { AssigneePicker } from '@/components/projects/assignee-picker'
import { TaskHeader, type BreadcrumbCrumb } from '@/components/projects/task-detail/task-header'
import { PropertyPill, type PropertyPillOption } from '@/components/projects/task-detail/property-pill'
import { DateTimeRangePicker, type DateRangePatch } from '@/components/projects/task-detail/datetime-range-picker'
import { DetailsTab } from '@/components/projects/task-detail/details-tab'
import { AiTab } from '@/components/projects/task-detail/ai-tab'
import { ActivityTab } from '@/components/projects/task-detail/activity-tab'
import { SubtasksPanel } from '@/components/projects/task-detail/subtasks-panel'

import {
  getTask,
  getSubtasks,
  updateTask,
  deleteTask,
  archiveTask,
  setTaskValidationStatus,
  createTask,
} from '@/app/(dashboard)/projects/actions'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'
import type {
  ProjectTaskRow,
  ProjectTaskStep,
  TaskPriority,
  ProjectValidationStatus,
  ProjectLabelRow,
} from '@/types/database'

const STEP_OPTIONS: PropertyPillOption<ProjectTaskStep>[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'doing', label: 'Doing' },
  { value: 'done', label: 'Done' },
]

const PRIORITY_OPTIONS: PropertyPillOption<TaskPriority>[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const VALIDATION_OPTIONS: PropertyPillOption<ProjectValidationStatus>[] = [
  { value: 'not_required', label: 'Not Required', className: 'text-text-tertiary' },
  { value: 'needs_review', label: 'Needs Review', className: 'text-yellow-600' },
  { value: 'approved', label: 'Approved', className: 'text-green-600' },
  { value: 'changes_requested', label: 'Changes Requested', className: 'text-orange-600' },
  { value: 'rejected', label: 'Rejected', className: 'text-red-600' },
]

const VALIDATION_COLORS: Record<string, string> = {
  not_required: 'text-text-tertiary',
  needs_review: 'text-yellow-600',
  approved: 'text-green-600',
  changes_requested: 'text-orange-600',
  rejected: 'text-red-600',
}

interface Props {
  taskId: string | null
  projectId: string
  projectName?: string | null
  labels: ProjectLabelRow[]
  onClose: () => void
  onRefresh: () => void
}

// `labels` is reserved for a future labels-picker tool; signature stays stable
// for the call site even though the prop is unused here today.

export function TaskDetailSheet({ taskId, projectId, projectName, onClose, onRefresh }: Props) {
  return (
    <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent hideCloseButton className="max-w-5xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] md:max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col">
        <VisuallyHidden>
          <DialogTitle>Task detail</DialogTitle>
        </VisuallyHidden>
        {taskId && (
          <TaskBody
            key={taskId}
            rootTaskId={taskId}
            projectId={projectId}
            projectName={projectName ?? null}
            onClose={onClose}
            onRefresh={onRefresh}
          />
        )}
      </DialogContent>
    </Dialog>
  )
}

type FocusFrame = { id: string; name: string }

interface BodyProps {
  rootTaskId: string
  projectId: string
  projectName: string | null
  onClose: () => void
  onRefresh: () => void
}

function TaskBody({ rootTaskId, projectId, projectName, onClose, onRefresh }: BodyProps) {
  // Focus stack | first frame is the originally-opened task; drilling into a
  // subtask pushes a frame, breadcrumb click slices back.
  const [focusStack, setFocusStack] = React.useState<FocusFrame[]>([
    { id: rootTaskId, name: '' },
  ])
  const focused = focusStack[focusStack.length - 1]

  const [task, setTask] = React.useState<TaskWithLabels | null>(null)
  const [subtasks, setSubtasks] = React.useState<ProjectTaskRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [description, setDescription] = React.useState('')
  const requestIdRef = React.useRef(0)

  // Refetch whenever the focused id changes (initial mount, drill-in, or pop).
  React.useEffect(() => {
    const id = ++requestIdRef.current
    setLoading(true)
    Promise.all([getTask(focused.id), getSubtasks(focused.id)])
      .then(([t, subs]) => {
        if (requestIdRef.current !== id) return
        setTask(t)
        setSubtasks(subs)
        setDescription(t?.description ?? '')
        // Patch the focused frame's name now that we have it.
        if (t?.name) {
          setFocusStack((s) =>
            s.map((f, i) =>
              i === s.length - 1 && f.name !== t.name ? { ...f, name: t.name } : f,
            ),
          )
        }
      })
      .finally(() => {
        if (requestIdRef.current === id) setLoading(false)
      })
  }, [focused.id])

  const refetchFocused = React.useCallback(async () => {
    const [t, subs] = await Promise.all([getTask(focused.id), getSubtasks(focused.id)])
    setTask(t)
    setSubtasks(subs)
    if (t?.name) {
      setFocusStack((s) =>
        s.map((f, i) =>
          i === s.length - 1 && f.name !== t.name ? { ...f, name: t.name } : f,
        ),
      )
    }
  }, [focused.id])

  const save = React.useCallback(
    async (patch: Partial<Omit<ProjectTaskRow, 'id' | 'org_id' | 'project_id' | 'created_at' | 'updated_at'>>) => {
      if (!task) return
      setSaving(true)
      try {
        await updateTask(task.id, projectId, patch)
        await refetchFocused()
        onRefresh()
      } catch {
        toast.error('Failed to save')
      } finally {
        setSaving(false)
      }
    },
    [task, projectId, onRefresh, refetchFocused],
  )

  const handleDelete = React.useCallback(async () => {
    if (!task) return
    try {
      await deleteTask(task.id, projectId)
      toast.success('Task deleted')
      // If we deleted a nested focus, pop back to the parent instead of closing.
      if (focusStack.length > 1) {
        setFocusStack((s) => s.slice(0, -1))
        onRefresh()
      } else {
        onClose()
        onRefresh()
      }
    } catch {
      toast.error('Failed to delete')
    }
  }, [task, projectId, focusStack.length, onClose, onRefresh])

  const handleArchive = React.useCallback(async () => {
    if (!task) return
    try {
      await archiveTask(task.id, projectId)
      toast.success('Task archived')
      if (focusStack.length > 1) {
        setFocusStack((s) => s.slice(0, -1))
        onRefresh()
      } else {
        onClose()
        onRefresh()
      }
    } catch {
      toast.error('Failed to archive')
    }
  }, [task, projectId, focusStack.length, onClose, onRefresh])

  const handleDeleteSubtask = React.useCallback(
    async (sub: ProjectTaskRow) => {
      try {
        await deleteTask(sub.id, projectId)
        setSubtasks((p) => p.filter((s) => s.id !== sub.id))
        toast.success('Subtask deleted')
        onRefresh()
      } catch {
        toast.error('Failed to delete subtask')
      }
    },
    [projectId, onRefresh],
  )

  const handleArchiveSubtask = React.useCallback(
    async (sub: ProjectTaskRow) => {
      try {
        await archiveTask(sub.id, projectId)
        setSubtasks((p) => p.filter((s) => s.id !== sub.id))
        toast.success('Subtask archived')
        onRefresh()
      } catch {
        toast.error('Failed to archive subtask')
      }
    },
    [projectId, onRefresh],
  )

  const handleAddSubtask = React.useCallback(
    async (name: string) => {
      if (!task) return
      try {
        const sub = await createTask({
          project_id: projectId,
          name,
          parent_task_id: task.id,
          step: task.step,
        })
        if (sub) setSubtasks((p) => [...p, sub])
      } catch {
        toast.error('Failed to create subtask')
      }
    },
    [task, projectId],
  )

  const handleToggleSubtask = React.useCallback(
    async (sub: ProjectTaskRow) => {
      const completed = !sub.completed
      const completed_at = completed ? new Date().toISOString() : null
      try {
        await updateTask(sub.id, projectId, { completed, completed_at })
        setSubtasks((p) =>
          p.map((s) => (s.id === sub.id ? { ...s, completed, completed_at } : s)),
        )
      } catch {
        toast.error('Failed to update subtask')
      }
    },
    [projectId],
  )

  const handleDrillInto = React.useCallback((sub: ProjectTaskRow) => {
    setFocusStack((s) => [...s, { id: sub.id, name: sub.name }])
  }, [])

  const handleDateRange = React.useCallback(
    (patch: DateRangePatch) => {
      void save(patch)
    },
    [save],
  )

  // Build the breadcrumb chain | all ancestors of focused are clickable crumbs.
  const crumbs: BreadcrumbCrumb[] = focusStack.slice(0, -1).map((f, i) => ({
    label: f.name || '…',
    onClick: () => setFocusStack((s) => s.slice(0, i + 1)),
  }))

  if (loading || !task) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </div>
    )
  }

  return (
    <>
      <TaskHeader
        taskId={task.id}
        projectName={projectName}
        name={task.name}
        saving={saving}
        crumbs={crumbs}
        onRename={(next) => save({ name: next })}
        onDelete={handleDelete}
        onArchive={handleArchive}
      />

      {/* Meta row | horizontally scrollable on narrow widths */}
      <div className="px-5 sm:px-6 py-3 border-b border-border-subtle">
        <div className="flex flex-wrap items-center gap-1.5">
          <PropertyPill<ProjectTaskStep>
            label="Step"
            value={task.step}
            options={STEP_OPTIONS}
            onChange={(v) => save({ step: v })}
          />
          <PropertyPill<TaskPriority>
            label="Priority"
            value={task.priority}
            options={PRIORITY_OPTIONS}
            onChange={(v) => save({ priority: v })}
          />
          <PropertyPill<ProjectValidationStatus>
            label="Validation"
            value={task.validation_status}
            options={VALIDATION_OPTIONS}
            valueClassName={VALIDATION_COLORS[task.validation_status]}
            onChange={async (v) => {
              try {
                await setTaskValidationStatus(task.id, projectId, v)
                await refetchFocused()
                onRefresh()
              } catch {
                toast.error('Failed to update validation')
              }
            }}
          />
          <span className="h-3 w-px bg-border-subtle mx-0.5" aria-hidden />
          <AssigneePicker
            taskId={task.id}
            projectId={projectId}
            current={task.assignee}
            onChange={() => {
              onRefresh()
              void refetchFocused()
            }}
          />
          <DateTimeRangePicker
            startDate={task.start_date}
            startTime={task.start_time}
            endDate={task.end_date}
            endTime={task.end_time}
            onChange={handleDateRange}
          />
        </div>
      </div>

      {/* Split content: tabs (left) + subtasks panel (right). Stacks on mobile. */}
      <div className="flex flex-col md:flex-row flex-1 min-h-0">
        <div className="flex flex-col flex-1 min-w-0 min-h-0">
          <Tabs defaultValue="details" className="flex-1 min-h-0 flex flex-col">
            <TabsList className="rounded-none border-b border-border-subtle bg-transparent px-5 sm:px-6 h-10 justify-start gap-1">
              <TabsTrigger value="details" className="rounded-md data-[state=active]:bg-bg-tertiary/50 text-[13px]">
                Details
              </TabsTrigger>
              <TabsTrigger value="ai" className="rounded-md data-[state=active]:bg-bg-tertiary/50 text-[13px]">
                AI
              </TabsTrigger>
              <TabsTrigger value="activity" className="rounded-md data-[state=active]:bg-bg-tertiary/50 text-[13px]">
                Activity
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 min-h-0 overflow-y-auto px-5 sm:px-6 py-5">
              <TabsContent value="details" className="m-0 focus-visible:outline-none">
                <DetailsTab
                  task={task}
                  description={description}
                  setDescription={setDescription}
                  onSaveDescription={(md) => save({ description: md })}
                  onSaveDeliverable={(next) => save({ expected_deliverable: next })}
                />
              </TabsContent>
              <TabsContent value="ai" className="m-0 focus-visible:outline-none">
                <AiTab
                  task={task}
                  onSaveAiContext={(next) => save({ ai_context: next })}
                  onSaveValidationCriteria={(next) => save({ validation_criteria: next })}
                />
              </TabsContent>
              <TabsContent value="activity" className="m-0 focus-visible:outline-none">
                <ActivityTab taskId={task.id} projectId={projectId} />
              </TabsContent>
            </div>
          </Tabs>
        </div>

        <div className="md:w-[320px] shrink-0 flex flex-col min-h-0">
          <SubtasksPanel
            parentTaskId={task.id}
            subtasks={subtasks}
            onToggle={handleToggleSubtask}
            onAdd={handleAddSubtask}
            onDrillInto={handleDrillInto}
            onDelete={handleDeleteSubtask}
            onArchive={handleArchiveSubtask}
          />
        </div>
      </div>
    </>
  )
}

'use client'

// Redesigned task detail modal (phase: visual + structural refactor).
//
// Layout:
//   ┌─ Dialog ────────────────────────────────────────────────┐
//   │  TaskHeader (breadcrumb + title + ⋯ menu)               │
//   │  Meta row (PropertyPills + Assignee + DateRange)        │
//   │  Tabs (Details | AI | Activity)                         │
//   │  Tab content (scrollable)                               │
//   └─────────────────────────────────────────────────────────┘
//
// All fetching/saving lives here | tabs receive props. Stale-fetch
// protection via requestIdRef on the main load effect.

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
import { TaskHeader } from '@/components/projects/task-detail/task-header'
import { PropertyPill, type PropertyPillOption } from '@/components/projects/task-detail/property-pill'
import { DateTimeRangePicker, type DateRangePatch } from '@/components/projects/task-detail/datetime-range-picker'
import { DetailsTab } from '@/components/projects/task-detail/details-tab'
import { AiTab } from '@/components/projects/task-detail/ai-tab'
import { ActivityTab } from '@/components/projects/task-detail/activity-tab'

import {
  getTask,
  getSubtasks,
  updateTask,
  deleteTask,
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

// Note: `labels` is reserved for a future labels-picker tool; keeping the prop
// signature stable for the call site.

export function TaskDetailSheet({ taskId, projectId, projectName, onClose, onRefresh }: Props) {
  return (
    <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] md:max-h-[90vh] overflow-hidden p-0 gap-0 flex flex-col">
        <VisuallyHidden>
          <DialogTitle>Task detail</DialogTitle>
        </VisuallyHidden>
        {taskId && (
          <TaskBody
            key={taskId}
            taskId={taskId}
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

interface BodyProps {
  taskId: string
  projectId: string
  projectName: string | null
  onClose: () => void
  onRefresh: () => void
}

function TaskBody({ taskId, projectId, projectName, onClose, onRefresh }: BodyProps) {
  const [task, setTask] = React.useState<TaskWithLabels | null>(null)
  const [subtasks, setSubtasks] = React.useState<ProjectTaskRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [saving, setSaving] = React.useState(false)
  const [description, setDescription] = React.useState('')
  const requestIdRef = React.useRef(0)

  // Initial + reload on task switch (component is keyed by taskId so this only
  // fires once per mount, but we still guard against stale responses).
  React.useEffect(() => {
    const id = ++requestIdRef.current
    setLoading(true)
    Promise.all([getTask(taskId), getSubtasks(taskId)])
      .then(([t, subs]) => {
        if (requestIdRef.current !== id) return
        setTask(t)
        setSubtasks(subs)
        setDescription(t?.description ?? '')
      })
      .finally(() => {
        if (requestIdRef.current === id) setLoading(false)
      })
  }, [taskId])

  const save = React.useCallback(
    async (patch: Partial<Omit<ProjectTaskRow, 'id' | 'org_id' | 'project_id' | 'created_at' | 'updated_at'>>) => {
      if (!task) return
      setSaving(true)
      try {
        await updateTask(task.id, projectId, patch)
        const updated = await getTask(task.id)
        if (updated) setTask(updated)
        onRefresh()
      } catch {
        toast.error('Failed to save')
      } finally {
        setSaving(false)
      }
    },
    [task, projectId, onRefresh],
  )

  const handleDelete = React.useCallback(async () => {
    if (!task) return
    try {
      await deleteTask(task.id, projectId)
      toast.success('Task deleted')
      onClose()
      onRefresh()
    } catch {
      toast.error('Failed to delete')
    }
  }, [task, projectId, onClose, onRefresh])

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

  const handleDateRange = React.useCallback(
    (patch: DateRangePatch) => {
      void save(patch)
    },
    [save],
  )

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
        onRename={(next) => save({ name: next })}
        onDelete={handleDelete}
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
                const updated = await getTask(task.id)
                if (updated) setTask(updated)
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
              void getTask(task.id).then((t) => t && setTask(t))
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
              subtasks={subtasks}
              description={description}
              setDescription={setDescription}
              onSaveDescription={(md) => save({ description: md })}
              onSaveDeliverable={(next) => save({ expected_deliverable: next })}
              onAddSubtask={handleAddSubtask}
              onToggleSubtask={handleToggleSubtask}
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
    </>
  )
}

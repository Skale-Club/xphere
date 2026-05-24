'use client'

// Renders task detail as a centered Dialog (was Sheet before R11).

import * as React from 'react'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { MarkdownEditor } from '@/components/projects/markdown-editor'
import { ExecutionRunsPanel } from '@/components/projects/execution-runs-panel'
import { AiViewPanel } from '@/components/projects/ai-view-panel'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import {
  getTask,
  getSubtasks,
  updateTask,
  deleteTask,
  setTaskValidationStatus,
  createTask,
} from '@/app/(dashboard)/projects/actions'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'
import type { ProjectTaskRow, ProjectTaskStep, TaskPriority, ProjectValidationStatus, ProjectLabelRow } from '@/types/database'

const STEP_OPTIONS: { value: ProjectTaskStep; label: string }[] = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'To Do' },
  { value: 'doing', label: 'Doing' },
  { value: 'done', label: 'Done' },
]

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
]

const VALIDATION_OPTIONS: { value: ProjectValidationStatus; label: string }[] = [
  { value: 'not_required', label: 'Not Required' },
  { value: 'needs_review', label: 'Needs Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'changes_requested', label: 'Changes Requested' },
  { value: 'rejected', label: 'Rejected' },
]

const VALIDATION_COLORS: Record<string, string> = {
  not_required: 'text-muted-foreground',
  needs_review: 'text-yellow-600',
  approved: 'text-green-600',
  changes_requested: 'text-orange-600',
  rejected: 'text-red-600',
}

interface Props {
  taskId: string | null
  projectId: string
  labels: ProjectLabelRow[]
  onClose: () => void
  onRefresh: () => void
}

export function TaskDetailSheet({ taskId, projectId, labels, onClose, onRefresh }: Props) {
  const [task, setTask] = React.useState<TaskWithLabels | null>(null)
  const [subtasks, setSubtasks] = React.useState<ProjectTaskRow[]>([])
  const [loading, setLoading] = React.useState(false)

  const [newSubtaskName, setNewSubtaskName] = React.useState('')
  const [addingSubtask, setAddingSubtask] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [name, setName] = React.useState('')
  const [description, setDescription] = React.useState('')

  React.useEffect(() => {
    if (!taskId) { setTask(null); return }
    setLoading(true)
    Promise.all([getTask(taskId), getSubtasks(taskId)])
      .then(([t, subs]) => {
        setTask(t)
        setSubtasks(subs)
        setName(t?.name ?? '')
        setDescription(t?.description ?? '')
      })
      .finally(() => setLoading(false))
  }, [taskId])

  async function save(patch: Partial<Omit<ProjectTaskRow, 'id' | 'org_id' | 'project_id' | 'created_at' | 'updated_at'>>) {
    if (!task) return
    setSaving(true)
    try {
      await updateTask(task.id, projectId, patch)
      const updated = await getTask(task.id)
      setTask(updated)
      onRefresh()
    } catch {
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!task) return
    if (!confirm('Delete this task?')) return
    try {
      await deleteTask(task.id, projectId)
      onClose()
      onRefresh()
      toast.success('Task deleted')
    } catch {
      toast.error('Failed to delete')
    }
  }

  async function addSubtask() {
    if (!task || !newSubtaskName.trim()) return
    setAddingSubtask(true)
    try {
      const sub = await createTask({
        project_id: projectId,
        name: newSubtaskName.trim(),
        parent_task_id: task.id,
        step: task.step,
      })
      if (sub) setSubtasks((p) => [...p, sub])
      setNewSubtaskName('')
    } catch {
      toast.error('Failed to create subtask')
    } finally {
      setAddingSubtask(false)
    }
  }

  async function toggleSubtask(sub: ProjectTaskRow) {
    const completed = !sub.completed
    try {
      await updateTask(sub.id, projectId, {
        completed,
        completed_at: completed ? new Date().toISOString() : null,
      })
      setSubtasks((p) => p.map((s) => s.id === sub.id ? { ...s, completed, completed_at: completed ? new Date().toISOString() : null } : s))
    } catch {
      toast.error('Failed to update subtask')
    }
  }

  return (
    <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto p-0 sm:p-0">
        <div className="p-5 sm:p-6 space-y-5 pb-8">
          {loading && (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {!loading && task && (
            <>
            <DialogHeader>
              <DialogTitle className="sr-only">{name || 'Task detail'}</DialogTitle>
            </DialogHeader>

            {/* Name */}
            <div>
              <Input
                className="text-base font-medium border-0 shadow-none p-0 h-auto focus-visible:ring-0 resize-none"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => name !== task.name && save({ name })}
              />
            </div>

            {/* Step + Priority row */}
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Step</Label>
                <Select
                  value={task.step}
                  onValueChange={(v) => save({ step: v as ProjectTaskStep })}
                >
                  <SelectTrigger className="h-9 sm:h-7 text-sm sm:text-xs w-full sm:w-32">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STEP_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Priority</Label>
                <Select
                  value={task.priority}
                  onValueChange={(v) => save({ priority: v as TaskPriority })}
                >
                  <SelectTrigger className="h-7 text-xs w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PRIORITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Validation</Label>
                <Select
                  value={task.validation_status}
                  onValueChange={(v) => setTaskValidationStatus(task.id, projectId, v as ProjectValidationStatus).then(() => save({}))}
                >
                  <SelectTrigger className={cn('h-7 text-xs w-40', VALIDATION_COLORS[task.validation_status])}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VALIDATION_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value} className={cn('text-xs', VALIDATION_COLORS[o.value])}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Start Date</Label>
                <Input
                  type="date"
                  className="h-9 text-sm w-full"
                  value={task.start_date ?? ''}
                  onChange={(e) => save({ start_date: e.target.value || null })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">End Date</Label>
                <Input
                  type="date"
                  className="h-9 text-sm w-full"
                  value={task.end_date ?? ''}
                  onChange={(e) => save({ end_date: e.target.value || null })}
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <MarkdownEditor
                value={description}
                onChange={setDescription}
                onBlur={(md) => md !== task.description && save({ description: md })}
                placeholder="Add a description..."
                minRows={4}
              />
            </div>

            {/* Deliverable */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Expected Deliverable</Label>
              <Input
                className="text-sm h-8"
                defaultValue={task.expected_deliverable ?? ''}
                onBlur={(e) => e.target.value !== (task.expected_deliverable ?? '') && save({ expected_deliverable: e.target.value })}
                placeholder="What should be delivered?"
              />
            </div>

            {/* Subtasks */}
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">
                Subtasks {subtasks.length > 0 && `(${subtasks.filter((s) => s.completed).length}/${subtasks.length})`}
              </Label>
              <div className="space-y-1">
                {subtasks.map((sub) => (
                  <div key={sub.id} className="flex items-center gap-2 group py-0.5">
                    <button onClick={() => toggleSubtask(sub)} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
                      {sub.completed
                        ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                        : <div className="h-4 w-4 rounded-full border-2 border-muted-foreground/40" />
                      }
                    </button>
                    <span className={cn('text-sm flex-1', sub.completed && 'line-through text-muted-foreground')}>
                      {sub.name}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  className="h-7 text-xs flex-1"
                  placeholder="Add subtask..."
                  value={newSubtaskName}
                  onChange={(e) => setNewSubtaskName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addSubtask()}
                />
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={addSubtask} disabled={addingSubtask || !newSubtaskName.trim()}>
                  {addingSubtask ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                </Button>
              </div>
            </div>

            {/* Execution Runs */}
            <ExecutionRunsPanel taskId={task.id} projectId={projectId} />

            {/* AI View */}
            <AiViewPanel task={task} projectId={projectId} onSave={save} />

            {/* Delete */}
            <div className="pt-2 border-t border-border-subtle">
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 w-full" onClick={handleDelete}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Task
              </Button>
            </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

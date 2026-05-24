'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Loader2, Bot, CheckCircle2, Clock, Tag, Calendar, User, ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
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
  const [aiViewOpen, setAiViewOpen] = React.useState(false)
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
    <Sheet open={!!taskId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-xl overflow-y-auto" side="right">
        {loading && (
          <div className="flex items-center justify-center h-40">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && task && (
          <div className="space-y-5 pb-8">
            <SheetHeader>
              <SheetTitle className="sr-only">Task detail</SheetTitle>
            </SheetHeader>

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
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Step</Label>
                <Select
                  value={task.step}
                  onValueChange={(v) => save({ step: v as ProjectTaskStep })}
                >
                  <SelectTrigger className="h-7 text-xs w-32">
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
            <div className="flex flex-wrap gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Start Date</Label>
                <Input
                  type="date"
                  className="h-7 text-xs w-36"
                  value={task.start_date ?? ''}
                  onChange={(e) => save({ start_date: e.target.value || null })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">End Date</Label>
                <Input
                  type="date"
                  className="h-7 text-xs w-36"
                  value={task.end_date ?? ''}
                  onChange={(e) => save({ end_date: e.target.value || null })}
                />
              </div>
            </div>

            {/* Description */}
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onBlur={() => description !== task.description && save({ description })}
                placeholder="Add a description..."
                rows={4}
                className="text-sm resize-none"
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

            {/* AI View toggle */}
            <div className="border border-border-subtle rounded-lg overflow-hidden">
              <button
                onClick={() => setAiViewOpen((v) => !v)}
                className="flex items-center justify-between w-full px-3 py-2.5 text-sm hover:bg-accent/5 transition-colors"
              >
                <span className="flex items-center gap-2 font-medium">
                  <Bot className="h-4 w-4 text-purple-500" />
                  AI View
                </span>
                {aiViewOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>

              {aiViewOpen && (
                <div className="px-3 pb-3 space-y-3 border-t border-border-subtle pt-3 bg-accent/5">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">AI Context</Label>
                    <Textarea
                      defaultValue={task.ai_context ?? ''}
                      onBlur={(e) => e.target.value !== (task.ai_context ?? '') && save({ ai_context: e.target.value })}
                      placeholder="Context for AI agents..."
                      rows={3}
                      className="text-xs resize-none bg-background"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Validation Criteria</Label>
                    <Textarea
                      defaultValue={task.validation_criteria ?? ''}
                      onBlur={(e) => e.target.value !== (task.validation_criteria ?? '') && save({ validation_criteria: e.target.value })}
                      placeholder="How to validate this task is done..."
                      rows={2}
                      className="text-xs resize-none bg-background"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                    <div>
                      <p className="font-medium text-foreground/70 mb-0.5">Execution Status</p>
                      <p className="capitalize">{task.execution_status.replace('_', ' ')}</p>
                    </div>
                    {task.last_agent_update && (
                      <div>
                        <p className="font-medium text-foreground/70 mb-0.5">Last Agent Update</p>
                        <p>{new Date(task.last_agent_update).toLocaleString()}</p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Delete */}
            <div className="pt-2 border-t border-border-subtle">
              <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive hover:bg-destructive/10 w-full" onClick={handleDelete}>
                <Trash2 className="h-4 w-4 mr-2" />
                Delete Task
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

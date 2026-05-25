'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { Loader2, CheckCircle2, Plus, Trash2, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { MarkdownEditor } from '@/components/projects/markdown-editor'
import { ExecutionRunsPanel } from '@/components/projects/execution-runs-panel'
import { AiViewPanel } from '@/components/projects/ai-view-panel'
import { AssigneePicker } from '@/components/projects/assignee-picker'
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

const DEFAULT_START_TIME = '09:00'
const DEFAULT_END_TIME = '17:00'
const TIME_OPTIONS = Array.from({ length: 48 }, (_, i) => {
  const hours = Math.floor(i / 2)
  const minutes = i % 2 === 0 ? '00' : '30'
  return `${String(hours).padStart(2, '0')}:${minutes}`
})

function toHHMM(time: string | null | undefined) {
  return time?.slice(0, 5) ?? ''
}

interface Props {
  taskId: string | null
  projectId: string
  labels: ProjectLabelRow[]
  onClose: () => void
  onRefresh: () => void
}

function SectionCard({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-xl border border-border-subtle bg-bg-secondary p-4 space-y-3', className)}>
      {children}
    </div>
  )
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
      {children}
    </Label>
  )
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
    if (!taskId) { setTask(null); setAiViewOpen(false); return }
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
    <>
      <Dialog open={!!taskId} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-4xl max-h-[92vh] overflow-hidden p-0 sm:p-0 gap-0">
          <DialogHeader className="sr-only">
            <DialogTitle>{name || (task ? 'Task detail' : 'Loading task')}</DialogTitle>
          </DialogHeader>

          {/* Custom Header */}
          <div className="flex items-center justify-between px-5 sm:px-6 pt-5 pb-0 shrink-0">
            <div className="flex items-center gap-2 min-w-0">
              {saving && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />}
            </div>
            <div className="flex items-center gap-2">
              {task && (
                <Button
                  size="sm"
                  variant={aiViewOpen ? 'default' : 'outline'}
                  className="h-8 gap-1.5 text-xs"
                  onClick={() => setAiViewOpen((v) => !v)}
                >
                  <Bot className="h-3.5 w-3.5" />
                  AI View
                </Button>
              )}
            </div>
          </div>

          <div className="overflow-y-auto px-5 sm:px-6 py-5">
            {loading && (
              <div className="flex items-center justify-center h-40">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {!loading && task && (
              <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
                {/* Main Column */}
                <div className="lg:col-span-3 space-y-5">
                  {/* Task Name */}
                  <Input
                    className="text-lg font-semibold border-0 shadow-none p-0 h-auto focus-visible:ring-0 resize-none bg-transparent placeholder:text-muted-foreground/50"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={() => name !== task.name && save({ name })}
                    placeholder="Task name..."
                  />

                  {/* Description */}
                  <SectionCard>
                    <FieldLabel>Description</FieldLabel>
                    <MarkdownEditor
                      value={description}
                      onChange={setDescription}
                      onBlur={(md) => md !== task.description && save({ description: md })}
                      placeholder="Add a description..."
                      minRows={5}
                    />
                  </SectionCard>

                  {/* Expected Deliverable */}
                  <SectionCard>
                    <FieldLabel>Expected Deliverable</FieldLabel>
                    <Input
                      className="text-sm h-9 bg-background"
                      defaultValue={task.expected_deliverable ?? ''}
                      onBlur={(e) => e.target.value !== (task.expected_deliverable ?? '') && save({ expected_deliverable: e.target.value })}
                      placeholder="What should be delivered?"
                    />
                  </SectionCard>

                  {/* Subtasks */}
                  <SectionCard>
                    <div className="flex items-center justify-between">
                      <FieldLabel>Subtasks</FieldLabel>
                      {subtasks.length > 0 && (
                        <span className="text-[11px] text-muted-foreground font-medium">
                          {subtasks.filter((s) => s.completed).length}/{subtasks.length}
                        </span>
                      )}
                    </div>
                    <div className="space-y-1">
                      {subtasks.map((sub) => (
                        <div key={sub.id} className="flex items-center gap-2.5 group py-1">
                          <button
                            onClick={() => toggleSubtask(sub)}
                            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
                          >
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
                    <div className="flex gap-2 pt-1">
                      <Input
                        className="h-8 text-xs flex-1 bg-background"
                        placeholder="Add subtask..."
                        value={newSubtaskName}
                        onChange={(e) => setNewSubtaskName(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && addSubtask()}
                      />
                      <Button size="sm" variant="outline" className="h-8 px-2.5" onClick={addSubtask} disabled={addingSubtask || !newSubtaskName.trim()}>
                        {addingSubtask ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                      </Button>
                    </div>
                  </SectionCard>
                </div>

                {/* Sidebar Column */}
                <div className="lg:col-span-2 space-y-4">
                  {/* Properties */}
                  <SectionCard className="space-y-3.5">
                    <FieldLabel>Properties</FieldLabel>

                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Step</Label>
                      <Select
                        value={task.step}
                        onValueChange={(v) => save({ step: v as ProjectTaskStep })}
                      >
                        <SelectTrigger className="h-8 text-xs w-full bg-background">
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
                      <Label className="text-[11px] text-muted-foreground">Priority</Label>
                      <Select
                        value={task.priority}
                        onValueChange={(v) => save({ priority: v as TaskPriority })}
                      >
                        <SelectTrigger className="h-8 text-xs w-full bg-background">
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
                      <Label className="text-[11px] text-muted-foreground">Validation</Label>
                      <Select
                        value={task.validation_status}
                        onValueChange={(v) => setTaskValidationStatus(task.id, projectId, v as ProjectValidationStatus).then(() => save({}))}
                      >
                        <SelectTrigger className={cn('h-8 text-xs w-full bg-background', VALIDATION_COLORS[task.validation_status])}>
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

                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Assignee</Label>
                      <AssigneePicker
                        taskId={task.id}
                        projectId={projectId}
                        current={task.assignee}
                        onChange={() => { onRefresh(); getTask(task.id).then((t) => t && setTask(t)) }}
                      />
                    </div>
                  </SectionCard>

                  {/* Dates */}
                  <SectionCard className="space-y-3.5">
                    <FieldLabel>Dates</FieldLabel>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">Start</Label>
                      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                        <Input
                          type="date"
                          className="h-9 rounded-lg text-xs w-full bg-background"
                          value={task.start_date ?? ''}
                          onChange={(e) => {
                            const startDate = e.target.value || null
                            void save({
                              start_date: startDate,
                              start_time: startDate ? (task.start_time ?? DEFAULT_START_TIME) : null,
                            })
                          }}
                        />
                        <Select
                          value={toHHMM(task.start_time) || DEFAULT_START_TIME}
                          onValueChange={(value) => save({ start_time: value })}
                          disabled={!task.start_date}
                        >
                          <SelectTrigger className="h-9 rounded-lg text-xs w-full bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TIME_OPTIONS.map((time) => (
                              <SelectItem key={time} value={time} className="text-xs">
                                {time}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px] text-muted-foreground">End</Label>
                      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                        <Input
                          type="date"
                          className="h-9 rounded-lg text-xs w-full bg-background"
                          value={task.end_date ?? ''}
                          onChange={(e) => {
                            const endDate = e.target.value || null
                            void save({
                              end_date: endDate,
                              end_time: endDate ? (task.end_time ?? DEFAULT_END_TIME) : null,
                            })
                          }}
                        />
                        <Select
                          value={toHHMM(task.end_time) || DEFAULT_END_TIME}
                          onValueChange={(value) => save({ end_time: value })}
                          disabled={!task.end_date}
                        >
                          <SelectTrigger className="h-9 rounded-lg text-xs w-full bg-background">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {TIME_OPTIONS.map((time) => (
                              <SelectItem key={time} value={time} className="text-xs">
                                {time}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </SectionCard>

                  {/* Execution Runs */}
                  <SectionCard>
                    <ExecutionRunsPanel taskId={task.id} projectId={projectId} />
                  </SectionCard>

                  {/* Delete */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive hover:bg-destructive/10 w-full h-9"
                    onClick={handleDelete}
                  >
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete Task
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* AI View Drawer */}
      <Sheet open={aiViewOpen && !!task} onOpenChange={setAiViewOpen}>
        <SheetContent side="right" className="w-[400px] sm:w-[460px] p-0">
          <SheetHeader className="px-5 pt-5 pb-3">
            <SheetTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4 text-purple-500" />
              AI View
            </SheetTitle>
          </SheetHeader>
          <div className="px-5 pb-6 overflow-y-auto h-[calc(100%-60px)]">
            {task && <AiViewPanel task={task} projectId={projectId} onSave={save} />}
          </div>
        </SheetContent>
      </Sheet>
    </>
  )
}

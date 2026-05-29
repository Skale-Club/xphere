'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { format, isPast, parseISO } from 'date-fns'
import { Plus, CheckCircle2, Circle, AlertCircle, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { TaskSlideOver } from './task-slide-over'
import { toggleTaskDone, deleteTask } from '@/app/(dashboard)/tasks/actions'
import type { TaskRow } from '@/app/(dashboard)/tasks/actions'
import type { CrmEntityType, TaskPriority, TaskStatus } from '@/types/database'
import { cn } from '@/lib/utils'

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  low: 'bg-zinc-500/15 text-zinc-400',
  medium: 'bg-blue-500/15 text-blue-400',
  high: 'bg-orange-500/15 text-orange-400',
  urgent: 'bg-red-500/15 text-red-400',
}

const STATUS_COLORS: Record<TaskStatus, string> = {
  todo: 'bg-zinc-500/15 text-zinc-400',
  in_progress: 'bg-blue-500/15 text-blue-400',
  done: 'bg-emerald-500/15 text-emerald-400',
  cancelled: 'bg-zinc-500/10 text-zinc-600',
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
}

const PRIORITY_LABELS: Record<TaskPriority, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

function isOverdue(task: TaskRow): boolean {
  if (!task.due_date) return false
  if (task.status === 'done' || task.status === 'cancelled') return false
  return isPast(parseISO(task.due_date + 'T23:59:59'))
}

interface TasksTableProps {
  tasks: TaskRow[]
  prefill?: { entity_type?: CrmEntityType; entity_id?: string }
  compact?: boolean
}

export function TasksTable({ tasks, prefill, compact }: TasksTableProps) {
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const [editingTask, setEditingTask] = useState<TaskRow | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleEdit(task: TaskRow) {
    setEditingTask(task)
    setIsOpen(true)
  }

  function handleNew() {
    setEditingTask(null)
    setIsOpen(true)
  }

  function handleToggle(id: string) {
    startTransition(async () => {
      const result = await toggleTaskDone(id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleDelete(id: string) {
    startTransition(async () => {
      const result = await deleteTask(id)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Task deleted')
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button size="sm" onClick={handleNew} className="gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          New Task
        </Button>
      </div>

      {tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No tasks yet. Create one to get started.
        </div>
      ) : (
        <div className="rounded-md border border-border overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow className="bg-[#111113] hover:bg-[#111113]">
                <TableHead className="w-8" />
                <TableHead>Task</TableHead>
                {!compact && <TableHead>Priority</TableHead>}
                <TableHead>Status</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {tasks.map((task) => {
                const overdue = isOverdue(task)
                const done = task.status === 'done'
                return (
                  <TableRow
                    key={task.id}
                    className={cn('group', done && 'opacity-60')}
                  >
                    <TableCell>
                      <button
                        onClick={() => handleToggle(task.id)}
                        disabled={isPending}
                        className="text-muted-foreground hover:text-emerald-400 transition-colors"
                        aria-label={done ? 'Mark todo' : 'Mark done'}
                      >
                        {done ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                        ) : (
                          <Circle className="h-4 w-4" />
                        )}
                      </button>
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className={cn(done && 'line-through text-muted-foreground')}>
                        {task.title}
                      </span>
                    </TableCell>
                    {!compact && (
                      <TableCell>
                        <Badge variant="secondary" className={cn('text-[11px]', PRIORITY_COLORS[task.priority])}>
                          {PRIORITY_LABELS[task.priority]}
                        </Badge>
                      </TableCell>
                    )}
                    <TableCell>
                      <Badge variant="secondary" className={cn('text-[11px]', STATUS_COLORS[task.status])}>
                        {STATUS_LABELS[task.status]}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {task.due_date ? (
                        <span className={cn('text-xs tabular-nums', overdue ? 'text-red-400 font-medium' : 'text-muted-foreground')}>
                          {overdue && <AlertCircle className="inline h-3 w-3 mr-1" />}
                          {format(parseISO(task.due_date), 'MMM d, yyyy')}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => handleEdit(task)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-red-400 hover:text-red-300"
                          onClick={() => handleDelete(task.id)}
                          disabled={isPending}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <TaskSlideOver
        open={isOpen}
        onOpenChange={setIsOpen}
        task={editingTask}
        prefill={prefill}
      />
    </div>
  )
}

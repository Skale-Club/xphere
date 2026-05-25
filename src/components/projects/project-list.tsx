'use client'

import * as React from 'react'
import { Plus, ChevronRight, CheckCircle2, Circle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { NewTaskDialog } from './new-task-dialog'
import { TaskAssigneeAvatar } from './task-assignee-avatar'
import { updateTask } from '@/app/(dashboard)/projects/actions'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'
import type { ProjectTaskStep } from '@/types/database'
import { toast } from 'sonner'

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'bg-red-500/10 text-red-600 border-red-500/20',
  high: 'bg-orange-500/10 text-orange-600 border-orange-500/20',
  medium: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/20',
  low: 'bg-green-500/10 text-green-600 border-green-500/20',
}

const STEP_LABELS: Record<ProjectTaskStep, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  doing: 'Doing',
  done: 'Done',
}

const STEP_ORDER: ProjectTaskStep[] = ['backlog', 'todo', 'doing', 'done']

interface Props {
  projectId: string
  tasks: TaskWithLabels[]
  onOpenTask: (id: string) => void
  onRefresh: () => void
}

export function ProjectList({ projectId, tasks, onOpenTask, onRefresh }: Props) {
  const groupedTasks = React.useMemo(() => {
    const map = new Map<ProjectTaskStep, TaskWithLabels[]>()
    for (const s of STEP_ORDER) map.set(s, [])
    for (const t of tasks) map.get(t.step)?.push(t)
    return map
  }, [tasks])

  async function toggleComplete(task: TaskWithLabels) {
    try {
      const completed = !task.completed
      await updateTask(task.id, projectId, {
        completed,
        completed_at: completed ? new Date().toISOString() : null,
        step: completed ? 'done' : task.step === 'done' ? 'todo' : task.step,
      })
      onRefresh()
    } catch {
      toast.error('Failed to update task')
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
        <p className="text-sm text-muted-foreground">No tasks yet</p>
        <NewTaskDialog projectId={projectId} onCreated={onRefresh}>
          <Button size="sm" variant="outline">
            <Plus className="h-4 w-4 mr-1.5" />
            Add task
          </Button>
        </NewTaskDialog>
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div className="border-b border-border-subtle pb-2 mb-1 flex items-center justify-end pr-2">
        <NewTaskDialog projectId={projectId} onCreated={onRefresh}>
          <Button size="sm" variant="outline" className="h-7 text-xs">
            <Plus className="h-3.5 w-3.5 mr-1" />
            Add task
          </Button>
        </NewTaskDialog>
      </div>

      {STEP_ORDER.map((step) => {
        const stepTasks = groupedTasks.get(step) ?? []
        if (stepTasks.length === 0) return null
        return (
          <div key={step}>
            <div className="flex items-center gap-2 py-2 px-2 mt-2 first:mt-0 border-b border-border-subtle sticky top-0 bg-background z-[1]">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {STEP_LABELS[step]}
              </span>
              <span className="text-[10px] text-muted-foreground tabular-nums">{stepTasks.length}</span>
            </div>
            {stepTasks.map((task) => (
              <div
                key={task.id}
                className={cn(
                  'group flex items-start gap-3 px-2 sm:px-3 py-3 rounded-lg hover:bg-accent/5 active:bg-accent/10 transition-colors cursor-pointer border border-transparent hover:border-border-subtle',
                  task.completed && 'opacity-60'
                )}
              >
                <button
                  onClick={(e) => { e.stopPropagation(); toggleComplete(task) }}
                  className="flex items-center justify-center min-w-[36px] min-h-[36px] -m-1 rounded-md text-muted-foreground hover:text-foreground transition-colors shrink-0"
                >
                  {task.completed
                    ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                    : <Circle className="h-4 w-4" />
                  }
                </button>

                <div className="flex-1 min-w-0" onClick={() => onOpenTask(task.id)}>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={cn('text-sm', task.completed && 'line-through text-muted-foreground')}>
                      {task.name}
                    </span>
                    <Badge variant="outline" className={cn('text-[10px] h-4 px-1.5 py-0 font-medium', PRIORITY_BADGE[task.priority])}>
                      {task.priority}
                    </Badge>
                    {task.labels.map((l) => (
                      <span
                        key={l.id}
                        className="inline-flex items-center rounded-full px-1.5 py-0 text-[10px] font-medium"
                        style={{ backgroundColor: l.color + '22', color: l.color }}
                      >
                        {l.name}
                      </span>
                    ))}
                  </div>

                  {task.end_date && (
                    <p className={cn(
                      'text-[11px] text-muted-foreground mt-0.5',
                      new Date(task.end_date) < new Date() && !task.completed && 'text-red-500'
                    )}>
                      Due {new Date(task.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </p>
                  )}
                </div>

                {task.assignee && (
                  <TaskAssigneeAvatar
                    size="xs"
                    name={task.assignee.full_name}
                    email={task.assignee.email}
                    className="shrink-0 mt-0.5"
                  />
                )}

                {task.subtask_count > 0 && (
                  <span className="text-[11px] text-muted-foreground mt-0.5 shrink-0">
                    {task.completed_subtask_count}/{task.subtask_count}
                  </span>
                )}

                <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity mt-0.5 shrink-0" />
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

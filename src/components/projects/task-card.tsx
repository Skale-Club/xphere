'use client'

import * as React from 'react'
import { Bot, CalendarDays, ListChecks } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { TaskAssigneeAvatar } from './task-assignee-avatar'
import { formatEmailDisplay } from '@/lib/email-addresses/format'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
}

const PRIORITY_BADGE: Record<string, string> = {
  urgent: 'border-red-500/30 bg-red-500/10 text-red-500',
  high: 'border-orange-500/30 bg-orange-500/10 text-orange-500',
  medium: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-500',
  low: 'border-green-500/30 bg-green-500/10 text-green-500',
}

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

interface Props {
  task: TaskWithLabels
  onClick: () => void
}

function formatDate(date: string) {
  return parseDateOnly(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function parseDateOnly(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  if (!year || !month || !day) return new Date(date)
  return new Date(year, month - 1, day)
}

function dateLabel(task: TaskWithLabels) {
  if (task.start_date && task.end_date) {
    return `${formatDate(task.start_date)} - ${formatDate(task.end_date)}`
  }
  if (task.start_date) return `Starts ${formatDate(task.start_date)}`
  if (task.end_date) return `Due ${formatDate(task.end_date)}`
  return null
}

export function TaskCard({ task, onClick }: Props) {
  const responsible = task.responsible ?? task.assignee
  const responsibleName = responsible
    ? responsible.full_name ?? formatEmailDisplay(responsible.email)
    : null
  const taskDateLabel = dateLabel(task)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const isOverdue = !!task.end_date && parseDateOnly(task.end_date) < today && !task.completed

  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative rounded-[10px] border bg-background p-3 shadow-sm cursor-pointer',
        'hover:border-accent/50 hover:shadow-md transition-all',
        task.completed && 'opacity-60'
      )}
    >
      <div className="flex items-stretch gap-2.5">
        <div className={cn('w-1 self-stretch rounded-full shrink-0', PRIORITY_COLORS[task.priority])} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={cn('min-w-0 text-sm font-medium leading-snug', task.completed && 'line-through text-muted-foreground')}>
              {task.name}
            </p>
            <Badge
              variant="outline"
              className={cn(
                'h-5 shrink-0 px-1.5 py-0 text-[10px] font-medium leading-none',
                PRIORITY_BADGE[task.priority],
              )}
            >
              {PRIORITY_LABELS[task.priority] ?? task.priority}
            </Badge>
          </div>

          {task.labels.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
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
          )}

          {(taskDateLabel || responsibleName) && (
            <div className="mt-2 grid gap-1 text-[11px] text-muted-foreground">
              {taskDateLabel && (
                <span
                  className={cn(
                    'inline-flex min-w-0 items-center gap-1',
                    isOverdue && 'font-medium text-red-500',
                  )}
                >
                  <CalendarDays className="h-3 w-3 shrink-0" />
                  <span className="truncate">{taskDateLabel}</span>
                </span>
              )}
              {responsible && responsibleName && (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <TaskAssigneeAvatar
                    size="xs"
                    name={responsible.full_name}
                    email={responsible.email}
                    className="shrink-0"
                  />
                  <span className="truncate">{responsibleName}</span>
                </span>
              )}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2 text-[11px] text-muted-foreground">
            {task.subtask_count > 0 && (
              <span className="flex items-center gap-0.5">
                <ListChecks className="h-3 w-3" />
                {task.completed_subtask_count}/{task.subtask_count}
              </span>
            )}
            {task.ai_view_enabled && (
              <Bot className="h-3 w-3" />
            )}
            {task.needs_validation && (
              <Badge variant="outline" className="h-4 text-[10px] px-1 py-0 border-yellow-500/50 text-yellow-600">
                Needs review
              </Badge>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

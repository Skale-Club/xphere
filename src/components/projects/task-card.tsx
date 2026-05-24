'use client'

import * as React from 'react'
import { CheckCircle2, Circle, MessageSquare, Paperclip, ListChecks, Bot } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import type { TaskWithLabels } from '@/app/(dashboard)/projects/actions'

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
}

interface Props {
  task: TaskWithLabels
  onClick: () => void
  dragHandle?: React.ReactNode
}

export function TaskCard({ task, onClick, dragHandle }: Props) {
  return (
    <div
      onClick={onClick}
      className={cn(
        'group relative rounded-[10px] border bg-background p-3 shadow-sm cursor-pointer',
        'hover:border-accent/50 hover:shadow-md transition-all',
        task.completed && 'opacity-60'
      )}
    >
      {dragHandle && (
        <div className="absolute right-2 top-2 opacity-30 sm:opacity-0 sm:group-hover:opacity-50 transition-opacity">
          {dragHandle}
        </div>
      )}

      <div className="flex items-stretch gap-2.5">
        <div className={cn('w-1 self-stretch rounded-full shrink-0', PRIORITY_COLORS[task.priority])} />
        <div className="min-w-0 flex-1">
          <p className={cn('text-sm font-medium leading-snug', task.completed && 'line-through text-muted-foreground')}>
            {task.name}
          </p>

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
            {task.end_date && (
              <span className={cn(
                'ml-auto',
                new Date(task.end_date) < new Date() && !task.completed && 'text-red-500'
              )}>
                {new Date(task.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

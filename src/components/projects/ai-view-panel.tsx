'use client'

import * as React from 'react'
import { Bot, AlertTriangle, CheckCircle2, Clock, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { getTaskDependencies, getExecutionRuns, updateTask } from '@/app/(dashboard)/projects/actions'
import type { TaskWithLabels, TaskDependency } from '@/app/(dashboard)/projects/actions'
import type { ProjectExecutionRunRow } from '@/types/database'

const MCP_ACTIONS = [
  'get_task', 'list_execution_runs',
  'update_task', 'add_comment',
  'create_execution_run', 'update_execution_run', 'update_validation_status',
]

function suggestNextAction(task: TaskWithLabels, blocked: boolean): string {
  if (blocked) return 'Resolve blocking dependencies before proceeding.'
  if (task.completed) return 'Task is complete. Request validation if needed.'
  if (task.validation_status === 'needs_review') return 'Awaiting human review. No action needed.'
  if (task.validation_status === 'changes_requested') return 'Changes were requested. Rework and update execution run.'
  if (task.execution_status === 'in_progress') return 'Run is active. Update execution_run when done, then set validation if needed.'
  if (task.step === 'done') return 'Mark completed or submit for validation via update_validation_status.'
  if (task.step === 'doing') return 'Create an execution run, do the work, then move to done.'
  if (task.step === 'todo') return 'Move step to "doing" and start an execution run.'
  return 'Move to "todo" to begin work.'
}

interface Props {
  task: TaskWithLabels
  projectId: string
  onSave: (patch: Partial<TaskWithLabels>) => void
}

export function AiViewPanel({ task, projectId, onSave }: Props) {
  const [deps, setDeps] = React.useState<TaskDependency[]>([])
  const [runs, setRuns] = React.useState<ProjectExecutionRunRow[]>([])
  const [loading, setLoading] = React.useState(true)

  React.useEffect(() => {
    setLoading(true)
    Promise.all([getTaskDependencies(task.id), getExecutionRuns(task.id)])
      .then(([d, r]) => { setDeps(d); setRuns(r) })
      .finally(() => setLoading(false))
  }, [task.id])

  const blockedDeps = deps.filter((d) => d.is_blocking)
  const isBlocked = blockedDeps.length > 0
  const recentRuns = runs.filter((r) => r.status !== 'running').slice(0, 3)

  return (
    <div className="space-y-5">
      {loading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading AI context...
        </div>
      )}

      {/* Suggested next action */}
      <div className="rounded-lg bg-purple-500/8 border border-purple-500/20 px-3 py-2.5 text-xs text-purple-700 dark:text-purple-300">
        <span className="font-semibold">Suggested: </span>
        {suggestNextAction(task, isBlocked)}
      </div>

      {/* Context */}
      <div className="space-y-1.5">
        <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
          AI Context
        </Label>
        <Textarea
          defaultValue={task.ai_context ?? ''}
          onBlur={(e) => e.target.value !== (task.ai_context ?? '') && onSave({ ai_context: e.target.value })}
          placeholder="Context for AI agents..."
          rows={3}
          className="text-xs resize-none bg-background"
        />
      </div>

      {/* Expected deliverable & validation criteria */}
      <div className="space-y-3">
        {task.expected_deliverable && (
          <div className="space-y-1">
            <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
              Expected Deliverable
            </Label>
            <p className="text-xs text-foreground/80 bg-background border border-input rounded-md px-2.5 py-2">
              {task.expected_deliverable}
            </p>
          </div>
        )}
        <div className="space-y-1.5">
          <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
            Validation Criteria
          </Label>
          <Textarea
            defaultValue={task.validation_criteria ?? ''}
            onBlur={(e) => e.target.value !== (task.validation_criteria ?? '') && onSave({ validation_criteria: e.target.value })}
            placeholder="How to validate this task is done..."
            rows={2}
            className="text-xs resize-none bg-background"
          />
        </div>
      </div>

      {/* Dependencies */}
      {deps.length > 0 && (
        <div className="space-y-2">
          <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
            Dependencies
          </Label>
          <div className="space-y-1.5">
            {deps.map((d) => (
              <div key={d.depends_on_id} className={cn(
                'flex items-center justify-between text-xs px-2.5 py-2 rounded-md border',
                d.is_blocking ? 'border-orange-500/30 bg-orange-500/5' : 'border-green-500/30 bg-green-500/5'
              )}>
                <span className="flex items-center gap-1.5">
                  {d.is_blocking
                    ? <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0" />
                    : <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                  }
                  <span className={cn('truncate max-w-[180px]', d.is_blocking ? 'text-orange-700 dark:text-orange-300' : 'text-green-700 dark:text-green-300')}>
                    {d.depends_on_name}
                  </span>
                </span>
                <Badge variant="outline" className="text-[10px] px-1 py-0 capitalize shrink-0">
                  {d.dependency_rule.replace(/_/g, ' ')}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Allowed MCP actions */}
      <div className="space-y-2">
        <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
          Allowed MCP Actions
        </Label>
        <div className="flex flex-wrap gap-1">
          {MCP_ACTIONS.map((a) => (
            <code key={a} className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded font-mono">{a}</code>
          ))}
        </div>
      </div>

      {/* Recent execution runs */}
      {recentRuns.length > 0 && (
        <div className="space-y-2">
          <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
            Recent Execution History
          </Label>
          <div className="space-y-1">
            {recentRuns.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-xs py-1.5 border-b border-border-subtle last:border-0">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <Clock className="h-3 w-3 shrink-0" />
                  <span className="truncate max-w-[160px]">{r.executor_name ?? r.executor_type}</span>
                  <span className={cn(
                    'capitalize px-1 rounded text-[10px]',
                    r.status === 'delivered' ? 'bg-green-500/10 text-green-600' :
                    r.status === 'failed' ? 'bg-red-500/10 text-red-600' :
                    'bg-muted text-muted-foreground'
                  )}>{r.status}</span>
                </span>
                <span className="text-muted-foreground shrink-0">
                  {r.duration_minutes ? `${Math.round(r.duration_minutes)}m` : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status grid */}
      <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
        <div>
          <p className="font-medium text-foreground/70 mb-0.5">Execution Status</p>
          <p className="capitalize">{task.execution_status.replace(/_/g, ' ')}</p>
        </div>
        <div>
          <p className="font-medium text-foreground/70 mb-0.5">Validation Status</p>
          <p className="capitalize">{task.validation_status.replace(/_/g, ' ')}</p>
        </div>
        {task.last_agent_update && (
          <div className="col-span-2">
            <p className="font-medium text-foreground/70 mb-0.5">Last Agent Update</p>
            <p>{new Date(task.last_agent_update).toLocaleString()}</p>
          </div>
        )}
      </div>
    </div>
  )
}

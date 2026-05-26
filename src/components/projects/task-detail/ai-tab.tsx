'use client'

// AiTab | dedicated tab containing AI context, validation criteria,
// dependencies and the MCP allowlist. Migrated from the legacy
// AiViewPanel (which used to open as a separate Sheet on top of the
// task Dialog, a confusing layering).

import * as React from 'react'
import { Bot, AlertTriangle, CheckCircle2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Badge } from '@/components/ui/badge'
import { getTaskDependencies } from '@/app/(dashboard)/projects/actions'
import type { TaskWithLabels, TaskDependency } from '@/app/(dashboard)/projects/actions'

const MCP_ACTIONS = [
  'get_task',
  'list_execution_runs',
  'update_task',
  'add_comment',
  'create_execution_run',
  'update_execution_run',
  'update_validation_status',
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
  onSaveAiContext: (next: string) => void
  onSaveValidationCriteria: (next: string) => void
}

export function AiTab({ task, onSaveAiContext, onSaveValidationCriteria }: Props) {
  const [deps, setDeps] = React.useState<TaskDependency[]>([])
  const [loading, setLoading] = React.useState(true)
  const [aiContext, setAiContext] = React.useState(task.ai_context ?? '')
  const [criteria, setCriteria] = React.useState(task.validation_criteria ?? '')

  // Cancel-token pattern: stale task fetches don't apply when user switches.
  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    getTaskDependencies(task.id)
      .then((d) => {
        if (!cancelled) setDeps(d)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [task.id])

  React.useEffect(() => {
    setAiContext(task.ai_context ?? '')
    setCriteria(task.validation_criteria ?? '')
  }, [task.id, task.ai_context, task.validation_criteria])

  const blockedDeps = deps.filter((d) => d.is_blocking)
  const isBlocked = blockedDeps.length > 0

  return (
    <div className="space-y-5">
      {/* Suggested next action */}
      <div className="rounded-lg bg-accent/[0.08] border border-accent/20 px-3.5 py-2.5 text-[12.5px] text-accent flex items-start gap-2">
        <Bot className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>
          <span className="font-semibold">Suggested: </span>
          {suggestNextAction(task, isBlocked)}
        </span>
      </div>

      <section className="space-y-1.5">
        <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
          AI Context
        </Label>
        <Textarea
          value={aiContext}
          onChange={(e) => setAiContext(e.target.value)}
          onBlur={(e) => {
            const next = e.target.value
            if (next !== (task.ai_context ?? '')) onSaveAiContext(next)
          }}
          placeholder="Context for AI agents — what they need to know to work on this task…"
          rows={3}
          className="text-[13px] resize-none"
        />
      </section>

      <section className="space-y-1.5">
        <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
          Validation Criteria
        </Label>
        <Textarea
          value={criteria}
          onChange={(e) => setCriteria(e.target.value)}
          onBlur={(e) => {
            const next = e.target.value
            if (next !== (task.validation_criteria ?? '')) onSaveValidationCriteria(next)
          }}
          placeholder="How to validate this task is done…"
          rows={2}
          className="text-[13px] resize-none"
        />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
            Dependencies
          </Label>
          {loading && <Loader2 className="h-3 w-3 animate-spin text-text-tertiary" />}
        </div>
        {!loading && deps.length === 0 && (
          <p className="text-[12px] text-text-tertiary italic">No dependencies.</p>
        )}
        {deps.length > 0 && (
          <div className="space-y-1.5">
            {deps.map((d) => (
              <div
                key={d.depends_on_id}
                className={cn(
                  'flex items-center justify-between text-[12px] px-2.5 py-1.5 rounded-md border',
                  d.is_blocking
                    ? 'border-orange-500/30 bg-orange-500/5'
                    : 'border-green-500/30 bg-green-500/5',
                )}
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  {d.is_blocking ? (
                    <AlertTriangle className="h-3 w-3 text-orange-500 shrink-0" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 text-green-500 shrink-0" />
                  )}
                  <span
                    className={cn(
                      'truncate',
                      d.is_blocking
                        ? 'text-orange-700 dark:text-orange-300'
                        : 'text-green-700 dark:text-green-300',
                    )}
                  >
                    {d.depends_on_name}
                  </span>
                </span>
                <Badge variant="outline" className="text-[10px] px-1 py-0 capitalize shrink-0">
                  {d.dependency_rule.replace(/_/g, ' ')}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <Label className="text-[11px] font-medium uppercase tracking-wider text-text-tertiary">
          Allowed MCP Actions
        </Label>
        <div className="flex flex-wrap gap-1">
          {MCP_ACTIONS.map((a) => (
            <code
              key={a}
              className="text-[10.5px] bg-bg-tertiary/60 text-text-secondary px-1.5 py-0.5 rounded font-mono"
            >
              {a}
            </code>
          ))}
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3 text-[12px] text-text-tertiary">
        <div>
          <p className="font-medium text-text-secondary mb-0.5">Execution Status</p>
          <p className="capitalize">{task.execution_status.replace(/_/g, ' ')}</p>
        </div>
        <div>
          <p className="font-medium text-text-secondary mb-0.5">Validation Status</p>
          <p className="capitalize">{task.validation_status.replace(/_/g, ' ')}</p>
        </div>
        {task.last_agent_update && (
          <div className="col-span-2">
            <p className="font-medium text-text-secondary mb-0.5">Last Agent Update</p>
            <p>{new Date(task.last_agent_update).toLocaleString()}</p>
          </div>
        )}
      </section>
    </div>
  )
}

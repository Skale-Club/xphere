'use client'

import * as React from 'react'
import { Play, Square, Clock, Bot, User, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { getExecutionRuns, startRun, stopRun } from '@/app/(dashboard)/projects/actions'
import type { ProjectExecutionRunRow } from '@/types/database'

interface Props {
  taskId: string
  projectId: string
}

function formatDuration(minutes: number | null): string {
  if (!minutes) return '0m'
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function useElapsed(startTime: string | null): string {
  const [elapsed, setElapsed] = React.useState('')

  React.useEffect(() => {
    if (!startTime) { setElapsed(''); return }
    const update = () => {
      const diff = (Date.now() - new Date(startTime).getTime()) / 1000
      const h = Math.floor(diff / 3600)
      const m = Math.floor((diff % 3600) / 60)
      const s = Math.floor(diff % 60)
      setElapsed(h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`)
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [startTime])

  return elapsed
}

export function ExecutionRunsPanel({ taskId, projectId }: Props) {
  const [runs, setRuns] = React.useState<ProjectExecutionRunRow[]>([])
  const [loading, setLoading] = React.useState(true)
  const [acting, setActing] = React.useState(false)

  const activeRun = runs.find((r) => r.status === 'running') ?? null
  const elapsed = useElapsed(activeRun?.start_time ?? null)

  React.useEffect(() => {
    setLoading(true)
    getExecutionRuns(taskId)
      .then(setRuns)
      .finally(() => setLoading(false))
  }, [taskId])

  async function handleStart() {
    setActing(true)
    try {
      const run = await startRun(taskId, projectId)
      if (run) setRuns((prev) => [run, ...prev])
    } catch {
      toast.error('Failed to start timer')
    } finally {
      setActing(false)
    }
  }

  async function handleStop() {
    if (!activeRun) return
    setActing(true)
    try {
      await stopRun(activeRun.id, taskId, projectId)
      const updated = await getExecutionRuns(taskId)
      setRuns(updated)
    } catch {
      toast.error('Failed to stop timer')
    } finally {
      setActing(false)
    }
  }

  const completedRuns = runs.filter((r) => r.status !== 'running')
  const totalHuman = completedRuns
    .filter((r) => r.executor_type === 'human')
    .reduce((s, r) => s + (r.duration_minutes ?? 0), 0)
  const totalAI = completedRuns
    .filter((r) => r.executor_type !== 'human')
    .reduce((s, r) => s + (r.duration_minutes ?? 0), 0)

  return (
    <div className="space-y-3">
      <Label className="text-xs text-muted-foreground">Execution Runs</Label>

      {/* Timer control */}
      <div className="flex items-center gap-3">
        {activeRun ? (
          <>
            <div className="flex items-center gap-1.5 text-sm font-mono text-foreground min-w-[4rem]">
              <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse shrink-0" />
              {elapsed}
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2.5 text-xs"
              onClick={handleStop}
              disabled={acting}
            >
              {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3 mr-1" />}
              Stop
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2.5 text-xs"
            onClick={handleStart}
            disabled={acting || loading}
          >
            {acting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3 mr-1" />}
            Start timer
          </Button>
        )}
      </div>

      {/* Summary */}
      {(totalHuman > 0 || totalAI > 0) && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          {totalHuman > 0 && (
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" />
              {formatDuration(totalHuman)}
            </span>
          )}
          {totalAI > 0 && (
            <span className="flex items-center gap-1">
              <Bot className="h-3 w-3" />
              {formatDuration(totalAI)}
            </span>
          )}
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {formatDuration(totalHuman + totalAI)} total
          </span>
        </div>
      )}

      {/* Run history */}
      {!loading && completedRuns.length > 0 && (
        <div className="space-y-1">
          {completedRuns.slice(0, 5).map((run) => (
            <div key={run.id} className="flex items-center justify-between text-xs py-1 border-b border-border-subtle last:border-0">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                {run.executor_type === 'human'
                  ? <User className="h-3 w-3 shrink-0" />
                  : <Bot className="h-3 w-3 shrink-0 text-purple-500" />
                }
                <span className="truncate max-w-[120px]">{run.executor_name ?? run.executor_type}</span>
                <span className={cn(
                  'capitalize px-1 rounded text-[10px]',
                  run.status === 'delivered' ? 'bg-green-500/10 text-green-600' :
                  run.status === 'failed' ? 'bg-red-500/10 text-red-600' :
                  'bg-muted text-muted-foreground'
                )}>
                  {run.status}
                </span>
              </div>
              <span className="text-muted-foreground shrink-0">{formatDuration(run.duration_minutes)}</span>
            </div>
          ))}
        </div>
      )}

      {loading && (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
    </div>
  )
}

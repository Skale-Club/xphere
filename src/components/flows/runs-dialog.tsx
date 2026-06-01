'use client'

/**
 * RunsDialog — the whole "Runs" ecosystem (list of runs + a single run's detail
 * with its step timeline) inside one modal, launched from the flow editor's
 * "Runs" button. No page navigation: clicking a run swaps the dialog to the
 * detail view; a Back button returns to the list.
 */

import { useCallback, useEffect, useState } from 'react'
import { format, formatDistanceToNow, parseISO } from 'date-fns'
import {
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
  SkipForward,
  RefreshCw,
} from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import {
  listWorkflowRuns,
  getWorkflowRun,
  type RunRow,
  type RunWithSteps,
} from '@/app/(dashboard)/workflows/flows/_actions/runs'

const STATUS_ICON: Record<string, React.ReactNode> = {
  succeeded: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  failed: <XCircle className="h-3.5 w-3.5 text-red-400" />,
  running: <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />,
  queued: <Clock className="h-3.5 w-3.5 text-yellow-400" />,
  pending: <Clock className="h-3.5 w-3.5 text-yellow-400" />,
  skipped: <SkipForward className="h-3.5 w-3.5 text-zinc-400" />,
  cancelled: <XCircle className="h-3.5 w-3.5 text-zinc-400" />,
}

const STATUS_BG: Record<string, string> = {
  succeeded: 'bg-emerald-500/10',
  failed: 'bg-red-500/10',
  running: 'bg-blue-500/10',
  queued: 'bg-yellow-500/10',
  cancelled: 'bg-zinc-500/10',
}

function durationOf(startedAt: string | null, endedAt: string | null): string | null {
  if (!startedAt || !endedAt) return null
  return `${Math.round((new Date(endedAt).getTime() - new Date(startedAt).getTime()) / 100) / 10}s`
}

interface RunsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  workflowName?: string
  /** When set, the dialog opens straight to this run's detail (e.g. after Run now). */
  initialRunId?: string | null
}

export function RunsDialog({ open, onOpenChange, workflowId, workflowName, initialRunId }: RunsDialogProps) {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [loadingList, setLoadingList] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)

  const loadList = useCallback(() => {
    setLoadingList(true)
    listWorkflowRuns(workflowId, 100)
      .then((res) => setRuns(res.ok ? res.data : []))
      .catch(() => setRuns([]))
      .finally(() => setLoadingList(false))
  }, [workflowId])

  useEffect(() => {
    if (!open) {
      setSelectedRunId(null)
      return
    }
    setSelectedRunId(initialRunId ?? null)
    loadList()
  }, [open, initialRunId, loadList])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        {selectedRunId ? (
          <RunDetail runId={selectedRunId} onBack={() => setSelectedRunId(null)} />
        ) : (
          <>
            <DialogHeader>
              <div className="flex items-center justify-between gap-2 pr-6">
                <div>
                  <DialogTitle>Runs</DialogTitle>
                  <DialogDescription>{workflowName ?? 'Execution history for this workflow.'}</DialogDescription>
                </div>
                <Button variant="ghost" size="icon" onClick={loadList} disabled={loadingList} title="Refresh">
                  <RefreshCw className={cn('h-4 w-4', loadingList && 'animate-spin')} />
                </Button>
              </div>
            </DialogHeader>

            {loadingList && runs.length === 0 ? (
              <div className="flex items-center justify-center py-12 text-text-tertiary">
                <Loader2 className="h-4 w-4 animate-spin" />
              </div>
            ) : runs.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                No runs yet. Click &quot;Run now&quot; to execute manually.
              </div>
            ) : (
              <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
                {runs.map((run) => {
                  const duration = durationOf(run.started_at, run.ended_at)
                  return (
                    <button
                      key={run.id}
                      type="button"
                      onClick={() => setSelectedRunId(run.id)}
                      className={cn(
                        'flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40 transition-colors',
                        STATUS_BG[run.status] ?? '',
                      )}
                    >
                      <div className="shrink-0">{STATUS_ICON[run.status] ?? null}</div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium capitalize">{run.status}</span>
                          <Badge variant="outline" className="text-[10px]">{run.trigger_type}</Badge>
                          {run.error && <span className="text-[11px] text-red-400 truncate">{run.error}</span>}
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {formatDistanceToNow(parseISO(run.created_at), { addSuffix: true })}
                          {duration && ` · ${duration}`}
                        </p>
                      </div>
                      <code className="text-[10px] font-mono text-muted-foreground hidden sm:block">
                        {run.id.slice(0, 8)}
                      </code>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

function RunDetail({ runId, onBack }: { runId: string; onBack: () => void }) {
  const [run, setRun] = useState<RunWithSteps | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getWorkflowRun(runId)
      .then((res) => {
        if (!cancelled) setRun(res.ok ? res.data : null)
      })
      .catch(() => {
        if (!cancelled) setRun(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [runId])

  const duration = run ? durationOf(run.started_at, run.ended_at) : null

  return (
    <>
      <DialogHeader>
        <Button variant="ghost" size="sm" onClick={onBack} className="w-fit -ml-2">
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Runs
        </Button>
        <DialogTitle className="sr-only">Run detail</DialogTitle>
      </DialogHeader>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-text-tertiary">
          <Loader2 className="h-4 w-4 animate-spin" />
        </div>
      ) : !run ? (
        <div className="py-12 text-center text-sm text-muted-foreground">Run not found.</div>
      ) : (
        <div className="space-y-5">
          {/* Header */}
          <div className="rounded-lg border border-border bg-card p-4 space-y-3">
            <div className="flex items-center gap-2">
              {STATUS_ICON[run.status] ?? null}
              <span className="text-base font-semibold capitalize">{run.status}</span>
              <Badge variant="outline" className="text-[10px]">{run.trigger_type}</Badge>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <RunField label="Started" value={run.started_at ? format(parseISO(run.started_at), 'HH:mm:ss') : '-'} />
              <RunField label="Ended" value={run.ended_at ? format(parseISO(run.ended_at), 'HH:mm:ss') : '-'} />
              <RunField label="Duration" value={duration ?? '-'} />
              <RunField label="Steps" value={String(run.steps.length)} />
            </div>
            {run.error && (
              <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">
                <p className="font-medium mb-0.5">Error</p>
                <p className="font-mono break-all">{run.error}</p>
              </div>
            )}
            {Object.keys(run.trigger_payload ?? {}).length > 0 && (
              <RunCollapsible label="Trigger payload" json={run.trigger_payload} />
            )}
          </div>

          {/* Steps */}
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Steps</h3>
            {run.steps.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-8 text-center text-xs text-muted-foreground">
                No steps recorded.
              </div>
            ) : (
              <div className="space-y-2">
                {run.steps.map((step, idx) => (
                  <div
                    key={step.id}
                    className={cn(
                      'rounded-lg border bg-card overflow-hidden',
                      step.status === 'failed' ? 'border-red-500/30' : 'border-border',
                    )}
                  >
                    <div className="flex items-center gap-3 px-4 py-2.5 border-b border-border">
                      <span className="text-xs text-muted-foreground tabular-nums w-6">{idx + 1}</span>
                      {STATUS_ICON[step.status] ?? null}
                      <Badge variant="outline" className="text-[10px] capitalize">{step.node_type}</Badge>
                      <code className="text-[11px] font-mono text-muted-foreground truncate flex-1">{step.node_id}</code>
                      {step.started_at && step.ended_at && (
                        <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                          {Math.max(1, new Date(step.ended_at).getTime() - new Date(step.started_at).getTime())}ms
                        </span>
                      )}
                    </div>
                    {step.error && (
                      <div className="px-4 py-2 bg-red-500/10 text-xs text-red-300 font-mono break-all">
                        {step.error}
                      </div>
                    )}
                    <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-border">
                      <RunCollapsible label="Input" json={step.input} compact />
                      <RunCollapsible label="Output" json={step.output} compact />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  )
}

function RunField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs tabular-nums">{value}</p>
    </div>
  )
}

function RunCollapsible({ label, json, compact = false }: { label: string; json: unknown; compact?: boolean }) {
  return (
    <details className={cn(compact ? 'px-4 py-2' : 'rounded-md border border-border bg-muted/30')}>
      <summary className="text-[10px] uppercase tracking-wider text-muted-foreground cursor-pointer">
        {label}
      </summary>
      <pre className="mt-1.5 text-[10px] font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto text-foreground/80">
        {JSON.stringify(json, null, 2)}
      </pre>
    </details>
  )
}

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import { ArrowLeft, CheckCircle2, XCircle, Loader2, Clock, SkipForward } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getUser } from '@/lib/supabase/server'
import { getWorkflowRun } from '../../_actions/runs'
import { cn } from '@/lib/utils'

const STATUS_ICON: Record<string, React.ReactNode> = {
  succeeded: <CheckCircle2 className="h-4 w-4 text-emerald-400" />,
  failed:    <XCircle className="h-4 w-4 text-red-400" />,
  running:   <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />,
  pending:   <Clock className="h-4 w-4 text-yellow-400" />,
  skipped:   <SkipForward className="h-4 w-4 text-zinc-400" />,
}

export default async function RunDetailPage({
  params,
}: {
  params: Promise<{ runId: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const { runId } = await params
  const result = await getWorkflowRun(runId)
  if (!result.ok) notFound()

  const run = result.data
  const duration = run.started_at && run.ended_at
    ? `${Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 100) / 10}s`
    : null

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/workflows/flows/${run.workflow_id}/runs`}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Runs
        </Link>
      </Button>

      {/* Header */}
      <div className="rounded-lg border border-border bg-card p-5 space-y-3">
        <div className="flex items-center gap-2">
          {STATUS_ICON[run.status] ?? null}
          <h1 className="text-xl font-semibold capitalize">{run.status}</h1>
          <Badge variant="outline" className="text-[10px]">{run.trigger_type}</Badge>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
          <Field label="Started" value={run.started_at ? format(parseISO(run.started_at), 'HH:mm:ss') : '-'} />
          <Field label="Ended" value={run.ended_at ? format(parseISO(run.ended_at), 'HH:mm:ss') : '-'} />
          <Field label="Duration" value={duration ?? '-'} />
          <Field label="Steps" value={String(run.steps.length)} />
        </div>

        {run.error && (
          <div className="rounded-md bg-red-500/10 border border-red-500/30 px-3 py-2 text-xs text-red-300">
            <p className="font-medium mb-0.5">Error</p>
            <p className="font-mono break-all">{run.error}</p>
          </div>
        )}

        {Object.keys(run.trigger_payload).length > 0 && (
          <Collapsible label="Trigger payload" json={run.trigger_payload} />
        )}
      </div>

      {/* Steps */}
      <div className="space-y-2">
        <h2 className="text-sm font-medium">Steps</h2>
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
                  <Collapsible label="Input" json={step.input} compact />
                  <Collapsible label="Output" json={step.output} compact />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-xs tabular-nums">{value}</p>
    </div>
  )
}

function Collapsible({ label, json, compact = false }: { label: string; json: unknown; compact?: boolean }) {
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

import { redirect, notFound } from 'next/navigation'
import Link from 'next/link'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ArrowLeft, CheckCircle2, XCircle, Loader2, Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getUser } from '@/lib/supabase/server'
import { getWorkflow } from '../../_actions/workflows'
import { listWorkflowRuns } from '../../_actions/runs'
import { cn } from '@/lib/utils'

const STATUS_ICON: Record<string, React.ReactNode> = {
  succeeded: <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />,
  failed:    <XCircle className="h-3.5 w-3.5 text-red-400" />,
  running:   <Loader2 className="h-3.5 w-3.5 text-blue-400 animate-spin" />,
  queued:    <Clock className="h-3.5 w-3.5 text-yellow-400" />,
  cancelled: <XCircle className="h-3.5 w-3.5 text-zinc-400" />,
}

const STATUS_BG: Record<string, string> = {
  succeeded: 'bg-emerald-500/10',
  failed:    'bg-red-500/10',
  running:   'bg-blue-500/10',
  queued:    'bg-yellow-500/10',
  cancelled: 'bg-zinc-500/10',
}

export default async function WorkflowRunsPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await getUser()
  if (!user) redirect('/login')

  const { id } = await params
  const workflow = await getWorkflow(id)
  if (!workflow.ok) notFound()

  const runs = await listWorkflowRuns(id, 100)
  const rows = runs.ok ? runs.data : []

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href={`/workflows/flows/${id}`}>
          <ArrowLeft className="h-3.5 w-3.5 mr-1" /> Editor
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-semibold">{workflow.data.name}</h1>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          No runs yet. Click "Run now" in the editor to execute manually.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
          {rows.map((run) => {
            const duration = run.started_at && run.ended_at
              ? `${Math.round((new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()) / 100) / 10}s`
              : null
            return (
              <Link
                key={run.id}
                href={`/workflows/flows/runs/${run.id}`}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors',
                  STATUS_BG[run.status] ?? '',
                )}
              >
                <div className="shrink-0">{STATUS_ICON[run.status] ?? null}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium capitalize">{run.status}</span>
                    <Badge variant="outline" className="text-[10px]">{run.trigger_type}</Badge>
                    {run.error && (
                      <span className="text-[11px] text-red-400 truncate">{run.error}</span>
                    )}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">
                    {formatDistanceToNow(parseISO(run.created_at), { addSuffix: true })}
                    {duration && ` · ${duration}`}
                  </p>
                </div>
                <code className="text-[10px] font-mono text-muted-foreground hidden sm:block">
                  {run.id.slice(0, 8)}
                </code>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

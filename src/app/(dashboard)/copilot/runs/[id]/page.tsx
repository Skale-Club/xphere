import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ChevronLeft, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { getCopilotRun } from '../../_actions/runs'

export const dynamic = 'force-dynamic'

export default async function CopilotRunPage(
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const res = await getCopilotRun(id)
  if (!res.ok) {
    if (res.error === 'not_found') notFound()
    return <div className="p-6 text-sm text-red-500">Error: {res.error}</div>
  }
  const run = res.data
  const duration = run.ended_at
    ? new Date(run.ended_at).getTime() - new Date(run.started_at).getTime()
    : null

  return (
    <div className="mx-auto max-w-none px-4 sm:px-6 lg:px-8 py-8">
      <Link
        href={`/copilot/conversations/${run.conversation_id}`}
        className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text-primary"
      >
        <ChevronLeft className="h-3 w-3" /> Conversation
      </Link>

      <div className="mt-3 rounded-lg border border-border bg-bg-secondary p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Run {run.id.slice(0, 8)}</h1>
          <StatusPill status={run.status} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
          <Field label="Provider" value={run.provider} />
          <Field label="Model" value={run.model} />
          <Field label="Tokens in" value={run.input_tokens.toLocaleString()} />
          <Field label="Tokens out" value={run.output_tokens.toLocaleString()} />
          <Field label="Cost (est.)" value={`$${run.estimated_cost_usd.toFixed(4)}`} />
          <Field label="Tool calls" value={String(run.toolCalls.length)} />
          {duration !== null && (
            <Field label="Duration" value={`${(duration / 1000).toFixed(1)}s`} />
          )}
        </div>
        {run.error && (
          <div className="mt-3 rounded border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-600">
            {run.error}
          </div>
        )}
      </div>

      <h2 className="mt-6 mb-2 text-sm font-medium">Tool calls</h2>
      {run.toolCalls.length === 0 ? (
        <p className="text-xs text-text-tertiary">No tool calls in this run.</p>
      ) : (
        <ol className="space-y-2">
          {run.toolCalls.map((tc, idx) => (
            <li
              key={tc.id}
              className="rounded-lg border border-border bg-bg-secondary p-3 text-xs"
            >
              <div className="flex items-center gap-2">
                <span className="text-text-tertiary">#{idx + 1}</span>
                {tc.status === 'succeeded' ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-red-500" />
                )}
                <span className="font-mono">{tc.tool_name}</span>
                <span className="ml-auto flex items-center gap-1 text-text-tertiary">
                  <Clock className="h-3 w-3" /> {tc.duration_ms}ms
                </span>
              </div>
              <details className="mt-2">
                <summary className="cursor-pointer text-text-secondary">Input</summary>
                <pre className="mt-1 overflow-x-auto rounded bg-bg-tertiary p-2 font-mono">
                  {JSON.stringify(tc.input, null, 2)}
                </pre>
              </details>
              <details className="mt-1">
                <summary className="cursor-pointer text-text-secondary">
                  {tc.status === 'succeeded' ? 'Output' : 'Error'}
                </summary>
                <pre className="mt-1 overflow-x-auto rounded bg-bg-tertiary p-2 font-mono">
                  {tc.status === 'succeeded'
                    ? JSON.stringify(tc.output, null, 2)
                    : tc.error}
                </pre>
              </details>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function StatusPill({ status }: { status: string }) {
  const color =
    status === 'succeeded'
      ? 'bg-green-500/15 text-green-600'
      : status === 'failed'
        ? 'bg-red-500/15 text-red-600'
        : 'bg-amber-500/15 text-amber-600'
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${color}`}>
      {status}
    </span>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-text-tertiary">{label}</div>
      <div className="text-text-primary">{value}</div>
    </div>
  )
}

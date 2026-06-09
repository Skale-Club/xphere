import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import { ArrowRight } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { AgentMetricsWidget } from '@/components/agents/agent-metrics-widget'
import { getAgentById } from '../../actions'
import { getAgentInvocations } from '@/lib/agent-runtime/observability'

type Props = { params: Promise<{ id: string }> }

export default async function AgentDashboardPage({ params }: Props) {
  const { id } = await params
  const [agent, invocations] = await Promise.all([
    getAgentById(id),
    getAgentInvocations({ agentId: id, page: 1 }),
  ])
  if (!agent) notFound()

  const recent = invocations.rows.slice(0, 8)

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Suspense
        fallback={<div className="h-36 animate-pulse rounded-[12px] border border-border bg-bg-secondary" />}
      >
        <AgentMetricsWidget agentId={id} />
      </Suspense>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent invocations</CardTitle>
          <Link
            href={`/agents/${id}/invocations`}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            View all ({invocations.total.toLocaleString()})
            <ArrowRight className="h-3 w-3" />
          </Link>
        </CardHeader>
        <CardContent>
          {recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No invocations yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {recent.map((row) => (
                <li key={row.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge
                      variant={
                        row.status === 'completed'
                          ? 'success'
                          : row.status === 'error' || row.status === 'failed'
                            ? 'danger'
                            : 'outline'
                      }
                      className="shrink-0 text-[10px]"
                    >
                      {row.status}
                    </Badge>
                    <span className="truncate text-text-secondary">
                      {new Date(row.createdAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-3 font-mono text-[11px] text-muted-foreground">
                    {row.durationMs != null && <span>{row.durationMs}ms</span>}
                    {row.costUsd != null && <span>${Number(row.costUsd).toFixed(5)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// src/app/(dashboard)/agents/[id]/invocations/page.tsx
// Phase 40 OBS-07: Agent invocations list with status/cost/error filters.
// Clicking a row opens InvocationDetailDrawer showing the delegation tree.

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getAgentById } from '../../actions'
import { getAgentInvocations } from '@/lib/agent-runtime/observability'
import { InvocationsList } from '@/components/agents/invocations-list'
import { Button } from '@/components/ui/button'

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    page?: string
    status?: string
    minCost?: string
    error?: string
  }>
}

export default async function AgentInvocationsPage({ params, searchParams }: Props) {
  const { id } = await params
  const sp = await searchParams

  const page = sp.page ? Math.max(1, parseInt(sp.page, 10)) : 1
  const minCostUsd = sp.minCost ? parseFloat(sp.minCost) : undefined

  const [agent, invocations] = await Promise.all([
    getAgentById(id),
    getAgentInvocations({
      agentId: id,
      page,
      status: sp.status || undefined,
      minCostUsd: Number.isFinite(minCostUsd) ? minCostUsd : undefined,
      errorSearch: sp.error || undefined,
    }),
  ])

  if (!agent) notFound()

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link href={`/dashboard/agents/${id}`}>
            <ChevronLeft className="h-4 w-4" />
            Back to {agent.name}
          </Link>
        </Button>
      </div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Invocations</h1>
        <p className="text-sm text-muted-foreground">
          {agent.name} · {invocations.total.toLocaleString()} total
        </p>
      </div>
      <InvocationsList
        agentId={id}
        initialRows={invocations.rows}
        initialTotal={invocations.total}
        currentPage={page}
      />
    </div>
  )
}

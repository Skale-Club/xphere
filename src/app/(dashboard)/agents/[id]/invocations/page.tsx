// src/app/(dashboard)/agents/[id]/invocations/page.tsx
// Phase 40 OBS-07: Agent invocations list with status/cost/error filters.
// Clicking a row opens InvocationDetailDrawer showing the delegation tree.
// Rendered inside the agent [id] layout (header + Test Your Bot rail).

import { notFound } from 'next/navigation'

import { getAgentById } from '../../actions'
import { getAgentInvocations } from '@/lib/agent-runtime/observability'
import { InvocationsList } from '@/components/agents/invocations-list'

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
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Invocations</h2>
        <p className="text-sm text-text-secondary">
          {invocations.total.toLocaleString()} total
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

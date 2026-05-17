// src/app/(dashboard)/agents/[id]/invocations/page.tsx
// Phase 40 OBS-07: Agent invocations list with status/cost/error filters.
// Clicking a row opens InvocationDetailDrawer showing the delegation tree.

import { notFound } from 'next/navigation'
import { ListTree } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
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
    <PageContainer>
      <PageHeader
        eyebrow="Observability"
        eyebrowIcon={ListTree}
        title="Invocations"
        description={
          <>
            <span className="font-medium text-text-primary">{agent.name}</span>{' '}
            <span className="text-text-tertiary">·</span>{' '}
            <span className="tabular">{invocations.total.toLocaleString()}</span> total
          </>
        }
        back={{ href: `/agents/${id}`, label: `Back to ${agent.name}` }}
      />
      <InvocationsList
        agentId={id}
        initialRows={invocations.rows}
        initialTotal={invocations.total}
        currentPage={page}
      />
    </PageContainer>
  )
}

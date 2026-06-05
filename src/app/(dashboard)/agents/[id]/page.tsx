import { notFound } from 'next/navigation'
import { Suspense } from 'react'

import { AgentForm } from '@/components/agents/agent-form'
import { AgentMetricsWidget } from '@/components/agents/agent-metrics-widget'
import { AgentPlayground } from '@/components/agents/agent-playground'
import { AgentWorkflowTools } from '@/components/agents/agent-workflow-tools'
import { PageContainer } from '@/components/layout/page-header'
import {
  getAgentById,
  getAgentWorkflows,
  getAvailableWorkflowsForAgent,
  getToolPickerData,
} from '../actions'
import { listAgentGroups } from '../_actions/groups'
import type { AgentChannel } from '@/lib/agents/channels'
import type { AvailableModel } from '@/lib/agents/models'
import type { AgentFormInput } from '@/lib/agents/zod-schemas'

type Props = { params: Promise<{ id: string }> }

export default async function EditAgentPage({ params }: Props) {
  const { id } = await params
  const [agent, toolPickerData, attachedWorkflows, availableWorkflows, groupsRes] =
    await Promise.all([
      getAgentById(id),
      getToolPickerData(),
      getAgentWorkflows(id),
      getAvailableWorkflowsForAgent(id),
      listAgentGroups(),
    ])
  if (!agent) notFound()
  const groups = groupsRes.ok ? groupsRes.data : []

  const initialValues: Partial<AgentFormInput> = {
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    system_prompt: agent.system_prompt,
    model: agent.model as AvailableModel,
    fallback_message: agent.fallback_message,
    max_history: agent.max_history,
    temperature: agent.temperature,
    max_tokens: agent.max_tokens,
    is_active: agent.is_active,
    group_id: agent.group_id,
    allowed_channels: (agent.allowed_channels ?? []) as AgentChannel[],
    channel_overrides: (agent.channel_overrides ??
      {}) as AgentFormInput['channel_overrides'],
    tool_ids: agent.tool_ids,
  }

  return (
    <PageContainer className="py-6" size="full">
      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(420px,34vw)]">
        <div className="min-w-0 space-y-6">
          <Suspense fallback={<div className="h-36 animate-pulse rounded-[12px] border border-border bg-bg-secondary" />}>
            <AgentMetricsWidget agentId={id} />
          </Suspense>

          <AgentForm
            mode="edit"
            agentId={agent.id}
            initialValues={initialValues}
            initialToolIds={agent.tool_ids}
            toolPickerData={toolPickerData}
            groups={groups}
          />

          <div className="rounded-[12px] border border-border bg-bg-secondary p-4">
            <AgentWorkflowTools
              agentId={agent.id}
              initialAttached={attachedWorkflows}
              initialAvailable={availableWorkflows}
            />
          </div>
        </div>

        <div className="min-w-0 xl:sticky xl:top-4 xl:h-[calc(100vh-6rem)]">
          <div className="flex h-[720px] min-h-[560px] overflow-hidden rounded-[12px] border border-border bg-bg-secondary xl:h-full">
            <AgentPlayground agentId={agent.id} agentName={agent.name} />
          </div>
        </div>
      </div>
    </PageContainer>
  )
}

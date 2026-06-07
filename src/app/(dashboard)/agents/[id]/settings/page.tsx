import { notFound } from 'next/navigation'

import { AgentSettingsForm } from '@/components/agents/agent-settings-form'
import { getAgentById } from '../../actions'
import { listAgentGroups } from '../../_actions/groups'
import type { AgentChannel } from '@/lib/agents/channels'
import type { AvailableModel } from '@/lib/agents/models'
import type { AgentSettingsInput } from '@/lib/agents/zod-schemas'

type Props = { params: Promise<{ id: string }> }

export default async function AgentSettingsPage({ params }: Props) {
  const { id } = await params
  const [agent, groupsRes] = await Promise.all([getAgentById(id), listAgentGroups()])
  if (!agent) notFound()
  const groups = groupsRes.ok ? groupsRes.data : []

  const initialValues: Partial<AgentSettingsInput> = {
    name: agent.name,
    slug: agent.slug,
    description: agent.description,
    model: agent.model as AvailableModel,
    fallback_message: agent.fallback_message,
    max_history: agent.max_history,
    temperature: agent.temperature,
    max_tokens: agent.max_tokens,
    is_active: agent.is_active,
    group_id: agent.group_id,
    allowed_channels: (agent.allowed_channels ?? []) as AgentChannel[],
    channel_overrides: (agent.channel_overrides ??
      {}) as AgentSettingsInput['channel_overrides'],
  }

  return (
    <div className="mx-auto max-w-3xl">
      <AgentSettingsForm agentId={agent.id} initialValues={initialValues} groups={groups} />
    </div>
  )
}

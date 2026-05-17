import { notFound } from 'next/navigation'
import Link from 'next/link'
import { AgentForm } from '@/components/agents/agent-form'
import { Button } from '@/components/ui/button'
import { getAgentById, getToolPickerData } from '../actions'
import type { AgentChannel } from '@/lib/agents/channels'
import type { AvailableModel } from '@/lib/agents/models'
import type { AgentFormInput } from '@/lib/agents/zod-schemas'

type Props = { params: Promise<{ id: string }> }

export default async function EditAgentPage({ params }: Props) {
  const { id } = await params
  const [agent, toolPickerData] = await Promise.all([
    getAgentById(id),
    getToolPickerData(),
  ])
  if (!agent) notFound()

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
    allowed_channels: (agent.allowed_channels ?? []) as AgentChannel[],
    channel_overrides: (agent.channel_overrides ??
      {}) as AgentFormInput['channel_overrides'],
    tool_ids: agent.tool_ids,
  }

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold">{agent.name}</h1>
          <p className="text-sm text-muted-foreground font-mono">{agent.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/agents/${id}/playground`}>
              Playground
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/dashboard/agents/${id}/prompt-history`}>
              Prompt History
            </Link>
          </Button>
        </div>
      </div>
      <AgentForm
        mode="edit"
        agentId={agent.id}
        initialValues={initialValues}
        initialToolIds={agent.tool_ids}
        toolPickerData={toolPickerData}
      />
    </div>
  )
}

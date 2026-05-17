import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Suspense } from 'react'
import { Bot, FlaskConical, History, ListTree } from 'lucide-react'

import { AgentForm } from '@/components/agents/agent-form'
import { AgentMetricsWidget } from '@/components/agents/agent-metrics-widget'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
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
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Agent"
        eyebrowIcon={Bot}
        back={{ href: '/agents', label: 'Back to agents' }}
        title={
          <>
            <span className="truncate">{agent.name}</span>
            <Badge variant="outline" className="font-mono text-[10px] tracking-tight">
              {agent.slug}
            </Badge>
          </>
        }
        description={
          <span className="inline-flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-[5px] bg-bg-tertiary px-1.5 py-0.5 text-[11px] font-medium text-text-secondary">
              {agent.model}
            </span>
            <span className="text-text-tertiary">·</span>
            <span>{agent.is_active ? 'Active' : 'Inactive'}</span>
          </span>
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/agents/${id}/invocations`}>
                <ListTree className="h-3.5 w-3.5" />
                Invocations
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/agents/${id}/playground`}>
                <FlaskConical className="h-3.5 w-3.5" />
                Playground
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/agents/${id}/prompt-history`}>
                <History className="h-3.5 w-3.5" />
                History
              </Link>
            </Button>
          </>
        }
      />

      <Suspense fallback={<div className="h-36 animate-pulse rounded-[12px] border border-border bg-bg-secondary" />}>
        <AgentMetricsWidget agentId={id} />
      </Suspense>

      <AgentForm
        mode="edit"
        agentId={agent.id}
        initialValues={initialValues}
        initialToolIds={agent.tool_ids}
        toolPickerData={toolPickerData}
      />
    </PageContainer>
  )
}

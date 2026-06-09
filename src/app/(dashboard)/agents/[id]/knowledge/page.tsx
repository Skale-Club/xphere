import { notFound } from 'next/navigation'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AgentKnowledgeSelector } from '@/components/agents/agent-knowledge-selector'
import { getAgentById } from '../../actions'
import { getKnowledgeSources } from '@/actions/knowledge'

type Props = { params: Promise<{ id: string }> }

export default async function AgentKnowledgePage({ params }: Props) {
  const { id } = await params
  const [agent, sources] = await Promise.all([getAgentById(id), getKnowledgeSources()])
  if (!agent) notFound()

  return (
    <div className="mx-auto max-w-3xl">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Knowledge</CardTitle>
          <CardDescription>
            Choose which knowledge sources this agent can search. Manage the
            sources themselves under Settings → Knowledge.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AgentKnowledgeSelector
            agentId={agent.id}
            sources={sources.map((s) => ({
              id: s.id,
              name: s.name,
              source_type: s.source_type,
              status: s.status,
              chunk_count: s.chunk_count,
            }))}
            initialScope={agent.kb_scope}
          />
        </CardContent>
      </Card>
    </div>
  )
}

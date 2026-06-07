import { notFound } from 'next/navigation'

import { getAgentById } from '../actions'
import { AgentHeaderTitle } from '@/components/agents/agent-header-title'
import { AgentPlaygroundRail } from '@/components/agents/agent-playground-rail'

type Props = {
  children: React.ReactNode
  params: Promise<{ id: string }>
}

/**
 * Persistent shell for a single agent. The header (inline-editable name +
 * status) and the "Test Your Bot" playground rail live here so they stay put
 * while the user moves between the agent's sections (Prompt & Actions /
 * Knowledge / Settings / Dashboard). Because the rail is in the layout, its
 * conversation survives section navigation.
 */
export default async function AgentDetailLayout({ children, params }: Props) {
  const { id } = await params
  const agent = await getAgentById(id)
  if (!agent) notFound()

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-border px-6 py-4">
        <AgentHeaderTitle
          agentId={agent.id}
          name={agent.name}
          isActive={agent.is_active}
          subtitle={agent.description}
        />
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-y-auto px-6 py-6">
          {children}
        </main>
        <AgentPlaygroundRail agentId={agent.id} agentName={agent.name} />
      </div>
    </div>
  )
}

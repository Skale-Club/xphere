import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft, FlaskConical } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { getAgentById } from '../../actions'
import { AgentPlayground } from '@/components/agents/agent-playground'

type Props = { params: Promise<{ id: string }> }

export default async function AgentPlaygroundPage({ params }: Props) {
  const { id } = await params
  const agent = await getAgentById(id)
  if (!agent) notFound()

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Compact header */}
      <div className="flex shrink-0 items-center gap-3 border-b border-border bg-bg-secondary/40 px-6 py-3">
        <Button variant="ghost" size="sm" asChild className="gap-1 text-text-secondary">
          <Link href={`/agents/${id}`}>
            <ChevronLeft className="h-4 w-4" />
            Back to {agent.name}
          </Link>
        </Button>
        <div className="h-4 w-px bg-border" />
        <div className="flex items-center gap-1.5 text-[12.5px] font-medium text-text-secondary">
          <FlaskConical className="h-3.5 w-3.5 text-accent" />
          Playground
        </div>
      </div>

      {/* Full-height playground */}
      <AgentPlayground agentId={agent.id} agentName={agent.name} />
    </div>
  )
}

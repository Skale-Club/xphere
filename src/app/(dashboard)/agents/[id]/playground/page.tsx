import { notFound } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { getAgentById } from '../../actions'
import { AgentPlayground } from '@/components/agents/agent-playground'

type Props = { params: Promise<{ id: string }> }

export default async function AgentPlaygroundPage({ params }: Props) {
  const { id } = await params
  const agent = await getAgentById(id)
  if (!agent) notFound()

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      {/* Compact header */}
      <div className="flex items-center gap-3 px-6 py-3 border-b shrink-0">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link href={`/dashboard/agents/${id}`}>
            <ChevronLeft className="h-4 w-4" />
            Back to {agent.name}
          </Link>
        </Button>
        <div className="h-4 w-px bg-border" />
        <span className="text-sm text-muted-foreground">Playground</span>
      </div>

      {/* Full-height playground */}
      <AgentPlayground agentId={agent.id} agentName={agent.name} />
    </div>
  )
}

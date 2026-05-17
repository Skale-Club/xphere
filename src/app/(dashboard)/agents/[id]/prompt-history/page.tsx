import { notFound } from 'next/navigation'
import { getAgentById, getPromptVersionHistory } from '../../actions'
import { PromptHistoryPanel } from '@/components/agents/prompt-history-panel'
import { Button } from '@/components/ui/button'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'

type Props = { params: Promise<{ id: string }> }

export default async function PromptHistoryPage({ params }: Props) {
  const { id } = await params
  const [agent, versions] = await Promise.all([
    getAgentById(id),
    getPromptVersionHistory(id),
  ])
  if (!agent) notFound()

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild className="gap-1">
          <Link href={`/dashboard/agents/${id}`}>
            <ChevronLeft className="h-4 w-4" />
            Back to {agent.name}
          </Link>
        </Button>
      </div>
      <div className="mb-6">
        <h1 className="text-lg font-semibold">Prompt History</h1>
        <p className="text-sm text-muted-foreground">
          {versions.length} version{versions.length !== 1 ? 's' : ''} · Click &quot;Activate&quot; to roll back to any prior version
        </p>
      </div>
      <PromptHistoryPanel agentId={id} versions={versions} />
    </div>
  )
}

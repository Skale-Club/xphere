import { notFound } from 'next/navigation'

import { getAgentById } from '../../actions'
import { getPromptVersionHistory } from '../../_actions/prompts'
import { PromptHistoryPanel } from '@/components/agents/prompt-history-panel'

type Props = { params: Promise<{ id: string }> }

export default async function PromptHistoryPage({ params }: Props) {
  const { id } = await params
  const [agent, versions] = await Promise.all([
    getAgentById(id),
    getPromptVersionHistory(id),
  ])
  if (!agent) notFound()

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h2 className="text-base font-semibold text-text-primary">Prompt history</h2>
        <p className="text-sm text-text-secondary">
          {versions.length} version{versions.length !== 1 ? 's' : ''} · Click
          &quot;Activate&quot; to roll back to any prior version.
        </p>
      </div>
      <PromptHistoryPanel agentId={id} versions={versions} />
    </div>
  )
}

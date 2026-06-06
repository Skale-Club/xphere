import { notFound } from 'next/navigation'
import { History } from 'lucide-react'

import { getAgentById } from '../../actions'
import { getPromptVersionHistory } from '../../_actions/prompts'
import { PromptHistoryPanel } from '@/components/agents/prompt-history-panel'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

type Props = { params: Promise<{ id: string }> }

export default async function PromptHistoryPage({ params }: Props) {
  const { id } = await params
  const [agent, versions] = await Promise.all([
    getAgentById(id),
    getPromptVersionHistory(id),
  ])
  if (!agent) notFound()

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Prompt history"
        eyebrowIcon={History}
        title="Prompt history"
        description={
          <>
            {versions.length} version{versions.length !== 1 ? 's' : ''} ·{' '}
            <span className="text-text-tertiary">
              Click &quot;Activate&quot; to roll back to any prior version
            </span>
          </>
        }
        back={{ href: `/agents/${id}`, label: `Back to ${agent.name}` }}
      />
      <PromptHistoryPanel agentId={id} versions={versions} />
    </PageContainer>
  )
}

import { Sparkles } from 'lucide-react'

import { AgentForm } from '@/components/agents/agent-form'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { getToolPickerData } from '../actions'

export default async function NewAgentPage() {
  const toolPickerData = await getToolPickerData()
  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="New agent"
        eyebrowIcon={Sparkles}
        title="New agent"
        description="Create a new chat agent for your organization. Pick a model, set its prompt, and attach the tools it needs."
        back={{ href: '/agents', label: 'Back to agents' }}
      />
      <AgentForm mode="create" toolPickerData={toolPickerData} />
    </PageContainer>
  )
}

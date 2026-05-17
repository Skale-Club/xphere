import { Wrench } from 'lucide-react'

import { getToolConfigs, getFolders } from './actions'
import { getIntegrations } from '@/app/(dashboard)/integrations/actions'
import { ToolsTable } from '@/components/tools/tools-table'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

export default async function ToolsPage() {
  const [toolConfigs, integrations, folders] = await Promise.all([
    getToolConfigs(),
    getIntegrations(),
    getFolders(),
  ])

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Action engine"
        eyebrowIcon={Wrench}
        title="Tools"
        description="Map Vapi tool names to platform actions and integrations. Each tool wires an LLM-callable name to a backend action."
      />
      <ToolsTable toolConfigs={toolConfigs} integrations={integrations} folders={folders} />
    </PageContainer>
  )
}

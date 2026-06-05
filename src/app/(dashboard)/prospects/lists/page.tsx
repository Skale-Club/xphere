import { ListChecks, ShieldAlert } from 'lucide-react'

import { getProspectLists } from '../actions'
import { ListsClient } from './lists-client'
import { EntityPageTemplate } from '@/components/crm/entity-template'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

export default async function ProspectListsPage() {
  const result = await getProspectLists()

  return (
    <EntityPageTemplate scope={{ entity: 'prospect', lifecycleStage: 'prospect' }}>
      <PageContainer size="wide" className="h-full">
        <PageHeader
          eyebrow="Prospects"
          eyebrowIcon={result.ok ? ListChecks : ShieldAlert}
          title="Lists"
          description="Named groups of prospects. Build a list, then start outreach or send it to the field."
        />

        {!result.ok ? (
          <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-8 text-[13px] text-text-secondary">
            {result.error}
          </div>
        ) : (
          <ListsClient lists={result.lists} />
        )}
      </PageContainer>
    </EntityPageTemplate>
  )
}

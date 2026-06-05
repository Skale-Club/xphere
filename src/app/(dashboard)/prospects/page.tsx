import { ShieldAlert, UserPlus } from 'lucide-react'

import { getProspects } from './actions'
import { ProspectsTable } from '@/components/prospects/prospects-table'
import { EntityPageTemplate } from '@/components/crm/entity-template'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

export default async function ProspectsPage() {
  const result = await getProspects()

  if (!result.ok) {
    return (
      <EntityPageTemplate scope={{ entity: 'prospect', lifecycleStage: 'prospect' }}>
        <PageContainer size="narrow">
          <PageHeader
            eyebrow="Sales"
            eyebrowIcon={ShieldAlert}
            title="Prospects"
            description="This area is available to workspace admins only."
          />
          <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-8 text-[13px] text-text-secondary">
            {result.error}
          </div>
        </PageContainer>
      </EntityPageTemplate>
    )
  }

  return (
    <EntityPageTemplate scope={{ entity: 'prospect', lifecycleStage: 'prospect' }}>
      <PageContainer size="wide" className="h-full">
        <PageHeader
          eyebrow="Sales"
          eyebrowIcon={UserPlus}
          title="Prospects"
          description="Early-stage records stay here until an admin deliberately converts them into the normal CRM."
        />
        <ProspectsTable rows={result.rows} total={result.total} />
      </PageContainer>
    </EntityPageTemplate>
  )
}

import { ShieldAlert, Target } from 'lucide-react'

import { getProspectAudiences } from '../actions'
import { AudiencesClient } from './audiences-client'
import { EntityPageTemplate } from '@/components/crm/entity-template'
import { PageContainer, PageHeader } from '@/components/layout/page-header'

export default async function ProspectAudiencesPage() {
  const result = await getProspectAudiences()

  return (
    <EntityPageTemplate scope={{ entity: 'prospect', lifecycleStage: 'prospect' }}>
      <PageContainer size="wide" className="h-full">
        <PageHeader
          eyebrow="Prospects"
          eyebrowIcon={result.ok ? Target : ShieldAlert}
          title="Audiences"
          description="Saved segments of prospects. Sync them to outreach platforms for targeted campaigns."
        />

        {!result.ok ? (
          <div className="rounded-[12px] border border-border bg-bg-secondary px-4 py-8 text-[13px] text-text-secondary">
            {result.error}
          </div>
        ) : (
          <AudiencesClient audiences={result.audiences} />
        )}
      </PageContainer>
    </EntityPageTemplate>
  )
}

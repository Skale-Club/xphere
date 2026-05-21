import { Plug } from 'lucide-react'
import { Suspense } from 'react'

import { getIntegrationsForDisplay } from './actions'
import { IntegrationList } from '@/components/integrations/integration-list'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import type { SavedIntegration } from '@/lib/integrations/registry'

interface Props {
  searchParams: Promise<{ open?: string }>
}

export default async function IntegrationsPage({ searchParams }: Props) {
  const { open } = await searchParams
  const rows = await getIntegrationsForDisplay()

  // Index by provider id for O(1) lookup in IntegrationList
  const saved: Record<string, SavedIntegration> = {}
  for (const row of rows) {
    saved[row.provider] = {
      id: row.id,
      provider: row.provider,
      name: row.name,
      masked_api_key: row.masked_api_key,
      location_id: row.location_id,
      config: row.config,
      is_active: row.is_active,
    }
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Connections"
        eyebrowIcon={Plug}
        title="Integrations"
        description="Wire Xphere into the rest of your stack | messaging, voice, CRM, scheduling, and AI providers."
      />
      <Suspense fallback={null}>
        <IntegrationList saved={saved} initialOpen={open} />
      </Suspense>
    </PageContainer>
  )
}

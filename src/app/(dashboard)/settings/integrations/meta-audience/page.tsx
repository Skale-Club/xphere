import { redirect } from 'next/navigation'
import { Users } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { getMetaAudienceConfig } from './actions'
import { MetaAudienceForm } from './meta-audience-form'

export default async function MetaAudiencePage() {
  const user = await getUser()
  if (!user) redirect('/')

  const config = await getMetaAudienceConfig()

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Ads"
        eyebrowIcon={Users}
        title="Meta Custom Audience Sync"
        description="Keep a Meta Custom Audience automatically in sync with your CRM contacts. Contacts are hashed before sending — raw data never leaves Xphere."
      />
      <div className="max-w-xl">
        <MetaAudienceForm config={config} />
      </div>
    </PageContainer>
  )
}

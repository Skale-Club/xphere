import { redirect } from 'next/navigation'
import { KeyRound } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { listApiKeys } from './actions'
import { ApiKeysClient } from './api-keys-client'

export const dynamic = 'force-dynamic'

export default async function ApiKeysPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const { keys } = await listApiKeys()

  return (
    <PageContainer size="narrow">
      <PageHeader
        eyebrow="Developer"
        eyebrowIcon={KeyRound}
        title="API Keys"
        description="Bearer tokens for pushing contacts from external forms and websites into your CRM."
      />
      <ApiKeysClient initial={keys} />
    </PageContainer>
  )
}

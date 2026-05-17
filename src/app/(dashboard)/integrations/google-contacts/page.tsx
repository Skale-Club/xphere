import { redirect } from 'next/navigation'
import { Users } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { GoogleContactsSettings } from '@/components/integrations/google-contacts-settings'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { getGoogleContactsIntegration } from './actions'

interface Props {
  searchParams: Promise<{ connected?: string; error?: string }>
}

export default async function GoogleContactsPage({ searchParams }: Props) {
  const user = await getUser()
  if (!user) redirect('/login')

  const [integration, params] = await Promise.all([
    getGoogleContactsIntegration(),
    searchParams,
  ])

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Google Contacts"
        eyebrowIcon={Users}
        title="Google Contacts"
        description="Connect a Google account to create, update, find, and delete contacts via the action engine."
        back={{ href: '/integrations', label: 'All integrations' }}
      />

      <GoogleContactsSettings
        integration={integration}
        connected={params.connected === 'true'}
        error={params.error}
      />
    </PageContainer>
  )
}

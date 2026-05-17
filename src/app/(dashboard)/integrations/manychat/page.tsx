import { redirect } from 'next/navigation'
import { MessageCircleMore } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { ManychatSettings } from '@/components/integrations/manychat-settings'
import { ManychatSubnav } from '@/components/integrations/manychat-subnav'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { getManychatChannel } from './actions'

export default async function ManychatIntegrationsPage() {
  const user = await getUser()

  if (!user) {
    redirect('/login')
  }

  const channel = await getManychatChannel()

  return (
    <PageContainer>
      <PageHeader
        eyebrow="ManyChat"
        eyebrowIcon={MessageCircleMore}
        title="ManyChat"
        description="Connect your ManyChat bot to receive subscriber events and route them to actions."
        back={{ href: '/integrations', label: 'All integrations' }}
      />

      <ManychatSubnav active="settings" />

      <ManychatSettings channel={channel} />
    </PageContainer>
  )
}

import { redirect } from 'next/navigation'
import { MessageCircleMore } from 'lucide-react'

import { getUser } from '@/lib/supabase/server'
import { ManychatEvents } from '@/components/integrations/manychat-events'
import { ManychatSubnav } from '@/components/integrations/manychat-subnav'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { getManychatEvents } from '../event-actions'

type SearchParams = {
  status?: string
  from?: string
  to?: string
  offset?: string
}

export default async function ManychatEventsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const user = await getUser()
  if (!user) redirect('/')

  const params = await searchParams
  const offset = parseInt(params.offset ?? '0', 10) || 0
  const status = ['matched', 'unmatched', 'error'].includes(params.status ?? '')
    ? (params.status as 'matched' | 'unmatched' | 'error')
    : undefined

  const { events, total } = await getManychatEvents({
    status,
    from: params.from,
    to: params.to,
    offset,
    limit: 25,
  })

  return (
    <PageContainer>
      <PageHeader
        eyebrow="ManyChat"
        eyebrowIcon={MessageCircleMore}
        title="Event log"
        description="Inbound ManyChat webhook events and their routing outcomes."
        back={{ href: '/integrations', label: 'All integrations' }}
      />

      <ManychatSubnav active="events" />

      <ManychatEvents
        initialEvents={events}
        initialTotal={total}
        searchParams={params}
      />
    </PageContainer>
  )
}

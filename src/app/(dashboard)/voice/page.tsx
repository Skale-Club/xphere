import { PhoneCall } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { listCallLogs } from './actions'
import { CallTimeline } from '@/components/calls/call-timeline'
import { NewCallButton } from '@/components/calls/new-call-button'

interface VoicePageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const VALID_FILTERS = ['all', 'inbound', 'outbound', 'missed'] as const
type Filter = (typeof VALID_FILTERS)[number]

export default async function VoicePage({ searchParams }: VoicePageProps) {
  const sp = await searchParams
  const filterRaw = typeof sp.filter === 'string' ? sp.filter : 'all'
  const filter = (VALID_FILTERS as readonly string[]).includes(filterRaw)
    ? (filterRaw as Filter)
    : 'all'

  const direction = filter === 'all' ? undefined : filter
  const { rows } = await listCallLogs({ direction, limit: 200 })

  return (
    <PageContainer size="wide">
      <PageHeader
        eyebrow="Voice"
        eyebrowIcon={PhoneCall}
        title="Calls"
        description="Every inbound and outbound call you place through Operator — with recording, contact link, and notes."
        actions={<NewCallButton />}
      />
      <CallTimeline rows={rows} filter={filter} />
    </PageContainer>
  )
}

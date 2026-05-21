import { notFound } from 'next/navigation'
import { PhoneCall, PhoneIncoming, PhoneOutgoing } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { getUnifiedCall } from '../actions'
import { CallDetailAi } from '@/components/calls/call-detail-ai'
import { CallDetailHuman } from '@/components/calls/call-detail-human'

interface Props {
  params: Promise<{ id: string }>
}

export default async function CallDetailPage({ params }: Props) {
  const { id } = await params
  const call = await getUnifiedCall(id)
  if (!call) notFound()

  const displayName =
    call.contact?.name
    ?? call.counterpart_name
    ?? call.counterpart_number
    ?? 'Unknown'

  return (
    <PageContainer size="wide">
      <PageHeader
        eyebrow={call.call_type === 'ai' ? 'AI Call' : 'Call'}
        eyebrowIcon={PhoneCall}
        back={{ href: '/calls', label: 'All calls' }}
        title={
          <span className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarFallback className="bg-bg-tertiary text-[13px] font-medium text-text-secondary">
                {initialsOf(displayName)}
              </AvatarFallback>
            </Avatar>
            <span>{displayName}</span>
          </span>
        }
        description={
          <span className="flex items-center gap-3 text-[12.5px]">
            {call.direction === 'inbound'
              ? <PhoneIncoming className="h-3.5 w-3.5 text-emerald-400" />
              : <PhoneOutgoing className="h-3.5 w-3.5 text-accent" />}
            <span className="capitalize">{call.direction}</span>
            <span className="text-text-tertiary">·</span>
            <span>{call.counterpart_number ?? '|'}</span>
          </span>
        }
      />

      {call.call_type === 'ai'
        ? <CallDetailAi call={call} />
        : <CallDetailHuman call={call} />
      }
    </PageContainer>
  )
}

function initialsOf(name: string | null | undefined): string {
  const base = (name ?? '?').replace(/[^a-zA-Z0-9 ]/g, ' ').trim()
  const parts = base.split(/\s+/)
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return base.slice(0, 2).toUpperCase()
}

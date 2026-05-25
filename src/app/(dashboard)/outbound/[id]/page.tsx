import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { Megaphone } from 'lucide-react'

import { getCampaignDetail } from '@/app/(dashboard)/outbound/actions'
import { ContactStatusBoard } from '@/components/campaigns/contact-status-board'
import { CsvImportForm } from '@/components/campaigns/csv-import-form'
import { CampaignTrackedLink } from '@/components/campaigns/campaign-tracked-link'
import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { StatusPill } from '@/components/design-system/status-pill'
import { buildUTMLink, campaignToUTMParams } from '@/lib/traffic/utm'
import type { CampaignStatus } from '@/types/database'

interface PageProps {
  params: Promise<{ id: string }>
}

function statusTone(status: CampaignStatus) {
  switch (status) {
    case 'in_progress': return 'live' as const
    case 'completed':   return 'success' as const
    case 'scheduled':   return 'info' as const
    case 'paused':      return 'warning' as const
    case 'stopped':     return 'danger' as const
    default:            return 'idle' as const
  }
}

export default async function CampaignDetailPage({ params }: PageProps) {
  const { id } = await params
  let detail
  try {
    detail = await getCampaignDetail(id)
  } catch {
    notFound()
  }

  const { campaign, contacts } = detail
  const status = campaign.status as CampaignStatus

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Outbound campaign"
        eyebrowIcon={Megaphone}
        back={{ href: '/calls/campaigns', label: 'Back to campaigns' }}
        title={<span className="truncate">{campaign.name}</span>}
        description={
          <span className="inline-flex items-center gap-2">
            <StatusPill tone={statusTone(status)}>{status}</StatusPill>
            <span className="text-text-tertiary">·</span>
            <span><span className="tabular text-text-primary">{campaign.calls_per_minute}</span> calls/min</span>
            {campaign.scheduled_start_at && (
              <>
                <span className="text-text-tertiary">·</span>
                <span>Scheduled {format(new Date(campaign.scheduled_start_at), 'MMM d, yyyy HH:mm')}</span>
              </>
            )}
          </span>
        }
      />

      {campaign.landing_page_url && (
        <CampaignTrackedLink
          link={buildUTMLink(campaign.landing_page_url, campaignToUTMParams(campaign))}
          landingPage={campaign.landing_page_url}
        />
      )}

      <ContactStatusBoard
        campaignId={campaign.id}
        initialContacts={contacts}
        campaignStatus={status}
      />

      {(campaign.status === 'draft' || campaign.status === 'scheduled') && (
        <div className="rounded-[12px] border border-border bg-bg-secondary p-6 shadow-elevation-sm">
          <h2 className="text-[15px] font-semibold tracking-tight text-text-primary">Import contacts</h2>
          <p className="mt-1 text-[12.5px] text-text-secondary">Upload a CSV of contacts to call.</p>
          <div className="mt-4">
            <CsvImportForm campaignId={campaign.id} />
          </div>
        </div>
      )}
    </PageContainer>
  )
}

import { notFound } from 'next/navigation'
import { format } from 'date-fns'
import { Phone, MessageSquare, Mail, MessageCircle, Users, CheckCircle2, XCircle, Clock } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { StatusPill } from '@/components/design-system/status-pill'
import { Badge } from '@/components/ui/badge'
import { ContactStatusBoard } from '@/components/campaigns/contact-status-board'
import { CsvImportForm } from '@/components/campaigns/csv-import-form'
import { CampaignDetailActions } from '../_components/campaign-detail-actions'
import { getCampaignDetail, getCampaignMetrics } from '../actions'
import type { CampaignStatus, CampaignChannel } from '@/types/database'

interface PageProps {
  params: Promise<{ id: string }>
}

const CHANNEL_ICONS: Record<CampaignChannel, React.ComponentType<{ className?: string }>> = {
  calls: Phone,
  sms: MessageSquare,
  email: Mail,
  whatsapp: MessageCircle,
}

const CHANNEL_LABELS: Record<CampaignChannel, string> = {
  calls: 'Voice Call',
  sms: 'SMS',
  email: 'Email',
  whatsapp: 'WhatsApp',
}

function statusTone(status: CampaignStatus): 'live' | 'success' | 'warning' | 'danger' | 'info' | 'idle' {
  switch (status) {
    case 'in_progress':
    case 'running':
      return 'live'
    case 'completed':
      return 'success'
    case 'scheduled':
      return 'info'
    case 'paused':
      return 'warning'
    case 'stopped':
    case 'failed':
      return 'danger'
    default:
      return 'idle'
  }
}

function humanStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

export default async function CampaignDetailPage({ params }: PageProps) {
  const { id } = await params

  let detail
  try {
    detail = await getCampaignDetail(id)
  } catch {
    notFound()
  }

  const { campaign, contacts, recipients } = detail
  const status = campaign.status as CampaignStatus
  const channel = (campaign.channel ?? 'calls') as CampaignChannel
  const ChannelIcon = CHANNEL_ICONS[channel] ?? Phone
  const metrics = await getCampaignMetrics(id)

  return (
    <PageContainer>
      <PageHeader
        back={{ href: '/campaigns', label: 'Back to campaigns' }}
        actions={
          <CampaignDetailActions
            campaignId={campaign.id}
            campaignStatus={status}
            campaignChannel={channel}
          />
        }
      />

      {/* Campaign header card */}
      <div className="rounded-[12px] border border-border bg-bg-secondary p-6 shadow-elevation-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1">
              <Badge
                variant="outline"
                className="text-[11px] font-medium inline-flex items-center gap-1 text-text-secondary"
              >
                <ChannelIcon className="h-3 w-3" />
                {CHANNEL_LABELS[channel]}
              </Badge>
              <StatusPill tone={statusTone(status)}>
                {humanStatus(status)}
              </StatusPill>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-text-primary truncate">
              {campaign.name}
            </h1>
            {campaign.description && (
              <p className="mt-1 text-[13px] text-text-secondary">{campaign.description}</p>
            )}
            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-text-tertiary">
              {channel === 'calls' && (
                <span>{campaign.calls_per_minute} calls/min</span>
              )}
              {campaign.scheduled_start_at && (
                <span>
                  Scheduled {format(new Date(campaign.scheduled_start_at), 'MMM d, yyyy HH:mm')}
                </span>
              )}
              {campaign.started_at && (
                <span>
                  Started {format(new Date(campaign.started_at), 'MMM d, yyyy HH:mm')}
                </span>
              )}
              {campaign.completed_at && (
                <span>
                  Completed {format(new Date(campaign.completed_at), 'MMM d, yyyy HH:mm')}
                </span>
              )}
              <span>Created {format(new Date(campaign.created_at), 'MMM d, yyyy')}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Metrics row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: 'Total', value: metrics.total, icon: Users, color: 'text-text-primary' },
          { label: channel === 'calls' ? 'Completed' : 'Sent', value: channel === 'calls' ? metrics.completed_calls : metrics.sent, icon: CheckCircle2, color: 'text-emerald-400' },
          { label: 'Failed', value: metrics.failed, icon: XCircle, color: 'text-red-400' },
          { label: 'Pending', value: metrics.pending, icon: Clock, color: 'text-text-secondary' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div
            key={label}
            className="rounded-[10px] border border-border bg-bg-secondary p-4"
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`h-3.5 w-3.5 ${color}`} />
              <span className="text-[11px] font-medium text-text-tertiary uppercase tracking-wide">{label}</span>
            </div>
            <p className={`text-2xl font-semibold tabular-nums ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Voice-specific: contact status board */}
      {channel === 'calls' && contacts.length > 0 && (
        <ContactStatusBoard
          campaignId={campaign.id}
          initialContacts={contacts}
          campaignStatus={status}
        />
      )}

      {/* SMS/other: recipients table */}
      {channel !== 'calls' && recipients.length > 0 && (
        <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h2 className="text-[13px] font-semibold text-text-primary">Recipients</h2>
          </div>
          <div
            className="grid items-center gap-3 px-4 py-2 border-b border-border-subtle bg-bg-secondary text-[11px] font-medium uppercase tracking-wide text-text-tertiary"
            style={{ gridTemplateColumns: '1fr 100px 120px 100px' }}
          >
            <div>Contact</div>
            <div>Status</div>
            <div>Sent at</div>
            <div>Error</div>
          </div>
          <div className="divide-y divide-border-subtle">
            {recipients.map((r) => (
              <div
                key={r.id}
                className="grid items-center gap-3 px-4 py-2.5"
                style={{ gridTemplateColumns: '1fr 100px 120px 100px' }}
              >
                <span className="text-[12.5px] text-text-primary truncate">
                  {r.contact_id ?? r.id}
                </span>
                <Badge
                  variant="outline"
                  className="text-[10.5px] font-medium w-fit"
                >
                  {r.status}
                </Badge>
                <span className="text-[11.5px] text-text-tertiary">
                  {r.sent_at ? format(new Date(r.sent_at), 'MMM d, HH:mm') : '—'}
                </span>
                <span className="text-[11.5px] text-red-400 truncate">
                  {r.error_message ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Import contacts (voice campaigns in draft/scheduled) */}
      {channel === 'calls' && (status === 'draft' || status === 'scheduled') && (
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

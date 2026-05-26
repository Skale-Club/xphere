import { notFound } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { Phone, MessageSquare, Mail, MessageCircle, Megaphone } from 'lucide-react'

import { PageContainer, PageHeader } from '@/components/layout/page-header'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/server'
import { getCampaignMetrics } from '../actions'
import { CampaignDetailActions } from '../_components/campaign-detail-actions'
import type { CampaignChannel, CampaignStatus } from '@/types/database'

interface PageProps {
  params: Promise<{ id: string }>
}

const CHANNEL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  calls: Phone,
  sms: MessageSquare,
  email: Mail,
  whatsapp: MessageCircle,
}

const CHANNEL_COLORS: Record<string, string> = {
  calls: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  sms: 'bg-green-500/10 text-green-400 border-green-500/20',
  email: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  whatsapp: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
}

const STATUS_COLORS: Record<string, string> = {
  in_progress: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  running: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  paused: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  stopped: 'bg-red-500/10 text-red-400 border-red-500/20',
  completed: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20',
  failed: 'bg-red-500/10 text-red-400 border-red-500/20',
  draft: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
  scheduled: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
}

function humanStatus(status: string) {
  return status.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase())
}

async function getCampaignDetail(id: string) {
  const supabase = await createClient()

  const [campaignRes, contactsRes] = await Promise.all([
    supabase.from('campaigns').select('*').eq('id', id).single(),
    supabase
      .from('campaign_contacts')
      .select('*')
      .eq('campaign_id', id)
      .order('created_at', { ascending: true }),
  ])

  if (campaignRes.error) return null

  return {
    campaign: campaignRes.data,
    contacts: contactsRes.data ?? [],
  }
}

export default async function CampaignDetailPage({ params }: PageProps) {
  const { id } = await params
  const detail = await getCampaignDetail(id)
  if (!detail) notFound()

  const { campaign, contacts } = detail
  const channel = (campaign.channel ?? 'calls') as CampaignChannel
  const status = campaign.status as CampaignStatus

  const [metrics] = await Promise.all([getCampaignMetrics(id)])

  const ChannelIcon = CHANNEL_ICONS[channel] ?? Megaphone

  const isVoice = channel === 'calls'

  return (
    <PageContainer>
      <PageHeader
        back={{ href: '/campaigns', label: 'Back to campaigns' }}
        actions={
          <CampaignDetailActions
            campaignId={id}
            campaignStatus={status}
            campaignChannel={channel}
          />
        }
      />

      {/* Campaign Header Card */}
      <div className="rounded-[12px] border border-border bg-bg-secondary p-6 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-text-primary truncate">{campaign.name}</h1>
            {campaign.description && (
              <p className="text-sm text-text-secondary mt-1">{campaign.description}</p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className={['text-[10.5px] font-medium inline-flex items-center gap-1', CHANNEL_COLORS[channel] ?? ''].join(' ')}
          >
            <ChannelIcon className="h-3 w-3" />
            {channel}
          </Badge>
          <Badge
            variant="outline"
            className={['text-[10.5px] font-medium', STATUS_COLORS[status] ?? ''].join(' ')}
          >
            {humanStatus(status)}
          </Badge>
          {campaign.scheduled_start_at && (
            <span className="text-[12px] text-text-tertiary">
              Scheduled {format(new Date(campaign.scheduled_start_at), 'MMM d, yyyy HH:mm')}
            </span>
          )}
          {campaign.started_at && (
            <span className="text-[12px] text-text-tertiary">
              Started {format(new Date(campaign.started_at), 'MMM d, yyyy HH:mm')}
            </span>
          )}
        </div>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-[10px] border border-border bg-bg-secondary p-4 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary mb-1">Total</p>
          <p className="text-2xl font-bold text-text-primary tabular-nums">{metrics.total}</p>
        </div>
        <div className="rounded-[10px] border border-border bg-bg-secondary p-4 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary mb-1">
            {isVoice ? 'Completed Calls' : 'Delivered'}
          </p>
          <p className="text-2xl font-bold text-emerald-400 tabular-nums">
            {isVoice ? metrics.completed_calls : metrics.delivered}
          </p>
        </div>
        <div className="rounded-[10px] border border-border bg-bg-secondary p-4 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary mb-1">
            {isVoice ? 'No Answer' : 'Failed'}
          </p>
          <p className="text-2xl font-bold text-yellow-400 tabular-nums">
            {isVoice ? metrics.no_answer : metrics.failed}
          </p>
        </div>
        <div className="rounded-[10px] border border-border bg-bg-secondary p-4 text-center">
          <p className="text-[11px] font-medium uppercase tracking-wide text-text-tertiary mb-1">Pending</p>
          <p className="text-2xl font-bold text-text-secondary tabular-nums">{metrics.pending}</p>
        </div>
      </div>

      {/* Contacts / Recipients table (voice campaigns) */}
      {isVoice && contacts.length > 0 && (
        <div className="rounded-[12px] border border-border bg-bg-secondary overflow-hidden">
          <div className="px-4 py-3 border-b border-border-subtle">
            <h2 className="text-[13px] font-semibold text-text-primary">
              Contacts ({contacts.length})
            </h2>
          </div>
          <div
            className="grid items-center gap-3 px-4 py-2 border-b border-border-subtle text-[11px] font-medium uppercase tracking-wide text-text-tertiary"
            style={{ gridTemplateColumns: '1fr 140px 100px 120px' }}
          >
            <div>Name / Phone</div>
            <div>Status</div>
            <div>Called at</div>
            <div>Vapi call ID</div>
          </div>
          <div className="divide-y divide-border-subtle max-h-[480px] overflow-y-auto">
            {contacts.map((contact) => (
              <div
                key={contact.id}
                className="grid items-center gap-3 px-4 py-2.5"
                style={{ gridTemplateColumns: '1fr 140px 100px 120px' }}
              >
                <div className="min-w-0">
                  {contact.name && (
                    <p className="text-[13px] font-medium text-text-primary truncate">{contact.name}</p>
                  )}
                  <p className="text-[12px] text-text-tertiary">{contact.phone}</p>
                </div>
                <div>
                  <Badge
                    variant="outline"
                    className={[
                      'text-[10.5px] font-medium',
                      contact.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                      contact.status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                      contact.status === 'calling' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                      contact.status === 'no_answer' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                      'bg-slate-500/10 text-slate-400 border-slate-500/20',
                    ].join(' ')}
                  >
                    {humanStatus(contact.status)}
                  </Badge>
                </div>
                <div className="text-[11.5px] text-text-tertiary">
                  {contact.called_at ? format(new Date(contact.called_at), 'MMM d, HH:mm') : '—'}
                </div>
                <div className="text-[11.5px] text-text-tertiary font-mono truncate">
                  {contact.vapi_call_id ? (
                    <Link href={`/calls/${contact.vapi_call_id}`} className="hover:underline">
                      {contact.vapi_call_id.slice(0, 12)}…
                    </Link>
                  ) : '—'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Voice campaign import section */}
      {isVoice && (campaign.status === 'draft' || campaign.status === 'scheduled') && (
        <div className="rounded-[12px] border border-border bg-bg-secondary p-6">
          <h2 className="text-[15px] font-semibold text-text-primary">Import contacts</h2>
          <p className="mt-1 text-[12.5px] text-text-secondary">
            Upload a CSV of contacts to call. Use the{' '}
            <Link href={`/outbound/${id}`} className="underline hover:text-text-primary">
              legacy campaign view
            </Link>{' '}
            for CSV import.
          </p>
        </div>
      )}
    </PageContainer>
  )
}

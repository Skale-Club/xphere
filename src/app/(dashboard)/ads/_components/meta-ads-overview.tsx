'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  TrendingUp,
  Eye,
  MousePointerClick,
  DollarSign,
  Users,
  CheckCircle2,
  Loader2,
  AlertCircle,
  MessageSquare,
  LayoutGrid,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type AdAccountOption = { id: string; name: string }

type OverviewData = {
  account: { id: string; name: string; currency: string; account_status: number }
  insights: {
    impressions: string
    clicks: string
    spend: string
    reach: string
    cpc?: string
    cpm?: string
    ctr?: string
    actions?: Array<{ action_type: string; value: string }>
  } | null
}

const DATE_PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 days', value: 'last_7d' },
  { label: 'Last 14 days', value: 'last_14d' },
  { label: 'Last 30 days', value: 'last_30d' },
  { label: 'Last 90 days', value: 'last_90d' },
  { label: 'This month', value: 'this_month' },
  { label: 'Last month', value: 'last_month' },
]

function StatCard({
  label,
  value,
  icon: Icon,
  sub,
}: {
  label: string
  value: string
  icon: React.ComponentType<{ className?: string }>
  sub?: string
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-text-secondary">{label}</span>
        <Icon className="h-4 w-4 text-text-tertiary" />
      </div>
      <div className="space-y-0.5">
        <p className="text-2xl font-semibold text-text-primary">{value}</p>
        {sub && <p className="text-[11.5px] text-text-tertiary">{sub}</p>}
      </div>
    </div>
  )
}

function fmt(n: number | string | undefined, currency?: string): string {
  if (n == null || n === '') return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num)
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toFixed(2)
}

export function MetaAdsOverview({
  adAccountId,
  adAccountName,
  connections,
}: {
  adAccountId: string
  adAccountName: string
  connections: AdAccountOption[]
}) {
  const searchParams = useSearchParams()
  const justConnected = searchParams.get('connected') === 'true'

  const [datePreset, setDatePreset] = useState('last_30d')
  const [activeAccountId, setActiveAccountId] = useState(adAccountId)
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const activeAccount = connections.find((c) => c.id === activeAccountId)

  const fetchOverview = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/ads/meta/reports?report=overview&ad_account_id=${activeAccountId}&date_preset=${datePreset}`,
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to load data')
      }
      const json = await res.json()
      setData(json as OverviewData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview')
    } finally {
      setLoading(false)
    }
  }, [activeAccountId, datePreset])

  useEffect(() => {
    void fetchOverview()
  }, [fetchOverview])

  useEffect(() => {
    if (justConnected) {
      toast.success('Meta Ads connected successfully!')
    }
  }, [justConnected])

  const insights = data?.insights
  const currency = data?.account?.currency ?? 'USD'

  const purchases = insights?.actions?.find((a) => a.action_type === 'purchase')
  const leads = insights?.actions?.find((a) => a.action_type === 'lead')

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {connections.length > 1 && (
            <select
              value={activeAccountId}
              onChange={(e) => setActiveAccountId(e.target.value)}
              className="rounded-lg border border-border-subtle bg-bg-secondary px-3 py-1.5 text-[12.5px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
          {connections.length === 1 && (
            <span className="text-[13px] font-medium text-text-primary">{activeAccount?.name}</span>
          )}
          {data?.account && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-[10.5px] font-medium',
                data.account.account_status === 1
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-amber-500/10 text-amber-400',
              )}
            >
              {data.account.account_status === 1 ? 'Active' : 'Review'}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Date preset pills */}
          <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
            {DATE_PRESETS.slice(0, 4).map((p) => (
              <button
                key={p.value}
                onClick={() => setDatePreset(p.value)}
                className={cn(
                  'rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-all',
                  datePreset === p.value
                    ? 'bg-bg-primary text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {p.label}
              </button>
            ))}
            <select
              value={DATE_PRESETS.slice(4).some((p) => p.value === datePreset) ? datePreset : ''}
              onChange={(e) => e.target.value && setDatePreset(e.target.value)}
              className="rounded-[5px] bg-transparent px-1 py-1 text-[11.5px] text-text-secondary focus:outline-none"
            >
              <option value="">More</option>
              {DATE_PRESETS.slice(4).map((p) => (
                <option key={p.value} value={p.value}>{p.label}</option>
              ))}
            </select>
          </div>

          <Button variant="outline" size="sm" asChild>
            <Link href="/ads/chat">
              <MessageSquare className="h-3.5 w-3.5 mr-1.5" />
              AI Chat
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/ads/campaigns">
              <LayoutGrid className="h-3.5 w-3.5 mr-1.5" />
              Campaigns
            </Link>
          </Button>
        </div>
      </div>

      {/* Stats */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatCard
              label="Spend"
              value={`${currency} ${fmt(insights?.spend, currency)}`}
              icon={DollarSign}
              sub={datePreset.replace(/_/g, ' ')}
            />
            <StatCard
              label="Impressions"
              value={fmt(insights?.impressions)}
              icon={Eye}
              sub={`CPM: ${fmt(insights?.cpm, currency)}`}
            />
            <StatCard
              label="Clicks"
              value={fmt(insights?.clicks)}
              icon={MousePointerClick}
              sub={`CPC: ${fmt(insights?.cpc, currency)} · CTR: ${insights?.ctr ? `${parseFloat(insights.ctr).toFixed(2)}%` : '—'}`}
            />
            <StatCard
              label="Reach"
              value={fmt(insights?.reach)}
              icon={Users}
              sub="Unique accounts"
            />
          </div>

          {(purchases || leads) && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              {purchases && (
                <StatCard
                  label="Purchases"
                  value={fmt(purchases.value)}
                  icon={CheckCircle2}
                  sub="Conversion actions"
                />
              )}
              {leads && (
                <StatCard
                  label="Leads"
                  value={fmt(leads.value)}
                  icon={TrendingUp}
                  sub="Lead form fills"
                />
              )}
            </div>
          )}

          {!insights && (
            <div className="rounded-lg border border-border-subtle bg-bg-secondary px-4 py-8 text-center text-[13px] text-text-tertiary">
              No data available for the selected period.
            </div>
          )}
        </>
      )}
    </div>
  )
}

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
  LayoutGrid,
  SlidersHorizontal,
  ChevronDown,
  Unlink,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { AdsAttribution } from './ads-attribution'
import { AccountSelector } from './account-selector'

const ACCOUNT_STORAGE_KEY = 'xphere:meta_ads_account'

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

// A date filter is either a named Meta preset or an explicit custom range.
type DateFilter =
  | { type: 'preset'; value: string }
  | { type: 'custom'; since: string; until: string }

const PRESET_LABELS: Record<string, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  last_7d: 'Last 7 days',
  last_14d: 'Last 14 days',
  last_30d: 'Last 30 days',
  last_90d: 'Last 90 days',
  this_month: 'This month',
  last_month: 'Last month',
  maximum: 'All time',
}
const QUICK_PRESETS = ['today', 'yesterday', 'last_7d', 'last_30d']
const MORE_PRESETS = ['last_14d', 'last_90d', 'this_month', 'last_month', 'maximum']

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

  const [filter, setFilter] = useState<DateFilter>({ type: 'preset', value: 'last_30d' })
  const [filterOpen, setFilterOpen] = useState(false)
  const [customSince, setCustomSince] = useState('')
  const [customUntil, setCustomUntil] = useState('')
  const [activeAccountId, setActiveAccountId] = useState(adAccountId)
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)

  const activeAccount = connections.find((c) => c.id === activeAccountId)

  const selectAccount = (id: string) => {
    setActiveAccountId(id)
    try {
      localStorage.setItem(ACCOUNT_STORAGE_KEY, id)
    } catch {
      /* ignore storage errors (private mode, etc.) */
    }
  }

  // Restore the previously-selected account when the screen opens (per browser).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACCOUNT_STORAGE_KEY)
      if (saved && connections.some((c) => c.id === saved)) setActiveAccountId(saved)
    } catch {
      /* ignore */
    }
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleDisconnect = async () => {
    if (!window.confirm('Disconnect Meta Ads? You can reconnect anytime.')) return
    setDisconnecting(true)
    try {
      const res = await fetch('/api/ads/meta/disconnect', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to disconnect')
      }
      toast.success('Meta Ads disconnected')
      window.location.href = '/ads'
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to disconnect')
      setDisconnecting(false)
    }
  }

  const filterLabel =
    filter.type === 'preset'
      ? PRESET_LABELS[filter.value] ?? filter.value
      : `${filter.since} → ${filter.until}`

  const fetchOverview = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ report: 'overview', ad_account_id: activeAccountId })
      if (filter.type === 'preset') {
        params.set('date_preset', filter.value)
      } else {
        params.set('since', filter.since)
        params.set('until', filter.until)
      }
      const res = await fetch(`/api/ads/meta/reports?${params.toString()}`)
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
  }, [activeAccountId, filter])

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

  // AdsAttribution only understands named presets; fall back to last_30d for
  // custom ranges so it keeps working.
  const attributionPreset = filter.type === 'preset' ? filter.value : 'last_30d'

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {connections.length > 1 ? (
            <AccountSelector value={activeAccountId} options={connections} onSelect={selectAccount} />
          ) : (
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
          <button
            onClick={handleDisconnect}
            disabled={disconnecting}
            title="Disconnect Meta Ads"
            className="flex items-center gap-1 rounded-md px-2 py-1 text-[11.5px] font-medium text-text-tertiary transition-colors hover:bg-red-500/10 hover:text-red-400 disabled:opacity-50"
          >
            {disconnecting ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Unlink className="h-3 w-3" />
            )}
            Disconnect
          </button>
        </div>

        <div className="flex items-center gap-2">
          {/* Date preset pills + filters */}
          <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
            {QUICK_PRESETS.map((p) => (
              <button
                key={p}
                onClick={() => setFilter({ type: 'preset', value: p })}
                className={cn(
                  'rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-all',
                  filter.type === 'preset' && filter.value === p
                    ? 'bg-bg-primary text-text-primary shadow-sm'
                    : 'text-text-secondary hover:text-text-primary',
                )}
              >
                {PRESET_LABELS[p]}
              </button>
            ))}

            <Popover open={filterOpen} onOpenChange={setFilterOpen}>
              <PopoverTrigger asChild>
                <button
                  className={cn(
                    'flex items-center gap-1 rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-all',
                    filter.type === 'custom' ||
                      (filter.type === 'preset' && MORE_PRESETS.includes(filter.value))
                      ? 'bg-bg-primary text-text-primary shadow-sm'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  {filter.type === 'custom' ||
                  (filter.type === 'preset' && MORE_PRESETS.includes(filter.value))
                    ? filterLabel
                    : 'More'}
                  <ChevronDown className="h-3 w-3" />
                </button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-2">
                <div className="space-y-0.5">
                  {MORE_PRESETS.map((p) => (
                    <button
                      key={p}
                      onClick={() => {
                        setFilter({ type: 'preset', value: p })
                        setFilterOpen(false)
                      }}
                      className={cn(
                        'w-full rounded-md px-2.5 py-1.5 text-left text-[12.5px] transition-colors',
                        filter.type === 'preset' && filter.value === p
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
                      )}
                    >
                      {PRESET_LABELS[p]}
                    </button>
                  ))}
                </div>

                <div className="my-2 border-t border-border-subtle" />

                <div className="space-y-2 px-1 pb-1">
                  <p className="text-[11px] font-medium text-text-secondary">Custom range</p>
                  <div className="space-y-1.5">
                    <label className="flex items-center gap-2 text-[11px] text-text-tertiary">
                      <span className="w-8 shrink-0">From</span>
                      <input
                        type="date"
                        value={customSince}
                        max={customUntil || undefined}
                        onChange={(e) => setCustomSince(e.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 text-[11.5px] text-text-primary [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </label>
                    <label className="flex items-center gap-2 text-[11px] text-text-tertiary">
                      <span className="w-8 shrink-0">To</span>
                      <input
                        type="date"
                        value={customUntil}
                        min={customSince || undefined}
                        onChange={(e) => setCustomUntil(e.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-border-subtle bg-bg-secondary px-2 py-1 text-[11.5px] text-text-primary [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-accent"
                      />
                    </label>
                  </div>
                  <Button
                    size="sm"
                    className="w-full"
                    disabled={!customSince || !customUntil}
                    onClick={() => {
                      setFilter({ type: 'custom', since: customSince, until: customUntil })
                      setFilterOpen(false)
                    }}
                  >
                    Apply range
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

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
              sub={filterLabel}
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

      {/* Lead & Revenue Attribution */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold text-text-primary">Lead & Revenue Attribution</h2>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">via UTM</span>
        </div>
        <AdsAttribution
          platform="meta"
          datePreset={attributionPreset}
          currency={data?.account?.currency ?? 'USD'}
        />
      </div>
    </div>
  )
}

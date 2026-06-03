'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import {
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
import { CampaignsModal } from './campaigns-modal'
import { MetaKpiCards } from './meta-kpi-cards'
import { MetaFunnel } from './meta-funnel'
import { MetaTrendCharts, type DailyTrendRow } from './meta-trend-charts'
import { MetaTopCampaigns, type CampaignLeadRow } from './meta-top-campaigns'

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

type AttributionTotals = {
  sessions: number
  identified_contacts: number
  opportunities: number
  revenue: number
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
  const [campaignsOpen, setCampaignsOpen] = useState(false)

  // Overview data
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Daily trend data
  const [trendData, setTrendData] = useState<DailyTrendRow[]>([])
  const [trendLoading, setTrendLoading] = useState(true)

  // Top campaigns by leads
  const [campaignData, setCampaignData] = useState<CampaignLeadRow[]>([])
  const [campaignLoading, setCampaignLoading] = useState(true)

  // Attribution totals lifted up for the conversion funnel
  const [attrTotals, setAttrTotals] = useState<AttributionTotals | null>(null)
  const [attrLoading, setAttrLoading] = useState(true)

  const [disconnecting, setDisconnecting] = useState(false)

  const activeAccount = connections.find((c) => c.id === activeAccountId)

  const selectAccount = (id: string) => {
    setActiveAccountId(id)
    try {
      localStorage.setItem(ACCOUNT_STORAGE_KEY, id)
    } catch {
      /* ignore storage errors */
    }
  }

  // Restore previously-selected account on mount.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(ACCOUNT_STORAGE_KEY)
      if (saved && connections.some((c) => c.id === saved)) setActiveAccountId(saved)
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Keep the selection valid when the active account set changes (e.g. the
  // selected account was hidden via "Manage accounts"). Without this, the
  // overview keeps showing the now-hidden account after a router.refresh().
  useEffect(() => {
    if (!connections.some((c) => c.id === activeAccountId)) {
      setActiveAccountId(adAccountId)
      try {
        localStorage.setItem(ACCOUNT_STORAGE_KEY, adAccountId)
      } catch {
        /* ignore */
      }
    }
  }, [connections, adAccountId, activeAccountId])

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

  const dateQuery =
    filter.type === 'preset'
      ? `date_preset=${filter.value}`
      : `since=${filter.since}&until=${filter.until}`

  function applyDateParams(params: URLSearchParams) {
    if (filter.type === 'preset') {
      params.set('date_preset', filter.value)
    } else {
      params.set('since', filter.since)
      params.set('until', filter.until)
    }
  }

  const fetchOverview = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ report: 'overview', ad_account_id: activeAccountId })
      applyDateParams(params)
      const res = await fetch(`/api/ads/meta/reports?${params.toString()}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to load data')
      }
      setData(await res.json() as OverviewData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load overview')
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, filter])

  const fetchTrend = useCallback(async () => {
    setTrendLoading(true)
    try {
      const params = new URLSearchParams({ report: 'daily_trend', ad_account_id: activeAccountId })
      applyDateParams(params)
      const res = await fetch(`/api/ads/meta/reports?${params.toString()}`)
      if (!res.ok) { setTrendData([]); return }
      const json = await res.json() as {
        rows: Array<{
          date_start: string
          spend: string
          actions?: Array<{ action_type: string; value: string }>
        }>
      }
      const rows: DailyTrendRow[] = (json.rows ?? []).map((r) => {
        const spend = parseFloat(r.spend ?? '0')
        const leads = parseFloat(r.actions?.find((a) => a.action_type === 'lead')?.value ?? '0')
        const d = new Date(r.date_start)
        const date = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        return { date, spend, leads, cpl: leads > 0 ? spend / leads : null }
      })
      setTrendData(rows)
    } catch {
      setTrendData([])
    } finally {
      setTrendLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, filter])

  const fetchTopCampaigns = useCallback(async () => {
    setCampaignLoading(true)
    try {
      const params = new URLSearchParams({ report: 'campaign_leads', ad_account_id: activeAccountId })
      applyDateParams(params)
      const res = await fetch(`/api/ads/meta/reports?${params.toString()}`)
      if (!res.ok) { setCampaignData([]); return }
      const json = await res.json() as { data: CampaignLeadRow[] }
      setCampaignData(json.data ?? [])
    } catch {
      setCampaignData([])
    } finally {
      setCampaignLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAccountId, filter])

  useEffect(() => {
    void fetchOverview()
    void fetchTrend()
    void fetchTopCampaigns()
    setAttrLoading(true)
    setAttrTotals(null)
  }, [fetchOverview, fetchTrend, fetchTopCampaigns])

  useEffect(() => {
    if (justConnected) toast.success('Meta Ads connected successfully!')
  }, [justConnected])

  const insights = data?.insights
  const currency = data?.account?.currency ?? 'USD'

  const leadsVal = parseFloat(insights?.actions?.find((a) => a.action_type === 'lead')?.value ?? '0')
  const spendVal = parseFloat(insights?.spend ?? '0')
  const clicksVal = parseFloat(insights?.clicks ?? '0')

  // AdsAttribution supports custom ranges via since/until props (added in this PR).
  const attributionPreset = filter.type === 'preset' ? filter.value : 'last_30d'
  const attrSince = filter.type === 'custom' ? filter.since : undefined
  const attrUntil = filter.type === 'custom' ? filter.until : undefined

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ──────────────────────────────────────────────── */}
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
            {disconnecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Unlink className="h-3 w-3" />}
            Disconnect
          </button>
        </div>

        <div className="flex items-center gap-2">
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
                    filter.type === 'custom' || (filter.type === 'preset' && MORE_PRESETS.includes(filter.value))
                      ? 'bg-bg-primary text-text-primary shadow-sm'
                      : 'text-text-secondary hover:text-text-primary',
                  )}
                >
                  <SlidersHorizontal className="h-3 w-3" />
                  {filter.type === 'custom' || (filter.type === 'preset' && MORE_PRESETS.includes(filter.value))
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
                      onClick={() => { setFilter({ type: 'preset', value: p }); setFilterOpen(false) }}
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
                    onClick={() => { setFilter({ type: 'custom', since: customSince, until: customUntil }); setFilterOpen(false) }}
                  >
                    Apply range
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </div>

          <Button variant="outline" size="sm" onClick={() => setCampaignsOpen(true)}>
            <LayoutGrid className="h-3.5 w-3.5 mr-1.5" />
            Campaigns
          </Button>
        </div>
      </div>

      <CampaignsModal
        open={campaignsOpen}
        onOpenChange={setCampaignsOpen}
        adAccountId={activeAccountId}
        currency={currency}
        dateQuery={dateQuery}
      />

      {/* ── Error ─────────────────────────────────────────────────── */}
      {!loading && error && (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* ── Section 1: Lead-Gen KPI Cards ──────────────────────────── */}
      <MetaKpiCards
        insights={insights ?? null}
        currency={currency}
        loading={loading}
        filterLabel={filterLabel}
      />

      {/* ── Section 2: Conversion Funnel + Trend Charts ─────────────── */}
      {!loading && !error && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <MetaFunnel
            impressions={parseFloat(insights?.impressions ?? '0')}
            clicks={parseFloat(insights?.clicks ?? '0')}
            leads={leadsVal}
            contacts={attrTotals?.identified_contacts ?? 0}
            opportunities={attrTotals?.opportunities ?? 0}
            revenue={attrTotals?.revenue ?? 0}
            currency={currency}
            loading={attrLoading}
          />
          <MetaTrendCharts
            data={trendData}
            currency={currency}
            loading={trendLoading}
          />
        </div>
      )}

      {/* ── Section 3: Performance Summary + Top Campaigns ──────────── */}
      {!loading && !error && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {/* Summary card */}
          <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4 space-y-4">
            <div>
              <p className="text-[12px] font-semibold text-text-primary">Performance Summary</p>
              <p className="text-[11px] text-text-tertiary mt-0.5">{filterLabel}</p>
            </div>
            <div className="space-y-3 divide-y divide-border-subtle/50">
              {[
                {
                  label: 'Total Spend',
                  value: spendVal > 0
                    ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(spendVal)
                    : '—',
                },
                {
                  label: 'Total Leads',
                  value: leadsVal > 0 ? leadsVal.toLocaleString() : '—',
                },
                {
                  label: 'Cost per Lead',
                  value: leadsVal > 0
                    ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(spendVal / leadsVal)
                    : '—',
                },
                {
                  label: 'Lead Rate',
                  value: clicksVal > 0
                    ? `${((leadsVal / clicksVal) * 100).toFixed(2)}%`
                    : '—',
                },
                {
                  label: 'Opportunities',
                  value: attrTotals?.opportunities != null && attrTotals.opportunities > 0
                    ? attrTotals.opportunities.toLocaleString()
                    : '—',
                },
                {
                  label: 'Revenue',
                  value: attrTotals?.revenue != null && attrTotals.revenue > 0
                    ? new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(attrTotals.revenue)
                    : '—',
                },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between pt-3 first:pt-0">
                  <span className="text-[12px] text-text-secondary">{item.label}</span>
                  <span className="text-[12.5px] font-semibold text-text-primary">{item.value}</span>
                </div>
              ))}
            </div>
          </div>

          <MetaTopCampaigns
            data={campaignData}
            currency={currency}
            loading={campaignLoading}
          />
        </div>
      )}

      {/* ── Section 4: Lead & Revenue Attribution ──────────────────── */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold text-text-primary">Lead & Revenue Attribution</h2>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">via UTM</span>
        </div>
        <AdsAttribution
          platform="meta"
          datePreset={attributionPreset}
          since={attrSince}
          until={attrUntil}
          currency={currency}
          onTotalsLoaded={(totals) => {
            setAttrTotals(totals)
            setAttrLoading(false)
          }}
        />
      </div>
    </div>
  )
}

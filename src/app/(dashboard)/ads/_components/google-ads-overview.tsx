'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { TrendingUp, Eye, MousePointerClick, DollarSign, Target, Loader2, AlertCircle, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { AdsAttribution } from './ads-attribution'
import { AdsDateFilter } from './ads-date-filter'
import { type DateFilter, applyGoogleDateParams, filterLabel as getFilterLabel } from './ads-date-filter.utils'
import { useCampaignsPanel } from './ads-campaigns-context'

type Metrics = {
  impressions: string
  clicks: string
  costMicros: string
  conversions: string
  ctr: string
  averageCpc: string
}

type OverviewData = {
  customer: { id: string; name: string; currency_code: string; manager: boolean }
  metrics: Metrics
}


function microsToUsd(micros: string | undefined, currency = 'USD'): string {
  if (!micros) return '—'
  const usd = Number(micros) / 1_000_000
  if (isNaN(usd)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(usd)
}

function fmtNum(n: string | undefined): string {
  if (!n) return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toFixed(0)
}

function fmtPct(n: string | undefined): string {
  if (!n) return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  return `${(num * 100).toFixed(2)}%`
}

function StatCard({ label, value, icon: Icon, sub }: { label: string; value: string; icon: React.ComponentType<{ className?: string }>; sub?: string }) {
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

export function GoogleAdsOverview({
  customerId,
  customerName,
  connections,
}: {
  customerId: string
  customerName: string
  connections: { id: string; name: string }[]
}) {
  const searchParams = useSearchParams()
  const justConnected = searchParams.get('connected') === 'true'

  const [filter, setFilter] = useState<DateFilter>({ type: 'preset', value: 'last_30d' })
  const [activeCustomerId, setActiveCustomerId] = useState(customerId)
  const { openPanel: openCampaigns } = useCampaignsPanel()
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ report: 'overview', customer_id: activeCustomerId })
      applyGoogleDateParams(params, filter)
      const res = await fetch(`/api/ads/google/reports?${params.toString()}`)
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
  }, [activeCustomerId, filter])

  useEffect(() => { void fetchData() }, [fetchData])
  useEffect(() => { if (justConnected) toast.success('Google Ads connected successfully!') }, [justConnected])

  // If the selected customer was hidden via "Manage accounts" it's no longer in
  // connections — fall back to the server's primary so the screen updates.
  useEffect(() => {
    if (!connections.some((c) => c.id === activeCustomerId)) {
      setActiveCustomerId(customerId)
    }
  }, [connections, customerId, activeCustomerId])

  const m = data?.metrics
  const currency = data?.customer.currency_code ?? 'USD'

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          {connections.length > 1 ? (
            <select
              value={activeCustomerId}
              onChange={(e) => setActiveCustomerId(e.target.value)}
              className="rounded-lg border border-border-subtle bg-bg-secondary px-3 py-1.5 text-[12.5px] text-text-primary focus:outline-none"
            >
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          ) : (
            <span className="text-[13px] font-medium text-text-primary">{customerName}</span>
          )}
          <span className="rounded-full bg-[#4285F4]/10 px-2 py-0.5 text-[10.5px] font-medium text-[#4285F4]">
            Google Ads
          </span>
        </div>

        <div className="flex items-center gap-2">
          <AdsDateFilter platform="google" value={filter} onChange={setFilter} />
          <Button
            variant="outline"
            size="sm"
            onClick={() => openCampaigns({
              adAccountId: activeCustomerId,
              currency: data?.customer?.currency_code ?? 'USD',
              dateQuery: new URLSearchParams({ customer_id: activeCustomerId }).toString(),
              platform: 'google',
            })}
          >
            <LayoutGrid className="h-3.5 w-3.5 mr-1.5" />
            Campaigns
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-text-tertiary" /></div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard label="Spend" value={microsToUsd(m?.costMicros, currency)} icon={DollarSign} sub={getFilterLabel(filter)} />
          <StatCard label="Impressions" value={fmtNum(m?.impressions)} icon={Eye} />
          <StatCard label="Clicks" value={fmtNum(m?.clicks)} icon={MousePointerClick} sub={`CTR: ${fmtPct(m?.ctr)}`} />
          <StatCard label="Avg CPC" value={microsToUsd(m?.averageCpc, currency)} icon={TrendingUp} />
          <StatCard label="Conversions" value={fmtNum(m?.conversions)} icon={Target} />
          <StatCard
            label="Cost/Conv."
            value={
              m && Number(m.conversions) > 0
                ? microsToUsd(String(Number(m.costMicros) / Number(m.conversions)), currency)
                : '—'
            }
            icon={DollarSign}
          />
        </div>
      )}

      {/* Lead & Revenue Attribution */}
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-semibold text-text-primary">Lead & Revenue Attribution</h2>
          <span className="rounded-full bg-[#4285F4]/10 px-2 py-0.5 text-[10px] font-medium text-[#4285F4]">via UTM</span>
        </div>
        <AdsAttribution
          platform="google"
          datePreset={filter.type === 'preset' ? filter.value : 'last_30d'}
          since={filter.type === 'custom' ? filter.since : undefined}
          until={filter.type === 'custom' ? filter.until : undefined}
          currency={data?.customer?.currency_code ?? 'USD'}
        />
      </div>
    </div>
  )
}

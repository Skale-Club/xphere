'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { TrendingUp, Eye, MousePointerClick, DollarSign, Target, Loader2, AlertCircle, MessageSquare, LayoutGrid } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

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

const DATE_PRESETS = [
  { label: 'Today', value: 'today' },
  { label: 'Yesterday', value: 'yesterday' },
  { label: 'Last 7 days', value: 'last_7d' },
  { label: 'Last 30 days', value: 'last_30d' },
  { label: 'Last 90 days', value: 'last_90d' },
  { label: 'This month', value: 'this_month' },
  { label: 'Last month', value: 'last_month' },
]

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

  const [datePreset, setDatePreset] = useState('last_30d')
  const [activeCustomerId, setActiveCustomerId] = useState(customerId)
  const [data, setData] = useState<OverviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/ads/google/reports?report=overview&customer_id=${activeCustomerId}&date_preset=${datePreset}`,
      )
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
  }, [activeCustomerId, datePreset])

  useEffect(() => { void fetchData() }, [fetchData])
  useEffect(() => { if (justConnected) toast.success('Google Ads connected successfully!') }, [justConnected])

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
          <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
            {DATE_PRESETS.slice(0, 4).map((p) => (
              <button
                key={p.value}
                onClick={() => setDatePreset(p.value)}
                className={cn(
                  'rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-all',
                  datePreset === p.value ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
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
              {DATE_PRESETS.slice(4).map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <Button variant="outline" size="sm" asChild>
            <Link href="/ads/google/chat"><MessageSquare className="h-3.5 w-3.5 mr-1.5" />AI Chat</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/ads/google/campaigns"><LayoutGrid className="h-3.5 w-3.5 mr-1.5" />Campaigns</Link>
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
          <StatCard label="Spend" value={microsToUsd(m?.costMicros, currency)} icon={DollarSign} sub={datePreset.replace(/_/g, ' ')} />
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
    </div>
  )
}

'use client'

import {
  DollarSign,
  TrendingUp,
  MousePointerClick,
  Eye,
  Users,
  BarChart2,
  Percent,
  Target,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { Loader2 } from 'lucide-react'

type InsightsLike = {
  impressions: string
  clicks: string
  spend: string
  reach: string
  cpc?: string
  cpm?: string
  ctr?: string
  actions?: Array<{ action_type: string; value: string }>
} | null

function fmt(n: number | string | undefined, currency?: string): string {
  if (n == null || n === '') return '—'
  const num = typeof n === 'string' ? parseFloat(n) : n
  if (isNaN(num)) return '—'
  if (currency) return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(num)
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toLocaleString()
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone = 'default',
}: {
  label: string
  value: string
  sub?: string
  icon: React.ComponentType<{ className?: string }>
  tone?: 'default' | 'highlight' | 'muted'
}) {
  return (
    <div
      className={cn(
        'rounded-xl border bg-bg-secondary p-4 space-y-3',
        tone === 'highlight' ? 'border-accent/30' : 'border-border-subtle',
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[12px] font-medium text-text-secondary">{label}</span>
        <Icon
          className={cn(
            'h-4 w-4',
            tone === 'highlight' ? 'text-accent' : 'text-text-tertiary',
          )}
        />
      </div>
      <div className="space-y-0.5">
        <p
          className={cn(
            'text-2xl font-semibold',
            tone === 'highlight' ? 'text-text-primary' : 'text-text-primary',
            tone === 'muted' && 'text-text-secondary text-xl',
          )}
        >
          {value}
        </p>
        {sub && <p className="text-[11.5px] text-text-tertiary">{sub}</p>}
      </div>
    </div>
  )
}

function SecondaryCard({
  label,
  value,
  sub,
  icon: Icon,
}: {
  label: string
  value: string
  sub?: string
  icon: React.ComponentType<{ className?: string }>
}) {
  return (
    <div className="rounded-xl border border-border-subtle bg-bg-secondary/50 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium text-text-tertiary">{label}</span>
        <Icon className="h-3.5 w-3.5 text-text-tertiary opacity-60" />
      </div>
      <div className="space-y-0.5">
        <p className="text-[18px] font-semibold text-text-primary">{value}</p>
        {sub && <p className="text-[11px] text-text-tertiary">{sub}</p>}
      </div>
    </div>
  )
}

export function MetaKpiCards({
  insights,
  currency,
  loading,
  filterLabel,
}: {
  insights: InsightsLike
  currency: string
  loading: boolean
  filterLabel: string
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
      </div>
    )
  }

  if (!insights) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-secondary px-4 py-8 text-center text-[13px] text-text-tertiary">
        No data available for the selected period.
      </div>
    )
  }

  const leadsRaw = parseFloat(insights.actions?.find((a) => a.action_type === 'lead')?.value ?? '0')
  const spendRaw = parseFloat(insights.spend ?? '0')
  const clicksRaw = parseFloat(insights.clicks ?? '0')
  const impressionsRaw = parseFloat(insights.impressions ?? '0')

  const cpl = leadsRaw > 0 ? spendRaw / leadsRaw : null
  const leadRate = clicksRaw > 0 ? (leadsRaw / clicksRaw) * 100 : null
  const ctr = insights.ctr ? parseFloat(insights.ctr) : null
  const cpm = insights.cpm ? parseFloat(insights.cpm) : null
  const cpc = insights.cpc ? parseFloat(insights.cpc) : null

  return (
    <div className="space-y-3">
      {/* Row 1 — lead-gen KPIs */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label="Cost per Lead"
          value={cpl != null ? fmt(cpl, currency) : '—'}
          icon={Target}
          tone="highlight"
          sub={cpl != null ? filterLabel : 'No leads tracked'}
        />
        <KpiCard
          label="Leads"
          value={leadsRaw > 0 ? fmt(leadsRaw) : '—'}
          icon={TrendingUp}
          tone="highlight"
          sub="Lead form fills"
        />
        <KpiCard
          label="Lead Rate"
          value={leadRate != null ? `${leadRate.toFixed(2)}%` : '—'}
          icon={Percent}
          tone="highlight"
          sub="Leads / Clicks"
        />
        <KpiCard
          label="Spend"
          value={`${currency} ${fmt(spendRaw, currency)}`}
          icon={DollarSign}
          sub={filterLabel}
        />
      </div>

      {/* Row 2 — secondary metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SecondaryCard
          label="CPM"
          value={cpm != null ? fmt(cpm, currency) : '—'}
          icon={BarChart2}
          sub="Cost per 1K impressions"
        />
        <SecondaryCard
          label="CTR"
          value={ctr != null ? `${ctr.toFixed(2)}%` : '—'}
          icon={MousePointerClick}
          sub={`CPC: ${cpc != null ? fmt(cpc, currency) : '—'}`}
        />
        <SecondaryCard
          label="Impressions"
          value={impressionsRaw > 0 ? fmt(impressionsRaw) : '—'}
          icon={Eye}
          sub={filterLabel}
        />
        <SecondaryCard
          label="Reach"
          value={parseFloat(insights.reach ?? '0') > 0 ? fmt(parseFloat(insights.reach)) : '—'}
          icon={Users}
          sub="Unique accounts"
        />
      </div>
    </div>
  )
}

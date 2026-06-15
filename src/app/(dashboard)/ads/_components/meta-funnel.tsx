'use client'

import { cn } from '@/lib/utils'

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtCurrency(n: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function pct(num: number, denom: number): string {
  if (denom === 0) return '—'
  return `${((num / denom) * 100).toFixed(2)}%`
}

type FunnelStep = {
  label: string
  value: number
  convLabel: string
  convRate: string
  color: string
}

function FunnelRow({
  step,
  topValue,
  isFirst,
}: {
  step: FunnelStep
  topValue: number
  isFirst: boolean
}) {
  const barWidth = topValue > 0 ? Math.max((step.value / topValue) * 100, step.value > 0 ? 2 : 0) : 0

  return (
    <div className="flex items-center gap-2 py-2 overflow-hidden">
      <div className="w-20 shrink-0 text-right">
        <p className="text-[11.5px] font-medium text-text-secondary truncate">{step.label}</p>
      </div>
      <div className="flex-1 min-w-0">
        <div className="h-5 rounded-md bg-bg-tertiary overflow-hidden">
          <div
            className={cn('h-full rounded-md transition-all duration-500', step.color)}
            style={{ width: `${barWidth}%` }}
          />
        </div>
      </div>
      <div className="w-14 shrink-0 text-right">
        <p className="text-[12px] font-semibold text-text-primary tabular-nums">
          {step.value > 0 ? fmtNum(step.value) : '—'}
        </p>
      </div>
      <div className="w-20 shrink-0 text-right">
        {!isFirst && (
          <p className="text-[10.5px] text-text-tertiary truncate">
            {step.convRate} <span className="opacity-60">{step.convLabel}</span>
          </p>
        )}
      </div>
    </div>
  )
}

export function MetaFunnel({
  impressions,
  clicks,
  leads,
  addToCart,
  checkouts,
  purchases,
  contacts,
  opportunities,
  revenue,
  currency,
  loading,
  adObjective,
}: {
  impressions: number
  clicks: number
  leads: number
  addToCart: number
  checkouts: number
  purchases: number
  contacts: number
  opportunities: number
  revenue: number
  currency: string
  loading: boolean
  adObjective: 'leads' | 'sales'
}) {
  const leadsSteps: FunnelStep[] = [
    {
      label: 'Impressions',
      value: impressions,
      convLabel: '',
      convRate: '100%',
      color: 'bg-blue-500/40',
    },
    {
      label: 'Clicks',
      value: clicks,
      convLabel: 'CTR',
      convRate: pct(clicks, impressions),
      color: 'bg-blue-400/50',
    },
    {
      label: 'Leads',
      value: leads,
      convLabel: 'Lead Rate',
      convRate: pct(leads, clicks),
      color: 'bg-accent/60',
    },
    {
      label: 'Contacts ID',
      value: contacts,
      convLabel: 'ID Rate',
      convRate: pct(contacts, leads),
      color: 'bg-accent/70',
    },
    {
      label: 'Opportunities',
      value: opportunities,
      convLabel: 'Conv.',
      convRate: pct(opportunities, contacts),
      color: 'bg-green-500/60',
    },
    {
      label: 'Revenue',
      value: revenue,
      convLabel: '',
      convRate: revenue > 0 ? fmtCurrency(revenue, currency) : '—',
      color: 'bg-green-500/80',
    },
  ]

  const salesSteps: FunnelStep[] = [
    {
      label: 'Impressions',
      value: impressions,
      convLabel: '',
      convRate: '100%',
      color: 'bg-blue-500/40',
    },
    {
      label: 'Clicks',
      value: clicks,
      convLabel: 'CTR',
      convRate: pct(clicks, impressions),
      color: 'bg-blue-400/50',
    },
    {
      label: 'Add to Cart',
      value: addToCart,
      convLabel: 'ATC Rate',
      convRate: pct(addToCart, clicks),
      color: 'bg-accent/60',
    },
    {
      label: 'Checkout',
      value: checkouts,
      convLabel: 'Checkout Rate',
      convRate: pct(checkouts, addToCart),
      color: 'bg-accent/70',
    },
    {
      label: 'Purchases',
      value: purchases,
      convLabel: 'Purchase Rate',
      convRate: pct(purchases, checkouts),
      color: 'bg-green-500/60',
    },
    {
      label: 'Revenue',
      value: revenue,
      convLabel: '',
      convRate: revenue > 0 ? fmtCurrency(revenue, currency) : '—',
      color: 'bg-green-500/80',
    },
  ]

  const steps = adObjective === 'sales' ? salesSteps : leadsSteps
  const funnelSubtitle = adObjective === 'sales' ? 'Impressions → Revenue' : 'Impressions → Revenue'

  if (loading) {
    return (
      <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4 space-y-3">
        <p className="text-[12px] font-semibold text-text-primary mb-3">Conversion Funnel</p>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 py-2 animate-pulse overflow-hidden">
            <div className="w-20 h-4 rounded bg-bg-tertiary shrink-0" />
            <div className="flex-1 h-5 rounded bg-bg-tertiary" />
            <div className="w-14 h-4 rounded bg-bg-tertiary shrink-0" />
            <div className="w-20 h-3 rounded bg-bg-tertiary shrink-0" />
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4">
      <p className="text-[12px] font-semibold text-text-primary mb-1">Conversion Funnel</p>
      <p className="text-[11px] text-text-tertiary mb-3">{funnelSubtitle}</p>
      <div className="divide-y divide-border-subtle/50">
        {steps.map((step, i) => (
          <FunnelRow key={step.label} step={step} topValue={impressions} isFirst={i === 0} />
        ))}
      </div>
    </div>
  )
}

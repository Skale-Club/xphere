'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Loader2, AlertCircle, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type AdSet = {
  id: string
  name: string
  campaign_id: string
  status: string
  effective_status: string
  daily_budget?: string
  lifetime_budget?: string
  created_time: string
  insights: {
    impressions: string
    clicks: string
    spend: string
    cpc?: string
    ctr?: string
  } | null
}

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-400',
  PAUSED: 'bg-amber-500/10 text-amber-400',
  ARCHIVED: 'bg-bg-tertiary text-text-tertiary',
}

function fmt(n: string | undefined): string {
  if (!n) return '—'
  const num = parseFloat(n)
  if (isNaN(num)) return '—'
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toFixed(0)
}

export function MetaAdsAdSets({
  adAccountId,
  adAccountName,
  connections,
}: {
  adAccountId: string
  adAccountName: string
  connections: { id: string; name: string }[]
}) {
  const [activeAccountId, setActiveAccountId] = useState(adAccountId)
  const [datePreset, setDatePreset] = useState('last_30d')
  const [adsets, setAdSets] = useState<AdSet[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchAdSets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/ads/meta/reports?report=adsets&ad_account_id=${activeAccountId}&date_preset=${datePreset}`,
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to load ad sets')
      }
      const json = await res.json() as { data: AdSet[] }
      setAdSets(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load ad sets')
    } finally {
      setLoading(false)
    }
  }, [activeAccountId, datePreset])

  useEffect(() => { void fetchAdSets() }, [fetchAdSets])

  return (
    <div className="p-6 space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/ads">
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Overview
            </Link>
          </Button>
          <span className="text-[13px] font-medium text-text-secondary">Ad Sets</span>
          {connections.length > 1 && (
            <select
              value={activeAccountId}
              onChange={(e) => setActiveAccountId(e.target.value)}
              className="rounded-lg border border-border-subtle bg-bg-secondary px-3 py-1.5 text-[12.5px] text-text-primary focus:outline-none"
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
          {[
            { label: 'Last 7d', value: 'last_7d' },
            { label: 'Last 30d', value: 'last_30d' },
            { label: 'Last 90d', value: 'last_90d' },
          ].map((p) => (
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
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
        </div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      ) : adsets.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-bg-secondary px-4 py-12 text-center text-[13px] text-text-tertiary">
          No ad sets found.
        </div>
      ) : (
        <div className="rounded-xl border border-border-subtle overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border-subtle bg-bg-secondary">
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Ad Set</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Status</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Spend</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Impressions</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Clicks</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">CTR</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {adsets.map((adset) => (
                <tr key={adset.id} className="bg-bg-primary hover:bg-bg-secondary/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-primary truncate max-w-[280px]">{adset.name}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', STATUS_COLORS[adset.effective_status] ?? STATUS_COLORS.ARCHIVED)}>
                      {adset.effective_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-text-primary">{fmt(adset.insights?.spend)}</td>
                  <td className="px-4 py-3 text-right text-text-primary">{fmt(adset.insights?.impressions)}</td>
                  <td className="px-4 py-3 text-right text-text-primary">{fmt(adset.insights?.clicks)}</td>
                  <td className="px-4 py-3 text-right text-text-tertiary">
                    {adset.insights?.ctr ? `${parseFloat(adset.insights.ctr).toFixed(2)}%` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useCallback } from 'react'
import { Loader2, AlertCircle, TrendingUp, ExternalLink } from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

type AttributionRow = {
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  sessions: number
  identified_contacts: number
  opportunities: number
  revenue: number
}

type AttributionData = {
  rows: AttributionRow[]
  totals: {
    sessions: number
    identified_contacts: number
    opportunities: number
    revenue: number
  }
}

function fmtCurrency(n: number, currency = 'USD') {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

function fmtNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

export function AdsAttribution({
  platform,
  datePreset,
  adSpendBycampaign,
  currency = 'USD',
}: {
  platform: 'meta' | 'google'
  datePreset: string
  /** Optional: spend data from ads API keyed by campaign name, for ROAS calc */
  adSpendBycampaign?: Record<string, number>
  currency?: string
}) {
  const [data, setData] = useState<AttributionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await window.fetch(
        `/api/ads/attribution?platform=${platform}&date_preset=${datePreset}`,
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to load attribution')
      }
      setData(await res.json() as AttributionData)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load attribution data')
    } finally {
      setLoading(false)
    }
  }, [platform, datePreset])

  useEffect(() => { void fetch() }, [fetch])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="h-5 w-5 animate-spin text-text-tertiary" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
        <AlertCircle className="h-4 w-4 shrink-0" />{error}
      </div>
    )
  }

  const rows = data?.rows ?? []
  const totals = data?.totals

  if (!rows.length) {
    return (
      <div className="rounded-lg border border-border-subtle bg-bg-secondary px-4 py-8 text-center space-y-2">
        <p className="text-[13px] text-text-secondary">No attributed traffic found for this period.</p>
        <p className="text-[12px] text-text-tertiary">
          Attribution requires UTM-tagged campaigns and identified visitors (visitors linked to contacts).
          {' '}<Link href="/traffic" className="text-accent hover:underline">Check your traffic dashboard →</Link>
        </p>
      </div>
    )
  }

  const hasSpend = adSpendBycampaign && Object.keys(adSpendBycampaign).length > 0

  return (
    <div className="space-y-3">
      {/* Totals row */}
      {totals && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            { label: 'Sessions', value: fmtNum(totals.sessions) },
            { label: 'Identified Contacts', value: fmtNum(totals.identified_contacts) },
            { label: 'Opportunities', value: fmtNum(totals.opportunities) },
            { label: 'Revenue', value: fmtCurrency(totals.revenue, currency) },
          ].map((item) => (
            <div key={item.label} className="rounded-lg border border-border-subtle bg-bg-secondary px-3 py-2.5">
              <p className="text-[11px] font-medium text-text-tertiary">{item.label}</p>
              <p className="text-lg font-semibold text-text-primary">{item.value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="rounded-xl border border-border-subtle overflow-hidden">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-border-subtle bg-bg-secondary">
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Campaign</th>
              <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Source / Medium</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Sessions</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Leads</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Opps</th>
              <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Revenue</th>
              {hasSpend && (
                <>
                  <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Ad Spend</th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">ROAS</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-border-subtle">
            {rows.map((row, i) => {
              const campaignKey = row.utm_campaign?.toLowerCase() ?? ''
              const spend = adSpendBycampaign?.[campaignKey] ?? adSpendBycampaign?.[row.utm_campaign ?? ''] ?? 0
              const roas = hasSpend && spend > 0 ? row.revenue / spend : null
              const maxRevenue = rows[0]?.revenue ?? 1

              return (
                <tr key={i} className="bg-bg-primary hover:bg-bg-secondary/50 transition-colors">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-text-primary truncate max-w-[180px]">
                      {row.utm_campaign ?? '—'}
                    </div>
                    {/* Revenue bar */}
                    {row.revenue > 0 && (
                      <div className="mt-1 h-1 rounded-full bg-bg-tertiary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{ width: `${(row.revenue / maxRevenue) * 100}%` }}
                        />
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className="text-text-secondary">{row.utm_source ?? '—'}</span>
                    {row.utm_medium && (
                      <span className="ml-1 text-text-tertiary">/ {row.utm_medium}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right text-text-primary">{fmtNum(row.sessions)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={cn('text-text-primary', row.identified_contacts === 0 && 'text-text-tertiary')}>
                      {fmtNum(row.identified_contacts)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={cn('text-text-primary', row.opportunities === 0 && 'text-text-tertiary')}>
                      {fmtNum(row.opportunities)}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <span className={cn('font-medium', row.revenue > 0 ? 'text-green-400' : 'text-text-tertiary')}>
                      {row.revenue > 0 ? fmtCurrency(row.revenue, currency) : '—'}
                    </span>
                  </td>
                  {hasSpend && (
                    <>
                      <td className="px-4 py-2.5 text-right text-text-secondary">
                        {spend > 0 ? fmtCurrency(spend, currency) : '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {roas !== null ? (
                          <span className={cn('font-medium', roas >= 2 ? 'text-green-400' : roas >= 1 ? 'text-amber-400' : 'text-red-400')}>
                            {roas.toFixed(2)}x
                          </span>
                        ) : '—'}
                      </td>
                    </>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="text-[11px] text-text-tertiary flex items-center gap-1">
        <TrendingUp className="h-3 w-3" />
        Attribution via UTM → visitor identification → CRM contact → pipeline opportunities.
        {' '}
        <Link href="/traffic" className="text-accent hover:underline inline-flex items-center gap-0.5">
          Traffic dashboard <ExternalLink className="h-2.5 w-2.5" />
        </Link>
      </p>
    </div>
  )
}

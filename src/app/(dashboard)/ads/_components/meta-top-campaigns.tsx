'use client'

import { cn } from '@/lib/utils'

export type CampaignLeadRow = {
  id: string
  name: string
  leads: number
  spend: number
  cpl: number | null
  ctr: number | null
}

function fmtCurrency(n: number, currency: string): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n)
}

export function MetaTopCampaigns({
  data,
  currency,
  loading,
}: {
  data: CampaignLeadRow[]
  currency: string
  loading: boolean
}) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4 md:col-span-2">
        <div className="h-4 w-40 rounded bg-bg-tertiary animate-pulse mb-4" />
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex gap-3 py-2.5 border-b border-border-subtle/50 animate-pulse">
            <div className="flex-1 h-3 rounded bg-bg-tertiary" />
            <div className="w-10 h-3 rounded bg-bg-tertiary" />
            <div className="w-16 h-3 rounded bg-bg-tertiary" />
            <div className="w-16 h-3 rounded bg-bg-tertiary" />
          </div>
        ))}
      </div>
    )
  }

  const totalLeads = data.reduce((s, r) => s + r.leads, 0)
  const totalSpend = data.reduce((s, r) => s + r.spend, 0)
  const avgCpl = totalLeads > 0 ? totalSpend / totalLeads : null
  const maxLeads = data[0]?.leads ?? 1

  function cplColor(cpl: number | null): string {
    if (cpl === null || avgCpl === null) return 'text-text-tertiary'
    if (cpl <= avgCpl * 0.9) return 'text-green-400'
    if (cpl <= avgCpl * 1.5) return 'text-amber-400'
    return 'text-red-400'
  }

  return (
    <div className="rounded-xl border border-border-subtle bg-bg-secondary p-4 md:col-span-2">
      <div className="flex items-center justify-between mb-3">
        <div>
          <p className="text-[12px] font-semibold text-text-primary">Top Campaigns by Leads</p>
          {avgCpl != null && (
            <p className="text-[11px] text-text-tertiary mt-0.5">
              Avg CPL: {fmtCurrency(avgCpl, currency)}
            </p>
          )}
        </div>
        {data.length === 0 && (
          <span className="text-[11px] text-text-tertiary">No lead conversions tracked</span>
        )}
      </div>

      {data.length === 0 ? (
        <div className="py-8 text-center">
          <p className="text-[12px] text-text-tertiary">
            No campaigns with leads found for this period.
          </p>
          <p className="text-[11px] text-text-tertiary mt-1 opacity-70">
            Make sure your Meta campaigns use lead form objectives with conversion tracking.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-border-subtle">
                <th className="pb-2 text-left text-[10.5px] font-medium uppercase tracking-wide text-text-tertiary">
                  Campaign
                </th>
                <th className="pb-2 text-right text-[10.5px] font-medium uppercase tracking-wide text-text-tertiary">
                  Leads
                </th>
                <th className="pb-2 text-right text-[10.5px] font-medium uppercase tracking-wide text-text-tertiary">
                  Spend
                </th>
                <th className="pb-2 text-right text-[10.5px] font-medium uppercase tracking-wide text-text-tertiary">
                  CPL
                </th>
                <th className="pb-2 text-right text-[10.5px] font-medium uppercase tracking-wide text-text-tertiary">
                  CTR
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle/50">
              {data.map((row) => (
                <tr key={row.id} className="hover:bg-bg-tertiary/30 transition-colors">
                  <td className="py-2.5 pr-4">
                    <p
                      className="text-text-primary font-medium truncate max-w-[200px]"
                      title={row.name}
                    >
                      {row.name || row.id}
                    </p>
                  </td>
                  <td className="py-2.5 text-right">
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-text-primary font-medium">{row.leads}</span>
                      {maxLeads > 0 && (
                        <div className="h-1 w-16 rounded-full bg-bg-tertiary overflow-hidden">
                          <div
                            className="h-full rounded-full bg-accent/60"
                            style={{ width: `${(row.leads / maxLeads) * 100}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </td>
                  <td className="py-2.5 text-right text-text-secondary">
                    {row.spend > 0 ? fmtCurrency(row.spend, currency) : '—'}
                  </td>
                  <td className={cn('py-2.5 text-right font-medium', cplColor(row.cpl))}>
                    {row.cpl != null ? fmtCurrency(row.cpl, currency) : '—'}
                  </td>
                  <td className="py-2.5 text-right text-text-secondary">
                    {row.ctr != null ? `${row.ctr.toFixed(2)}%` : '—'}
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

'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Pause, Play, Pencil, Loader2, AlertCircle, ArrowLeft, TrendingUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type Campaign = {
  id: string
  name: string
  status: string
  effective_status: string
  objective: string
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
  DELETED: 'bg-red-500/10 text-red-400',
}

function fmt(n: string | undefined): string {
  if (!n) return '—'
  const num = parseFloat(n)
  if (isNaN(num)) return '—'
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toFixed(0)
}

function fmtMoney(n: string | undefined, currency = 'USD'): string {
  if (!n) return '—'
  const num = parseFloat(n) / 100
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(num)
}

export function MetaAdsCampaigns({
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
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState<string | null>(null)
  const [editingBudget, setEditingBudget] = useState<{ id: string; current: string } | null>(null)
  const [newBudget, setNewBudget] = useState('')

  const fetchCampaigns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/ads/meta/reports?report=campaigns&ad_account_id=${activeAccountId}&date_preset=${datePreset}`,
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to load campaigns')
      }
      const json = await res.json() as { data: Campaign[] }
      setCampaigns(json.data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load campaigns')
    } finally {
      setLoading(false)
    }
  }, [activeAccountId, datePreset])

  useEffect(() => { void fetchCampaigns() }, [fetchCampaigns])

  async function toggleStatus(campaign: Campaign) {
    const newStatus = campaign.effective_status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    setMutating(campaign.id)
    try {
      const res = await fetch('/api/ads/meta/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_status',
          campaign_id: campaign.id,
          ad_account_id: activeAccountId,
          status: newStatus,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to update status')
      }
      toast.success(`Campaign ${newStatus === 'ACTIVE' ? 'enabled' : 'paused'}.`)
      setCampaigns((prev) =>
        prev.map((c) => c.id === campaign.id ? { ...c, effective_status: newStatus, status: newStatus } : c),
      )
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update campaign')
    } finally {
      setMutating(null)
    }
  }

  async function saveBudget(campaignId: string) {
    const usd = parseFloat(newBudget)
    if (isNaN(usd) || usd <= 0) {
      toast.error('Enter a valid budget amount')
      return
    }
    setMutating(campaignId)
    try {
      const res = await fetch('/api/ads/meta/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'set_daily_budget',
          campaign_id: campaignId,
          ad_account_id: activeAccountId,
          daily_budget_cents: Math.round(usd * 100),
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to update budget')
      }
      toast.success('Daily budget updated.')
      setEditingBudget(null)
      await fetchCampaigns()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update budget')
    } finally {
      setMutating(null)
    }
  }

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/ads">
              <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
              Overview
            </Link>
          </Button>
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
      ) : campaigns.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-bg-secondary px-4 py-12 text-center text-[13px] text-text-tertiary">
          No campaigns found in this account.
        </div>
      ) : (
        <div className="rounded-xl border border-border-subtle overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border-subtle bg-bg-secondary">
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Campaign</th>
                <th className="px-4 py-3 text-left text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Status</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Spend</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Impressions</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Clicks</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">CTR</th>
                <th className="px-4 py-3 text-right text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Daily Budget</th>
                <th className="px-4 py-3 text-center text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {campaigns.map((campaign) => (
                <tr key={campaign.id} className="bg-bg-primary hover:bg-bg-secondary/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-primary truncate max-w-[240px]">{campaign.name}</div>
                    <div className="text-[11px] text-text-tertiary">{campaign.objective}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', STATUS_COLORS[campaign.effective_status] ?? STATUS_COLORS.ARCHIVED)}>
                      {campaign.effective_status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-text-primary">{fmt(campaign.insights?.spend)}</td>
                  <td className="px-4 py-3 text-right text-text-primary">{fmt(campaign.insights?.impressions)}</td>
                  <td className="px-4 py-3 text-right text-text-primary">{fmt(campaign.insights?.clicks)}</td>
                  <td className="px-4 py-3 text-right text-text-tertiary">
                    {campaign.insights?.ctr ? `${parseFloat(campaign.insights.ctr).toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {editingBudget?.id === campaign.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <input
                          type="number"
                          min="1"
                          step="0.01"
                          value={newBudget}
                          onChange={(e) => setNewBudget(e.target.value)}
                          className="w-20 rounded border border-border-subtle bg-bg-secondary px-2 py-0.5 text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                          placeholder="USD"
                          autoFocus
                        />
                        <Button
                          size="sm"
                          variant="default"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => saveBudget(campaign.id)}
                          disabled={mutating === campaign.id}
                        >
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-6 px-2 text-[11px]"
                          onClick={() => setEditingBudget(null)}
                        >
                          ✕
                        </Button>
                      </div>
                    ) : (
                      <span className="text-text-secondary">
                        {campaign.daily_budget ? fmtMoney(campaign.daily_budget) : '—'}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => toggleStatus(campaign)}
                        disabled={mutating === campaign.id || !['ACTIVE', 'PAUSED'].includes(campaign.effective_status)}
                        title={campaign.effective_status === 'ACTIVE' ? 'Pause' : 'Enable'}
                      >
                        {mutating === campaign.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : campaign.effective_status === 'ACTIVE' ? (
                          <Pause className="h-3.5 w-3.5" />
                        ) : (
                          <Play className="h-3.5 w-3.5" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => {
                          setEditingBudget({ id: campaign.id, current: campaign.daily_budget ?? '0' })
                          setNewBudget(campaign.daily_budget ? String(parseFloat(campaign.daily_budget) / 100) : '')
                        }}
                        title="Edit budget"
                        disabled={!!mutating}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
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

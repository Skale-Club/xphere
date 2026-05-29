'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { Pause, Play, Pencil, Loader2, AlertCircle, ArrowLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type Campaign = {
  id: string
  name: string
  status: string
  channelType: string
  budgetAmountMicros: string
  budgetId: string
  impressions: string
  clicks: string
  costMicros: string
  conversions: string
  ctr: string
  averageCpc: string
}

const STATUS_COLORS: Record<string, string> = {
  ENABLED: 'bg-green-500/10 text-green-400',
  PAUSED: 'bg-amber-500/10 text-amber-400',
  REMOVED: 'bg-red-500/10 text-red-400',
}

function microsToUsd(micros: string | undefined): string {
  if (!micros) return '—'
  const usd = Number(micros) / 1_000_000
  return isNaN(usd) ? '—' : `$${usd.toFixed(2)}`
}

function fmtNum(n: string | undefined): string {
  if (!n) return '—'
  const num = Number(n)
  if (isNaN(num)) return '—'
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`
  return num.toFixed(0)
}

export function GoogleAdsCampaigns({
  customerId,
  customerName,
  connections,
}: {
  customerId: string
  customerName: string
  connections: { id: string; name: string }[]
}) {
  const [activeCustomerId, setActiveCustomerId] = useState(customerId)
  const [datePreset, setDatePreset] = useState('last_30d')
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState<string | null>(null)
  const [editingBudget, setEditingBudget] = useState<{ id: string; budgetId: string } | null>(null)
  const [newBudget, setNewBudget] = useState('')

  const fetchCampaigns = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/ads/google/reports?report=campaigns&customer_id=${activeCustomerId}&date_preset=${datePreset}`)
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
  }, [activeCustomerId, datePreset])

  useEffect(() => { void fetchCampaigns() }, [fetchCampaigns])

  async function toggleStatus(campaign: Campaign) {
    const newStatus = campaign.status === 'ENABLED' ? 'PAUSED' : 'ENABLED'
    setMutating(campaign.id)
    try {
      const res = await fetch('/api/ads/google/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_status', customer_id: activeCustomerId, campaign_id: campaign.id, status: newStatus }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to update status')
      }
      toast.success(`Campaign ${newStatus === 'ENABLED' ? 'enabled' : 'paused'}.`)
      setCampaigns((prev) => prev.map((c) => c.id === campaign.id ? { ...c, status: newStatus } : c))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update campaign')
    } finally {
      setMutating(null)
    }
  }

  async function saveBudget(campaign: Campaign) {
    const usd = parseFloat(newBudget)
    if (isNaN(usd) || usd <= 0) { toast.error('Enter a valid budget amount'); return }
    setMutating(campaign.id)
    try {
      const res = await fetch('/api/ads/google/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_budget', customer_id: activeCustomerId, campaign_id: campaign.id, budget_id: campaign.budgetId, daily_budget_usd: usd }),
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
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href="/ads/google"><ArrowLeft className="h-3.5 w-3.5 mr-1.5" />Overview</Link>
          </Button>
          {connections.length > 1 && (
            <select value={activeCustomerId} onChange={(e) => setActiveCustomerId(e.target.value)}
              className="rounded-lg border border-border-subtle bg-bg-secondary px-3 py-1.5 text-[12.5px] text-text-primary focus:outline-none">
              {connections.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1">
          {[{ label: 'Last 7d', value: 'last_7d' }, { label: 'Last 30d', value: 'last_30d' }, { label: 'Last 90d', value: 'last_90d' }].map((p) => (
            <button key={p.value} onClick={() => setDatePreset(p.value)}
              className={cn('rounded-[5px] px-2.5 py-1 text-[11.5px] font-medium transition-all',
                datePreset === p.value ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary')}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-text-tertiary" /></div>
      ) : error ? (
        <div className="flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
          <AlertCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      ) : campaigns.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-bg-secondary px-4 py-12 text-center text-[13px] text-text-tertiary">
          No campaigns found.
        </div>
      ) : (
        <div className="rounded-xl border border-border-subtle overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border-subtle bg-bg-secondary">
                {['Campaign', 'Status', 'Spend', 'Impressions', 'Clicks', 'CTR', 'Avg CPC', 'Conversions', 'Daily Budget', 'Actions'].map((h) => (
                  <th key={h} className={cn('px-4 py-3 text-[11px] font-medium uppercase tracking-wide text-text-tertiary',
                    h === 'Campaign' ? 'text-left' : 'text-right')}>
                    {h === 'Actions' ? <span className="block text-center">{h}</span> : h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {campaigns.map((c) => (
                <tr key={c.id} className="bg-bg-primary hover:bg-bg-secondary/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="font-medium text-text-primary truncate max-w-[200px]">{c.name}</div>
                    <div className="text-[11px] text-text-tertiary">{c.channelType?.replace('_', ' ')}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', STATUS_COLORS[c.status] ?? STATUS_COLORS.REMOVED)}>
                      {c.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right text-text-primary">{microsToUsd(c.costMicros)}</td>
                  <td className="px-4 py-3 text-right text-text-primary">{fmtNum(c.impressions)}</td>
                  <td className="px-4 py-3 text-right text-text-primary">{fmtNum(c.clicks)}</td>
                  <td className="px-4 py-3 text-right text-text-tertiary">
                    {c.ctr ? `${(Number(c.ctr) * 100).toFixed(2)}%` : '—'}
                  </td>
                  <td className="px-4 py-3 text-right text-text-tertiary">{microsToUsd(c.averageCpc)}</td>
                  <td className="px-4 py-3 text-right text-text-primary">{fmtNum(c.conversions)}</td>
                  <td className="px-4 py-3 text-right">
                    {editingBudget?.id === c.id ? (
                      <div className="flex items-center justify-end gap-1">
                        <input type="number" min="1" step="0.01" value={newBudget} onChange={(e) => setNewBudget(e.target.value)}
                          className="w-20 rounded border border-border-subtle bg-bg-secondary px-2 py-0.5 text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                          placeholder="USD" autoFocus />
                        <Button size="sm" variant="default" className="h-6 px-2 text-[11px]" onClick={() => saveBudget(c)} disabled={mutating === c.id}>Save</Button>
                        <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setEditingBudget(null)}>✕</Button>
                      </div>
                    ) : (
                      <span className="text-text-secondary">{microsToUsd(c.budgetAmountMicros)}/day</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <Button variant="ghost" size="icon-sm" onClick={() => toggleStatus(c)}
                        disabled={mutating === c.id || c.status === 'REMOVED'} title={c.status === 'ENABLED' ? 'Pause' : 'Enable'}>
                        {mutating === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> :
                          c.status === 'ENABLED' ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                      </Button>
                      <Button variant="ghost" size="icon-sm" disabled={!!mutating}
                        onClick={() => { setEditingBudget({ id: c.id, budgetId: c.budgetId }); setNewBudget(String(Number(c.budgetAmountMicros) / 1_000_000)) }}
                        title="Edit budget">
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

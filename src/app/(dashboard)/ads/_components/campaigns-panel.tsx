'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Loader2,
  AlertCircle,
  ChevronRight,
  Pause,
  Play,
  Pencil,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useCampaignsPanel } from './ads-campaigns-context'

type Insights = {
  impressions?: string
  clicks?: string
  spend?: string
  reach?: string
  cpc?: string
  cpm?: string
  ctr?: string
  actions?: Array<{ action_type: string; value: string }>
} | null

type Row = {
  id: string
  name: string
  status?: string
  effective_status?: string
  objective?: string
  daily_budget?: string
  lifetime_budget?: string
  adset_id?: string
  creative?: { thumbnail_url?: string }
  insights: Insights
}

type View =
  | { level: 'campaigns' }
  | { level: 'adsets'; campaign: { id: string; name: string } }
  | { level: 'ads'; campaign: { id: string; name: string }; adset: { id: string; name: string } }

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'bg-green-500/10 text-green-400',
  PAUSED: 'bg-amber-500/10 text-amber-400',
  ARCHIVED: 'bg-bg-tertiary text-text-tertiary',
  DELETED: 'bg-red-500/10 text-red-400',
  CAMPAIGN_PAUSED: 'bg-amber-500/10 text-amber-400',
  ADSET_PAUSED: 'bg-amber-500/10 text-amber-400',
}

function num(n: string | undefined): string {
  if (!n) return '—'
  const v = parseFloat(n)
  if (isNaN(v)) return '—'
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`
  return v.toFixed(0)
}

function money(n: string | undefined, currency: string): string {
  if (!n) return '—'
  const v = parseFloat(n)
  if (isNaN(v)) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v)
}

function budgetMoney(cents: string | undefined, currency: string): string {
  if (!cents) return '—'
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, minimumFractionDigits: 0 }).format(parseFloat(cents) / 100)
}

function ctr(ins: Insights): string {
  return ins?.ctr ? `${parseFloat(ins.ctr).toFixed(2)}%` : '—'
}

function results(ins: Insights): string {
  const a = ins?.actions
  if (!a?.length) return '—'
  const v =
    a.find((x) => x.action_type === 'purchase')?.value ??
    a.find((x) => x.action_type === 'offsite_conversion.fb_pixel_purchase')?.value ??
    a.find((x) => x.action_type === 'lead')?.value ??
    a.find((x) => x.action_type === 'onsite_conversion.lead_grouped')?.value
  return v ? num(v) : '—'
}

export function CampaignsPanel() {
  const { open, adAccountId, currency, dateQuery, closePanel } = useCampaignsPanel()

  const [view, setView] = useState<View>({ level: 'campaigns' })
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutating, setMutating] = useState<string | null>(null)
  const [editingBudget, setEditingBudget] = useState<string | null>(null)
  const [newBudget, setNewBudget] = useState('')

  // Reset to campaigns level whenever panel opens
  useEffect(() => {
    if (open) setView({ level: 'campaigns' })
  }, [open])

  const fetchRows = useCallback(async () => {
    if (!adAccountId) return
    setLoading(true)
    setError(null)
    try {
      let url = `/api/ads/meta/reports?ad_account_id=${adAccountId}&${dateQuery}`
      if (view.level === 'campaigns') url += '&report=campaigns'
      else if (view.level === 'adsets') url += `&report=adsets&campaign_id=${view.campaign.id}`
      else url += `&report=ads&adset_id=${view.adset.id}`

      const res = await fetch(url)
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error((body as { error?: string }).error ?? 'Failed to load data')
      }
      const json = (await res.json()) as { data: Row[] }
      setRows(json.data ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }, [adAccountId, dateQuery, view])

  useEffect(() => {
    if (open) void fetchRows()
  }, [open, fetchRows])

  // Escape key closes panel
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') closePanel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, closePanel])

  async function toggleStatus(row: Row) {
    const newStatus = row.effective_status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'
    setMutating(row.id)
    try {
      const res = await fetch('/api/ads/meta/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_status', campaign_id: row.id, ad_account_id: adAccountId, status: newStatus }),
      })
      if (!res.ok) throw new Error('Failed to update status')
      toast.success(`Campaign ${newStatus === 'ACTIVE' ? 'enabled' : 'paused'}.`)
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, effective_status: newStatus, status: newStatus } : r))
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update')
    } finally {
      setMutating(null)
    }
  }

  async function saveBudget(id: string) {
    const amount = parseFloat(newBudget)
    if (isNaN(amount) || amount <= 0) { toast.error('Enter a valid budget'); return }
    setMutating(id)
    try {
      const res = await fetch('/api/ads/meta/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_daily_budget', campaign_id: id, ad_account_id: adAccountId, daily_budget_cents: Math.round(amount * 100) }),
      })
      if (!res.ok) throw new Error('Failed to update budget')
      toast.success('Daily budget updated.')
      setEditingBudget(null)
      await fetchRows()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update budget')
    } finally {
      setMutating(null)
    }
  }

  const drillable = view.level !== 'ads'

  function onRowClick(row: Row) {
    if (view.level === 'campaigns') setView({ level: 'adsets', campaign: { id: row.id, name: row.name } })
    else if (view.level === 'adsets') setView({ level: 'ads', campaign: view.campaign, adset: { id: row.id, name: row.name } })
  }

  const columns =
    view.level === 'campaigns'
      ? ['Status', 'Spend', 'Impressions', 'Clicks', 'CTR', 'CPC', 'Results', 'Budget', '']
      : view.level === 'adsets'
        ? ['Status', 'Spend', 'Impressions', 'Clicks', 'CTR', 'CPC', 'Reach', 'Results']
        : ['Status', 'Spend', 'Impressions', 'Clicks', 'CTR', 'CPC']

  return (
    <div
      className={cn(
        'relative h-full flex-col border-l border-border-subtle bg-bg-primary overflow-hidden',
        'transition-[width] duration-300 ease-in-out',
        open ? 'flex w-[520px] min-w-[520px]' : 'w-0 min-w-0',
      )}
    >
      {open && (
        <>
          {/* Header */}
          <div className="flex h-12 shrink-0 items-center justify-between border-b border-border-subtle px-4">
            <div className="flex items-center gap-1.5 text-[14px]">
              <button
                onClick={() => setView({ level: 'campaigns' })}
                className={cn(
                  'font-medium transition-colors',
                  view.level === 'campaigns' ? 'text-text-primary' : 'text-text-tertiary hover:text-text-primary',
                )}
              >
                Campaigns
              </button>
              {view.level !== 'campaigns' && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
                  <button
                    onClick={() => { if (view.level === 'adsets' || view.level === 'ads') setView({ level: 'adsets', campaign: view.campaign }) }}
                    className={cn(
                      'max-w-[160px] truncate font-medium transition-colors',
                      view.level === 'adsets' ? 'text-text-primary' : 'text-text-tertiary hover:text-text-primary',
                    )}
                  >
                    {(view as { campaign: { id: string; name: string } }).campaign.name}
                  </button>
                </>
              )}
              {view.level === 'ads' && (
                <>
                  <ChevronRight className="h-3.5 w-3.5 text-text-tertiary" />
                  <span className="max-w-[160px] truncate font-medium text-text-primary">
                    {(view as { adset: { name: string } }).adset.name}
                  </span>
                </>
              )}
            </div>
            <button
              onClick={closePanel}
              className="rounded p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex justify-center py-20">
                <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
              </div>
            ) : error ? (
              <div className="m-4 flex items-center gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-[13px] text-red-400">
                <AlertCircle className="h-4 w-4 shrink-0" />{error}
              </div>
            ) : rows.length === 0 ? (
              <div className="px-5 py-16 text-center text-[13px] text-text-tertiary">
                Nothing to show here for the selected period.
              </div>
            ) : (
              <table className="w-full text-[13px]">
                <thead className="sticky top-0 z-10 bg-bg-secondary">
                  <tr className="border-b border-border-subtle">
                    <th className="px-4 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                      {view.level === 'campaigns' ? 'Campaign' : view.level === 'adsets' ? 'Ad set' : 'Ad'}
                    </th>
                    {columns.map((c, i) => (
                      <th
                        key={i}
                        className={cn(
                          'px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-text-tertiary',
                          c === '' ? 'text-center' : 'text-right',
                        )}
                      >
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {rows.map((row) => (
                    <tr
                      key={row.id}
                      onClick={() => drillable && onRowClick(row)}
                      className={cn(
                        'bg-bg-primary transition-colors',
                        drillable && 'cursor-pointer hover:bg-bg-secondary/60',
                      )}
                    >
                      <td className="px-4 py-2.5">
                        <div className="flex items-center gap-2">
                          {row.creative?.thumbnail_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={row.creative.thumbnail_url} alt="" className="h-7 w-7 shrink-0 rounded object-cover" />
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5 truncate font-medium text-text-primary">
                              <span className="max-w-[180px] truncate">{row.name}</span>
                              {drillable && <ChevronRight className="h-3 w-3 shrink-0 text-text-tertiary" />}
                            </div>
                            {row.objective && <div className="text-[11px] text-text-tertiary">{row.objective}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span className={cn('rounded-full px-2 py-0.5 text-[10.5px] font-medium', STATUS_COLORS[row.effective_status ?? ''] ?? STATUS_COLORS.ARCHIVED)}>
                          {row.effective_status}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-right text-text-primary">{money(row.insights?.spend, currency)}</td>
                      <td className="px-4 py-2.5 text-right text-text-primary">{num(row.insights?.impressions)}</td>
                      <td className="px-4 py-2.5 text-right text-text-primary">{num(row.insights?.clicks)}</td>
                      <td className="px-4 py-2.5 text-right text-text-tertiary">{ctr(row.insights)}</td>
                      <td className="px-4 py-2.5 text-right text-text-tertiary">{money(row.insights?.cpc, currency)}</td>
                      {view.level === 'adsets' && (
                        <td className="px-4 py-2.5 text-right text-text-tertiary">{num(row.insights?.reach)}</td>
                      )}
                      {view.level !== 'ads' && (
                        <td className="px-4 py-2.5 text-right text-text-primary">{results(row.insights)}</td>
                      )}
                      {view.level === 'campaigns' && (
                        <>
                          <td className="px-4 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                            {editingBudget === row.id ? (
                              <div className="flex items-center justify-end gap-1">
                                <input
                                  type="number" min="1" step="0.01" value={newBudget}
                                  onChange={(e) => setNewBudget(e.target.value)}
                                  className="w-20 rounded border border-border-subtle bg-bg-secondary px-2 py-0.5 text-[12px] text-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
                                  autoFocus
                                />
                                <Button size="sm" className="h-6 px-2 text-[11px]" onClick={() => saveBudget(row.id)} disabled={mutating === row.id}>Save</Button>
                                <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setEditingBudget(null)}>✕</Button>
                              </div>
                            ) : (
                              <span className="text-text-secondary">{budgetMoney(row.daily_budget, currency)}</span>
                            )}
                          </td>
                          <td className="px-4 py-2.5" onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center justify-center gap-1">
                              <Button
                                variant="ghost" size="icon-sm"
                                onClick={() => toggleStatus(row)}
                                disabled={mutating === row.id || !['ACTIVE', 'PAUSED'].includes(row.effective_status ?? '')}
                                title={row.effective_status === 'ACTIVE' ? 'Pause' : 'Enable'}
                              >
                                {mutating === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  : row.effective_status === 'ACTIVE' ? <Pause className="h-3.5 w-3.5" />
                                  : <Play className="h-3.5 w-3.5" />}
                              </Button>
                              <Button
                                variant="ghost" size="icon-sm"
                                onClick={() => { setEditingBudget(row.id); setNewBudget(row.daily_budget ? String(parseFloat(row.daily_budget) / 100) : '') }}
                                title="Edit daily budget" disabled={!!mutating}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}

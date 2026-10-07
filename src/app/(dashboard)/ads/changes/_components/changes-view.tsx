'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { ChangeView } from '@/lib/ads/commands/engine'
import type { ChangeStatus } from '@/lib/ads/commands/types'
import { ChangeRow } from './change-row'
import { ChangeDetailSheet } from './change-detail-sheet'
import { ApproveDialog } from './approve-dialog'
import { CancelDialog } from './cancel-dialog'
import { PoliciesPanel } from './policies-panel'
import { BatchBar } from './batch-bar'

type Tab = 'pending' | 'in_progress' | 'history'

const TAB_STATUSES: Record<Tab, ChangeStatus[]> = {
  pending: ['awaiting_approval'],
  in_progress: ['queued', 'executing', 'verifying'],
  history: ['succeeded', 'failed', 'drifted', 'cancelled', 'expired'],
}

const TAB_LABELS: Record<Tab, string> = {
  pending: 'Pending approval',
  in_progress: 'In progress',
  history: 'History',
}

type EngineActionResponse = { ok: boolean; error?: string; code?: string; change?: ChangeView }

/**
 * Pending batches (2+ changes sharing a batch_id) get their own card with an
 * "Approve all" bar; everything else stays in one list, in the API's order.
 */
function groupByBatch(changes: ChangeView[], groupBatches: boolean) {
  if (!groupBatches) return [{ key: 'all', batchId: null as string | null, changes }]
  const counts = new Map<string, number>()
  for (const c of changes) if (c.batch_id) counts.set(c.batch_id, (counts.get(c.batch_id) ?? 0) + 1)
  const groups: Array<{ key: string; batchId: string | null; changes: ChangeView[] }> = []
  const loose: ChangeView[] = []
  const byBatch = new Map<string, ChangeView[]>()
  for (const c of changes) {
    if (c.batch_id && (counts.get(c.batch_id) ?? 0) > 1) {
      if (!byBatch.has(c.batch_id)) {
        const list: ChangeView[] = []
        byBatch.set(c.batch_id, list)
        groups.push({ key: c.batch_id, batchId: c.batch_id, changes: list })
      }
      byBatch.get(c.batch_id)!.push(c)
    } else {
      loose.push(c)
    }
  }
  if (loose.length) groups.push({ key: 'loose', batchId: null, changes: loose })
  return groups
}

export function ChangesView({
  initialChanges,
  accounts,
  canAdmin,
}: {
  initialChanges: ChangeView[]
  accounts: { platform: 'meta' | 'google' | 'google_business'; adAccountId: string; adAccountName: string | null }[]
  canAdmin: boolean
}) {
  const [tab, setTab] = useState<Tab>('pending')
  const [platformFilter, setPlatformFilter] = useState<'all' | 'meta' | 'google' | 'google_business'>('all')
  const [changes, setChanges] = useState<ChangeView[]>(initialChanges)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mutatingId, setMutatingId] = useState<string | null>(null)

  const [detailId, setDetailId] = useState<string | null>(null)
  const [approveTarget, setApproveTarget] = useState<ChangeView | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ChangeView | null>(null)

  const fetchChanges = useCallback(async (nextTab: Tab, nextPlatform: 'all' | 'meta' | 'google' | 'google_business') => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams({ status: TAB_STATUSES[nextTab].join(',') })
      if (nextPlatform !== 'all') params.set('platform', nextPlatform)
      const res = await fetch(`/api/ads/changes?${params.toString()}`)
      if (!res.ok) throw new Error('Failed to load changes')
      const json = (await res.json()) as { changes: ChangeView[] }
      setChanges(json.changes)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load changes')
    } finally {
      setLoading(false)
    }
  }, [])

  // Skip the very first fetch for the default tab/filter — the server already
  // supplied that page.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (!hydrated) {
      setHydrated(true)
      return
    }
    void fetchChanges(tab, platformFilter)
  }, [tab, platformFilter, fetchChanges, hydrated])

  function refresh() {
    void fetchChanges(tab, platformFilter)
  }

  function upsertLocal(updated: ChangeView) {
    setChanges((prev) => {
      const stillBelongs = TAB_STATUSES[tab].includes(updated.status)
      if (!stillBelongs) return prev.filter((c) => c.id !== updated.id)
      const idx = prev.findIndex((c) => c.id === updated.id)
      if (idx === -1) return prev
      const next = [...prev]
      next[idx] = updated
      return next
    })
  }

  async function postAction(change: ChangeView, action: 'retry' | 'rollback'): Promise<void> {
    setMutatingId(change.id)
    try {
      const res = await fetch(`/api/ads/changes/${change.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = (await res.json().catch(() => ({}))) as EngineActionResponse
      if (!res.ok || !body.ok || !body.change) {
        toast.error(body.error ?? `Failed to ${action === 'retry' ? 'retry' : 'roll back'} this change`)
        return
      }
      toast.success(
        action === 'retry'
          ? 'Re-previewed against the current state — review it below.'
          : 'Rollback previewed — review it below.',
      )
      // The new change is a fresh preview (awaiting_approval): switch to the
      // Pending tab and offer to approve it right away.
      setTab('pending')
      setPlatformFilter('all')
      setApproveTarget(body.change)
      await fetchChanges('pending', 'all')
    } catch {
      toast.error(`Failed to ${action === 'retry' ? 'retry' : 'roll back'} this change`)
    } finally {
      setMutatingId(null)
    }
  }

  return (
    <div className="space-y-4 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold text-text-primary">Changes</h1>
          <p className="max-w-2xl text-[12.5px] text-text-secondary">
            Every write to Google Ads, Meta Ads or Google Business Profile — from the dashboard, workflows or an AI client — passes through here.
          </p>
        </div>
        <div className="shrink-0">
          <PoliciesPanel accounts={accounts} canAdmin={canAdmin} />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
          <TabsList>
            {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
              <TabsTrigger key={t} value={t}>{TAB_LABELS[t]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Select value={platformFilter} onValueChange={(v) => setPlatformFilter(v as 'all' | 'meta' | 'google' | 'google_business')}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All platforms</SelectItem>
            <SelectItem value="meta">Meta Ads</SelectItem>
            <SelectItem value="google">Google Ads</SelectItem>
            <SelectItem value="google_business">Google Business</SelectItem>
          </SelectContent>
        </Select>
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
      ) : changes.length === 0 ? (
        <div className="rounded-lg border border-border-subtle bg-bg-secondary px-4 py-16 text-center text-[13px] text-text-tertiary">
          {tab === 'pending' && 'Nothing waiting for approval.'}
          {tab === 'in_progress' && 'Nothing in progress right now.'}
          {tab === 'history' && 'No completed changes yet.'}
        </div>
      ) : (
        <div className="space-y-3">
          {groupByBatch(changes, tab === 'pending').map((group) => (
            <div key={group.key} className="rounded-xl border border-border-subtle overflow-hidden">
              {group.batchId && <BatchBar batchId={group.batchId} changes={group.changes} onDone={refresh} />}
              {group.changes.map((change) => (
                <ChangeRow
                  key={change.id}
                  change={change}
                  busy={mutatingId === change.id}
                  onOpenDetail={() => setDetailId(change.id)}
                  onApprove={() => setApproveTarget(change)}
                  onCancel={() => setCancelTarget(change)}
                  onRetry={() => void postAction(change, 'retry')}
                  onRollback={() => void postAction(change, 'rollback')}
                />
              ))}
            </div>
          ))}
        </div>
      )}

      <ChangeDetailSheet changeId={detailId} onOpenChange={(open) => !open && setDetailId(null)} />

      <ApproveDialog
        change={approveTarget}
        open={!!approveTarget}
        onOpenChange={(open) => !open && setApproveTarget(null)}
        onApproved={(updated) => {
          upsertLocal(updated)
          refresh()
        }}
      />

      <CancelDialog
        change={cancelTarget}
        open={!!cancelTarget}
        onOpenChange={(open) => !open && setCancelTarget(null)}
        onCancelled={(updated) => {
          upsertLocal(updated)
          refresh()
        }}
      />
    </div>
  )
}

'use client'

import { useState } from 'react'
import { Layers, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import type { ChangeView } from '@/lib/ads/commands/engine'

/**
 * One bar per pending batch (e.g. a list of negative keywords an AI proposed
 * from a search-terms review). Approving applies each change in turn — every
 * change still gets its own policy, conflict and read-back checks.
 */
export function BatchBar({
  batchId,
  changes,
  onDone,
}: {
  batchId: string
  changes: ChangeView[]
  onDone: () => void
}) {
  const [confirm, setConfirm] = useState<'approve' | 'cancel' | null>(null)
  const [busy, setBusy] = useState(false)

  async function run(action: 'approve' | 'cancel') {
    setBusy(true)
    try {
      const res = await fetch(`/api/ads/changes/batches/${batchId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const body = (await res.json().catch(() => ({}))) as {
        error?: string
        total?: number
        applied?: number
        cancelled?: number
        results?: Array<{ ok: boolean; error?: string }>
      }
      if (!res.ok) {
        toast.error(body.error ?? 'Batch action failed')
        return
      }
      if (action === 'approve') {
        const failed = (body.results ?? []).filter((r) => !r.ok)
        if (failed.length === 0) toast.success(`Applied ${body.applied ?? 0} of ${body.total ?? 0} changes`)
        else toast.warning(`Applied ${body.applied ?? 0} of ${body.total ?? 0}; ${failed.length} failed — ${failed[0]?.error ?? 'see History'}`)
      } else {
        toast.success(`Cancelled ${body.cancelled ?? 0} changes`)
      }
      onDone()
    } catch {
      toast.error('Batch action failed')
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  const needsApprover = changes.some((c) => c.approval_required)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle bg-bg-secondary px-4 py-2.5">
      <div className="flex items-center gap-2 text-[12.5px] text-text-secondary">
        <Layers className="h-3.5 w-3.5" />
        <span>
          Batch of <span className="font-medium text-text-primary">{changes.length}</span> changes
          {changes[0]?.actor_label ? ` from ${changes[0].actor_label}` : ''}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm('cancel')}>
          Cancel all
        </Button>
        <Button size="sm" disabled={busy} onClick={() => setConfirm('approve')}>
          {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
          Approve all
        </Button>
      </div>

      <AlertDialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirm === 'approve' ? `Apply ${changes.length} changes?` : `Cancel ${changes.length} changes?`}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <ul className="max-h-60 space-y-1 overflow-y-auto text-[12.5px]">
                  {changes.map((c) => (
                    <li key={c.id}>
                      <span className="text-text-primary">{c.label}</span>
                      {c.resource_name ? ` · ${c.resource_name}` : ''}
                      {c.diff[0] ? ` — ${c.diff[0].beforeDisplay} → ${c.diff[0].afterDisplay}` : ''}
                    </li>
                  ))}
                </ul>
                {confirm === 'approve' && needsApprover && (
                  <p className="text-[12px] text-amber-400">
                    Some of these need the ads.approve permission; any you can&apos;t approve will be reported as failed.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault()
                if (confirm) void run(confirm)
              }}
            >
              {confirm === 'approve' ? 'Apply all' : 'Cancel all'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

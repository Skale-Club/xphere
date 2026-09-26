'use client'

import { useState } from 'react'
import { AlertTriangle, ShieldAlert } from 'lucide-react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { ChangeView } from '@/lib/ads/commands/engine'
import { platformLabel, riskBadgeVariant, riskLabel } from './format'

type EngineActionResponse = {
  ok: boolean
  error?: string
  code?: string
  change?: ChangeView
}

export function ApproveDialog({
  change,
  open,
  onOpenChange,
  onApproved,
}: {
  change: ChangeView | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onApproved: (updated: ChangeView) => void
}) {
  const [submitting, setSubmitting] = useState(false)

  async function approve() {
    if (!change) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/ads/changes/${change.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      const body = (await res.json().catch(() => ({}))) as EngineActionResponse
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? 'Failed to approve change')
        if (body.change) onApproved(body.change)
        return
      }
      toast.success('Change approved and applied.')
      if (body.change) onApproved(body.change)
      onOpenChange(false)
    } catch {
      toast.error('Failed to approve change')
    } finally {
      setSubmitting(false)
    }
  }

  if (!change) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Approve {change.label.toLowerCase()}</DialogTitle>
          <DialogDescription>
            {platformLabel(change.platform)} · {change.resource_name ?? change.resource_id ?? change.ad_account_id}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant={riskBadgeVariant(change.risk_level)}>{riskLabel(change.risk_level)}</Badge>
            <span className="text-[12px] text-text-tertiary">Risk level {change.risk_level}</span>
          </div>

          <div className="rounded-lg border border-border-subtle overflow-hidden">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-border-subtle bg-bg-secondary">
                  <th className="px-3 py-2 text-left font-medium text-text-tertiary">Field</th>
                  <th className="px-3 py-2 text-left font-medium text-text-tertiary">Before</th>
                  <th className="px-3 py-2 text-left font-medium text-text-tertiary">After</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {change.diff.map((d, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 text-text-secondary">{d.label}</td>
                    <td className="px-3 py-2 text-text-primary">{d.beforeDisplay}</td>
                    <td className="px-3 py-2 font-medium text-text-primary">{d.afterDisplay}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {change.approval_reasons.length > 0 && (
            <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-amber-400">
                <ShieldAlert className="h-3.5 w-3.5" />
                Why this needs approval
              </div>
              <ul className="space-y-1 text-[12px] text-amber-300/90">
                {change.approval_reasons.map((r, i) => <li key={i}>· {r.message}</li>)}
              </ul>
            </div>
          )}

          {change.warnings.length > 0 && (
            <div className="rounded-lg border border-border-subtle bg-bg-secondary p-3">
              <div className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-medium text-text-secondary">
                <AlertTriangle className="h-3.5 w-3.5" />
                Warnings
              </div>
              <ul className="space-y-1 text-[12px] text-text-tertiary">
                {change.warnings.map((w, i) => <li key={i}>· {w}</li>)}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Not now
          </Button>
          <Button variant="primary" onClick={approve} loading={submitting}>
            Approve and apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

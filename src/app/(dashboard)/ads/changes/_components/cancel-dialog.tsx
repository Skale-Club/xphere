'use client'

import { useState } from 'react'
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
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import type { ChangeView } from '@/lib/ads/commands/engine'

type EngineActionResponse = { ok: boolean; error?: string; change?: ChangeView }

export function CancelDialog({
  change,
  open,
  onOpenChange,
  onCancelled,
}: {
  change: ChangeView | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancelled: (updated: ChangeView) => void
}) {
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function confirmCancel() {
    if (!change) return
    setSubmitting(true)
    try {
      const res = await fetch(`/api/ads/changes/${change.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'cancel', reason: reason.trim() || undefined }),
      })
      const body = (await res.json().catch(() => ({}))) as EngineActionResponse
      if (!res.ok || !body.ok) {
        toast.error(body.error ?? 'Failed to cancel change')
        return
      }
      toast.success('Change cancelled.')
      if (body.change) onCancelled(body.change)
      onOpenChange(false)
      setReason('')
    } catch {
      toast.error('Failed to cancel change')
    } finally {
      setSubmitting(false)
    }
  }

  if (!change) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle>Cancel this change?</DialogTitle>
          <DialogDescription>
            {change.label} · {change.resource_name ?? change.resource_id ?? change.ad_account_id}. It will not be applied.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-1.5">
          <Label htmlFor="cancel-reason">Reason (optional)</Label>
          <Textarea
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this being cancelled?"
            rows={3}
          />
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
            Keep it
          </Button>
          <Button variant="destructive" onClick={confirmCancel} loading={submitting}>
            Cancel change
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

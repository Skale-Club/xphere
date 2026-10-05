'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Check, RotateCcw, X } from 'lucide-react'
import { toast } from 'sonner'

import { approveGbpChange, rejectGbpChange, rollbackGbpChange } from '@/app/(dashboard)/local-seo/gbp-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { describeValue, FIELD_LABEL } from '@/lib/gbp/profile'

export type ChangeView = {
  id: string
  commandType: string
  status: string
  actorLabel: string | null
  actorType: string
  createdAt: string
  completedAt: string | null
  errorMessage: string | null
  diff: { field: string; before: unknown; after: unknown }[]
  rollbackOf: string | null
}

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'secondary' }> = {
  awaiting_approval: { label: 'Needs approval', variant: 'warning' },
  queued: { label: 'Queued', variant: 'info' },
  executing: { label: 'Publishing', variant: 'info' },
  succeeded: { label: 'Published', variant: 'success' },
  failed: { label: 'Failed', variant: 'danger' },
  drifted: { label: 'Out of date', variant: 'danger' },
  cancelled: { label: 'Cancelled', variant: 'secondary' },
  rejected: { label: 'Rejected', variant: 'secondary' },
}

const COMMAND: Record<string, string> = {
  'review.reply': 'Reply to review',
  'review.delete_reply': 'Delete reply',
  'profile.update': 'Profile edit',
  'post.create': 'Publish post',
  'post.delete': 'Delete post',
}

export function GbpChangeList({
  locationId,
  changes,
  canApprove,
  emptyText = 'Nothing here yet.',
}: {
  locationId: string
  changes: ChangeView[]
  canApprove: boolean
  emptyText?: string
}) {
  const router = useRouter()
  const [busy, start] = useTransition()

  function act(fn: () => Promise<{ error: string } | { message?: string; status?: string } | { ok: true }>) {
    start(async () => {
      const res = await fn()
      if ('error' in res) toast.error(res.error)
      else {
        if ('message' in res && res.message) toast.success(res.message)
        router.refresh()
      }
    })
  }

  if (!changes.length) return <p className="text-sm text-text-secondary">{emptyText}</p>

  return (
    <ul className="space-y-2">
      {changes.map((c) => {
        const s = STATUS[c.status] ?? { label: c.status, variant: 'secondary' as const }
        return (
          <li key={c.id} className="space-y-2 rounded-lg border border-border-subtle p-3 text-[13px]">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="font-medium text-text-primary">{COMMAND[c.commandType] ?? c.commandType}</span>
                {c.rollbackOf && <Badge variant="secondary">Rollback</Badge>}
                <Badge variant={s.variant}>{s.label}</Badge>
              </div>
              <span className="text-text-tertiary">
                {c.actorLabel ?? c.actorType} · {new Date(c.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </span>
            </div>
            {c.diff.map((d, i) => (
              <div key={i} className="grid gap-1 sm:grid-cols-[120px_1fr]">
                <span className="text-text-tertiary">{FIELD_LABEL[d.field] ?? (d.field === 'reply' ? 'Reply' : d.field === 'post' ? 'Post' : d.field)}</span>
                <span className="whitespace-pre-wrap break-words">
                  {d.before !== null && d.before !== undefined && <span className="text-text-tertiary line-through">{describeValue(d.field, d.before)}</span>}
                  {d.before !== null && d.before !== undefined && d.after !== null && ' → '}
                  {d.after !== null && d.after !== undefined && <span className="text-text-primary">{describeValue(d.field, d.after)}</span>}
                </span>
              </div>
            ))}
            {c.errorMessage && c.status !== 'succeeded' && <div className="text-danger">{c.errorMessage}</div>}
            {canApprove && (
              <div className="flex gap-2">
                {c.status === 'awaiting_approval' && (
                  <>
                    <Button size="sm" disabled={busy} onClick={() => act(() => approveGbpChange(c.id, locationId))}>
                      <Check className="h-4 w-4" />
                      Approve & publish
                    </Button>
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => rejectGbpChange(c.id, locationId))}>
                      <X className="h-4 w-4" />
                      Reject
                    </Button>
                  </>
                )}
                {c.status === 'succeeded' && c.commandType === 'profile.update' && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => act(() => rollbackGbpChange(c.id, locationId))}>
                    <RotateCcw className="h-4 w-4" />
                    Roll back
                  </Button>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

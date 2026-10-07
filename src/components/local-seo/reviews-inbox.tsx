'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Send, Sparkles, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { deleteReply, draftReplyWithAi, submitReply } from '@/app/(dashboard)/seo/local/gbp-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { usePathname } from '@/lib/org/navigation'
import { cn } from '@/lib/utils'

export type InboxReview = {
  id: string
  reviewer: string | null
  rating: number | null
  comment: string | null
  createdAt: string | null
  reply: string | null
  replyState: 'none' | 'pending' | 'replied'
  draft: { id: string; text: string } | null
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'unreplied', label: 'Unreplied' },
  { key: 'negative', label: '1–3 stars' },
]

function Stars({ n }: { n: number | null }) {
  return (
    <span className="inline-flex" aria-label={`${n ?? 0} stars`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} className={cn('h-3.5 w-3.5', i <= (n ?? 0) ? 'fill-amber-400 text-amber-400' : 'text-border')} />
      ))}
    </span>
  )
}

function ReviewCard({ review, locationId, canManage, canApprove, readOnly }: { review: InboxReview; locationId: string; canManage: boolean; canApprove: boolean; readOnly?: boolean }) {
  const router = useRouter()
  const [text, setText] = useState(review.draft?.text ?? '')
  const [draftId, setDraftId] = useState(review.draft?.id ?? null)
  const [editing, setEditing] = useState(!!review.draft && review.replyState === 'none')
  const [aiBusy, startAi] = useTransition()
  const [busy, start] = useTransition()
  const negative = (review.rating ?? 5) <= 3

  function draftAi() {
    startAi(async () => {
      const res = await draftReplyWithAi(review.id)
      if ('error' in res) toast.error(res.error)
      else {
        setText(res.text)
        setDraftId(res.draftId)
        setEditing(true)
      }
    })
  }

  function send() {
    start(async () => {
      const res = await submitReply({ reviewId: review.id, locationId, text, draftId })
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(res.message)
        setEditing(false)
        router.refresh()
      }
    })
  }

  function remove() {
    start(async () => {
      const res = await deleteReply(review.id, locationId)
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(res.message)
        router.refresh()
      }
    })
  }

  return (
    <li className={cn('space-y-3 rounded-xl border p-4', negative && review.replyState === 'none' ? 'border-danger/30' : 'border-border-subtle')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-text-primary">{review.reviewer ?? 'Anonymous'}</span>
          <Stars n={review.rating} />
        </div>
        <div className="flex items-center gap-2 text-[12px] text-text-tertiary">
          {review.createdAt && new Date(review.createdAt).toLocaleDateString()}
          {review.replyState === 'pending' && <Badge variant="warning">Reply pending</Badge>}
          {review.replyState === 'none' && !readOnly && <Badge variant={negative ? 'danger' : 'secondary'}>No reply</Badge>}
        </div>
      </div>
      {review.comment ? (
        <p className="whitespace-pre-wrap text-[13.5px] text-text-primary">{review.comment}</p>
      ) : (
        <p className="text-[13px] italic text-text-tertiary">Rating only, no text.</p>
      )}
      {review.reply && !editing && (
        <div className="rounded-lg bg-bg-secondary p-3 text-[13px]">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Your reply</div>
          <p className="whitespace-pre-wrap text-text-primary">{review.reply}</p>
        </div>
      )}
      {!readOnly && canManage && (
        <>
          {editing ? (
            <div className="space-y-2">
              <Textarea rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a reply…" maxLength={4000} />
              {negative && !canApprove && <p className="text-xs text-text-tertiary">Replies to 1–3 star reviews are sent to an approver first.</p>}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={send} loading={busy} disabled={!text.trim()}>
                  <Send className="h-4 w-4" />
                  {canApprove ? 'Publish reply' : 'Send for approval'}
                </Button>
                <Button size="sm" variant="secondary" onClick={draftAi} disabled={aiBusy}>
                  {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                  {text ? 'Redraft with AI' : 'Draft with AI'}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            review.replyState !== 'pending' && (
              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    if (!text && review.reply) setText(review.reply)
                    setEditing(true)
                  }}
                >
                  {review.reply ? 'Edit reply' : 'Reply'}
                </Button>
                {!review.reply && (
                  <Button size="sm" variant="ghost" onClick={draftAi} disabled={aiBusy}>
                    {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    Draft with AI
                  </Button>
                )}
                {review.reply && (
                  <Button size="sm" variant="ghost" onClick={remove} disabled={busy}>
                    <Trash2 className="h-4 w-4" />
                    Delete reply
                  </Button>
                )}
              </div>
            )
          )}
        </>
      )}
    </li>
  )
}

export function ReviewsInbox({
  locationId,
  reviews,
  canManage,
  canApprove,
  readOnly,
  filter = 'all',
}: {
  locationId: string
  reviews: InboxReview[]
  canManage: boolean
  canApprove: boolean
  readOnly?: boolean
  filter?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  return (
    <div className="space-y-3">
      {!readOnly && (
        <div className="flex items-center gap-1 rounded-lg bg-bg-tertiary p-1 w-fit">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => router.push(f.key === 'all' ? pathname : `${pathname}?filter=${f.key}`)}
              className={cn(
                'h-7 rounded-[6px] px-3 text-[12.5px] font-medium',
                filter === f.key ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
      {reviews.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border p-10 text-center text-sm text-text-secondary">No reviews to show.</div>
      ) : (
        <ul className="space-y-3">
          {reviews.map((r) => (
            <ReviewCard key={r.id} review={r} locationId={locationId} canManage={canManage} canApprove={canApprove} readOnly={readOnly} />
          ))}
        </ul>
      )}
    </div>
  )
}

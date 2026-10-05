'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CalendarClock, ExternalLink, Plus, Repeat, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { deletePost, savePost, type PostInput } from '@/app/(dashboard)/local-seo/gbp-actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'

type DateParts = { year: number; month: number; day: number }
type TimeParts = { hours?: number; minutes?: number }

export type PostView = {
  id: string
  topicType: 'STANDARD' | 'EVENT' | 'OFFER' | 'ALERT'
  summary: string
  mediaUrl: string | null
  ctaType: PostInput['ctaType']
  ctaUrl: string | null
  event: { title?: string; schedule?: { startDate: DateParts; startTime?: TimeParts; endDate: DateParts; endTime?: TimeParts } | null } | null
  offer: { couponCode?: string } | null
  recurrence: 'none' | 'weekly' | 'monthly'
  status: 'draft' | 'scheduled' | 'publishing' | 'live' | 'failed' | 'deleted'
  scheduledFor: string | null
  publishedAt: string | null
  searchUrl: string | null
  error: string | null
}

const STATUS_BADGE: Record<PostView['status'], 'secondary' | 'info' | 'success' | 'danger' | 'warning'> = {
  draft: 'secondary',
  scheduled: 'info',
  publishing: 'info',
  live: 'success',
  failed: 'danger',
  deleted: 'secondary',
}

const NONE = '__none__'

function partsToLocal(d?: DateParts, t?: TimeParts): string {
  if (!d) return ''
  const dt = new Date(Date.UTC(d.year, d.month - 1, d.day, t?.hours ?? 0, t?.minutes ?? 0))
  return toLocalInput(dt.toISOString())
}

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const off = d.getTimezoneOffset() * 60_000
  return new Date(d.getTime() - off).toISOString().slice(0, 16)
}

function emptyForm(): PostInput {
  return {
    topicType: 'STANDARD',
    summary: '',
    mediaUrl: null,
    ctaType: null,
    ctaUrl: null,
    eventTitle: null,
    startAt: null,
    endAt: null,
    couponCode: null,
    recurrence: 'none',
    scheduledFor: null,
  }
}

function fromView(p: PostView): PostInput {
  const s = p.event?.schedule
  return {
    topicType: p.topicType,
    summary: p.summary,
    mediaUrl: p.mediaUrl,
    ctaType: p.ctaType,
    ctaUrl: p.ctaUrl,
    eventTitle: p.event?.title ?? null,
    startAt: s ? partsToLocal(s.startDate, s.startTime) : null,
    endAt: s ? partsToLocal(s.endDate, s.endTime) : null,
    couponCode: p.offer?.couponCode ?? null,
    recurrence: p.recurrence,
    scheduledFor: toLocalInput(p.scheduledFor),
  }
}

export function PostsBoard({ locationId, posts, canManage, canApprove }: { locationId: string; posts: PostView[]; canManage: boolean; canApprove: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | undefined>()
  const [form, setForm] = useState<PostInput>(emptyForm())
  const [busy, start] = useTransition()
  const set = <K extends keyof PostInput>(k: K, v: PostInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  function openNew() {
    setEditingId(undefined)
    setForm(emptyForm())
    setOpen(true)
  }

  function openEdit(p: PostView) {
    setEditingId(p.id)
    setForm(fromView(p))
    setOpen(true)
  }

  function save(mode: 'draft' | 'schedule' | 'publish') {
    const iso = (v: string | null) => (v ? new Date(v).toISOString() : null)
    const payload: PostInput = {
      ...form,
      mediaUrl: form.mediaUrl || null,
      ctaUrl: form.ctaUrl || null,
      eventTitle: form.eventTitle || null,
      couponCode: form.couponCode || null,
      startAt: iso(form.startAt),
      endAt: iso(form.endAt),
      scheduledFor: iso(form.scheduledFor),
    }
    start(async () => {
      const res = await savePost(locationId, payload, mode, editingId)
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(res.message)
        setOpen(false)
        router.refresh()
      }
    })
  }

  function remove(p: PostView) {
    start(async () => {
      const res = await deletePost(p.id, locationId)
      if ('error' in res) toast.error(res.error)
      else {
        toast.success(res.message)
        router.refresh()
      }
    })
  }

  const scheduled = posts.filter((p) => p.status === 'scheduled').sort((a, b) => (a.scheduledFor ?? '').localeCompare(b.scheduledFor ?? ''))
  const others = posts.filter((p) => p.status !== 'scheduled')
  const needsEvent = form.topicType === 'EVENT' || form.topicType === 'OFFER'

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[13px] text-text-secondary">Posts show on your Google profile. Regular posts are a ranking and conversion signal.</p>
        {canManage && (
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4" />
            New post
          </Button>
        )}
      </div>

      {scheduled.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-text-primary">Scheduled</h3>
          {scheduled.map((p) => (
            <PostRow key={p.id} post={p} canManage={canManage} onEdit={() => openEdit(p)} onDelete={() => remove(p)} />
          ))}
        </section>
      )}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold text-text-primary">All posts</h3>
        {others.length === 0 && <p className="text-sm text-text-secondary">No posts yet.</p>}
        {others.map((p) => (
          <PostRow key={p.id} post={p} canManage={canManage} onEdit={() => openEdit(p)} onDelete={() => remove(p)} />
        ))}
      </section>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingId ? 'Edit post' : 'New post'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={form.topicType} onValueChange={(v) => set('topicType', v as PostInput['topicType'])}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="STANDARD">Update</SelectItem>
                  <SelectItem value="EVENT">Event</SelectItem>
                  <SelectItem value="OFFER">Offer</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {needsEvent && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="pp-title">Title</Label>
                  <Input id="pp-title" maxLength={58} value={form.eventTitle ?? ''} onChange={(e) => set('eventTitle', e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-start">Starts</Label>
                    <Input id="pp-start" type="datetime-local" value={form.startAt ?? ''} onChange={(e) => set('startAt', e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-end">Ends</Label>
                    <Input id="pp-end" type="datetime-local" value={form.endAt ?? ''} onChange={(e) => set('endAt', e.target.value)} />
                  </div>
                </div>
                {form.topicType === 'OFFER' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="pp-coupon">Coupon code</Label>
                    <Input id="pp-coupon" maxLength={58} value={form.couponCode ?? ''} onChange={(e) => set('couponCode', e.target.value)} />
                  </div>
                )}
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="pp-summary">Text</Label>
              <Textarea id="pp-summary" rows={5} maxLength={1500} value={form.summary} onChange={(e) => set('summary', e.target.value)} />
              <p className="text-right text-xs text-text-tertiary">{form.summary.length}/1500</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pp-media">Photo URL</Label>
              <Input id="pp-media" placeholder="https://… (public JPG or PNG)" value={form.mediaUrl ?? ''} onChange={(e) => set('mediaUrl', e.target.value)} />
            </div>
            <div className="grid grid-cols-[150px_1fr] gap-2">
              <div className="space-y-1.5">
                <Label>Button</Label>
                <Select value={form.ctaType ?? NONE} onValueChange={(v) => set('ctaType', v === NONE ? null : (v as PostInput['ctaType']))}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE}>None</SelectItem>
                    <SelectItem value="BOOK">Book</SelectItem>
                    <SelectItem value="ORDER">Order</SelectItem>
                    <SelectItem value="SHOP">Shop</SelectItem>
                    <SelectItem value="LEARN_MORE">Learn more</SelectItem>
                    <SelectItem value="SIGN_UP">Sign up</SelectItem>
                    <SelectItem value="CALL">Call</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pp-cta">Link</Label>
                <Input id="pp-cta" disabled={!form.ctaType || form.ctaType === 'CALL'} value={form.ctaUrl ?? ''} onChange={(e) => set('ctaUrl', e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="pp-when">Publish at</Label>
                <Input id="pp-when" type="datetime-local" value={form.scheduledFor ?? ''} onChange={(e) => set('scheduledFor', e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Repeat</Label>
                <Select value={form.recurrence} onValueChange={(v) => set('recurrence', v as PostInput['recurrence'])}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Once</SelectItem>
                    <SelectItem value="weekly">Every week</SelectItem>
                    <SelectItem value="monthly">Every month</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" disabled={busy} onClick={() => save('draft')}>
              Save draft
            </Button>
            {canApprove && (
              <Button variant="secondary" disabled={busy || !form.scheduledFor} onClick={() => save('schedule')}>
                <CalendarClock className="h-4 w-4" />
                Schedule
              </Button>
            )}
            <Button disabled={busy || !form.summary.trim()} onClick={() => save('publish')}>
              {canApprove ? 'Publish now' : 'Send for approval'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function PostRow({ post, canManage, onEdit, onDelete }: { post: PostView; canManage: boolean; onEdit: () => void; onDelete: () => void }) {
  const when = post.status === 'scheduled' ? post.scheduledFor : (post.publishedAt ?? null)
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 rounded-xl border border-border-subtle p-3 text-[13px]">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={STATUS_BADGE[post.status]}>{post.status}</Badge>
          {post.topicType !== 'STANDARD' && <Badge variant="outline">{post.topicType.toLowerCase()}</Badge>}
          {post.recurrence !== 'none' && (
            <span className="inline-flex items-center gap-1 text-text-tertiary">
              <Repeat className="h-3 w-3" /> {post.recurrence}
            </span>
          )}
          {when && <span className="text-text-tertiary">{new Date(when).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</span>}
        </div>
        <p className="line-clamp-3 whitespace-pre-wrap text-text-primary">{post.summary}</p>
        {post.error && <p className="text-danger">{post.error}</p>}
      </div>
      <div className="flex items-center gap-1">
        {post.searchUrl && (
          <a href={post.searchUrl} target="_blank" rel="noreferrer" className="rounded p-1 text-text-tertiary hover:bg-bg-tertiary" aria-label="View on Google">
            <ExternalLink className="h-4 w-4" />
          </a>
        )}
        {canManage && post.status !== 'live' && post.status !== 'publishing' && (
          <Button size="sm" variant="ghost" onClick={onEdit}>
            Edit
          </Button>
        )}
        {canManage && post.status !== 'publishing' && (
          <button type="button" onClick={onDelete} className="rounded p-1 text-text-tertiary hover:bg-bg-tertiary" aria-label="Delete post">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  )
}

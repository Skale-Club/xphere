'use client'

import * as React from 'react'
import {
  Activity,
  Building2,
  CheckCircle2,
  ListTodo,
  Loader2,
  MessageSquare,
  StickyNote,
  UserRound,
} from 'lucide-react'
import { toast } from 'sonner'

import {
  addProspectNote,
  addProspectTask,
  convertProspectToContact,
  getProspectDetail,
  type ProspectDetail,
  type ProspectRow,
} from '@/app/(dashboard)/prospects/actions'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'

function statusLabel(value: string): string {
  return value.replaceAll('_', ' ')
}

function when(iso: string): string {
  return new Date(iso).toLocaleString()
}

interface ProspectDetailSheetProps {
  prospect: ProspectRow | null
  onOpenChange: (open: boolean) => void
  onChanged: () => void
}

export function ProspectDetailSheet({ prospect, onOpenChange, onChanged }: ProspectDetailSheetProps) {
  const [detail, setDetail] = React.useState<ProspectDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [busy, setBusy] = React.useState(false)

  React.useEffect(() => {
    if (!prospect) {
      setDetail(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setDetail(null)
    getProspectDetail(prospect.kind, prospect.id).then((res) => {
      if (cancelled) return
      setLoading(false)
      if (res.ok) setDetail(res.detail)
      else toast.error(res.error)
    })
    return () => {
      cancelled = true
    }
  }, [prospect])

  async function handleConvert() {
    if (!prospect) return
    setBusy(true)
    const res = await convertProspectToContact(prospect.kind, prospect.id)
    setBusy(false)
    if (!res.ok) {
      toast.error(res.error)
      return
    }
    toast.success(prospect.kind === 'company' ? 'Company promoted to lead' : 'Prospect converted to lead')
    onChanged()
  }

  return (
    <Sheet open={Boolean(prospect)} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto p-0 sm:max-w-[480px]">
        <SheetHeader className="border-b border-border-subtle px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-accent-muted text-accent">
              {prospect?.kind === 'company' ? <Building2 className="h-4 w-4" /> : <UserRound className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <SheetTitle className="truncate text-[15px]">
                {prospect?.name || 'Prospect'}
              </SheetTitle>
              <SheetDescription className="truncate text-[12px]">
                {prospect?.company || prospect?.email || prospect?.phone || (prospect?.kind === 'company' ? 'Company prospect' : 'Person prospect')}
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        {loading || !detail ? (
          <div className="flex items-center justify-center py-20 text-text-tertiary">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6 px-5 py-5">
            {/* Qualification chips */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant="secondary" className="capitalize">{statusLabel(detail.engagementStatus)}</Badge>
              <Badge variant="outline" className="capitalize">intent: {detail.intentLevel}</Badge>
              <Badge variant="outline" className="capitalize">{statusLabel(detail.qualificationStatus)}</Badge>
              <Badge variant="outline">score {detail.score}</Badge>
              {detail.recommendedChannel && (
                <Badge variant="outline" className="capitalize">→ {detail.recommendedChannel}</Badge>
              )}
            </div>

            {/* Details */}
            <Section icon={Activity} title="Details">
              <dl className="grid gap-1.5 text-[13px]">
                <DetailRow label="Email" value={detail.email} />
                <DetailRow label="Phone" value={detail.phone} />
                <DetailRow label="Company" value={detail.company} />
                <DetailRow
                  label="Source"
                  value={[detail.sourceType || detail.source, detail.sourceId].filter(Boolean).join(' · ')}
                />
                {detail.tags.length > 0 && (
                  <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
                    <span className="text-text-tertiary">Tags</span>
                    <div className="flex flex-wrap gap-1">
                      {detail.tags.map((t) => (
                        <Badge key={t} variant="outline">{t}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                <DetailRow label="Conversations" value={detail.conversationCount > 0 ? String(detail.conversationCount) : null} />
                <DetailRow label="Added" value={when(detail.createdAt)} />
              </dl>
            </Section>

            {/* Convert action */}
            <div className="rounded-[10px] border border-border-subtle bg-bg-tertiary/30 p-3">
              <p className="mb-2 text-[12px] text-text-tertiary">
                Converting moves this record into the normal CRM as a lead, preserving its source, timeline, notes, and conversations.
              </p>
              <Button onClick={handleConvert} disabled={busy} className="w-full">
                <CheckCircle2 className="h-4 w-4" />
                {busy ? 'Converting…' : prospect?.kind === 'company' ? 'Promote company to lead' : 'Convert to Contact'}
              </Button>
            </div>

            {/* Timeline */}
            <Section icon={Activity} title="Timeline" count={detail.events.length}>
              {detail.events.length === 0 ? (
                <Empty>No engagement events yet.</Empty>
              ) : (
                <div className="space-y-2">
                  {detail.events.map((e) => (
                    <div key={e.id} className="flex items-start gap-2 text-[12.5px]">
                      <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                      <div className="min-w-0">
                        <span className="font-medium capitalize text-text-primary">{statusLabel(e.eventType)}</span>
                        {e.channel && <span className="text-text-tertiary"> · {e.channel}</span>}
                        {e.sourcePlatform && <span className="text-text-tertiary"> · {e.sourcePlatform}</span>}
                        <div className="text-[11px] text-text-tertiary">{when(e.occurredAt)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* Notes */}
            <Section icon={StickyNote} title="Notes" count={detail.notes.length}>
              <AddInline
                placeholder="Add a note…"
                multiline
                onSubmit={async (value) => {
                  if (!prospect) return false
                  const res = await addProspectNote(prospect.kind, prospect.id, value)
                  if (!res.ok) {
                    toast.error(res.error)
                    return false
                  }
                  const refreshed = await getProspectDetail(prospect.kind, prospect.id)
                  if (refreshed.ok) setDetail(refreshed.detail)
                  return true
                }}
              />
              <div className="mt-2 space-y-2">
                {detail.notes.map((n) => (
                  <div key={n.id} className="rounded-[8px] border border-border-subtle bg-bg-secondary px-3 py-2 text-[12.5px]">
                    <p className="whitespace-pre-wrap text-text-primary">{n.content}</p>
                    <p className="mt-1 text-[11px] text-text-tertiary">{when(n.createdAt)}</p>
                  </div>
                ))}
              </div>
            </Section>

            {/* Tasks */}
            <Section icon={ListTodo} title="Tasks" count={detail.tasks.length}>
              <AddInline
                placeholder="Add a follow-up task…"
                onSubmit={async (value) => {
                  if (!prospect) return false
                  const res = await addProspectTask(prospect.kind, prospect.id, value)
                  if (!res.ok) {
                    toast.error(res.error)
                    return false
                  }
                  const refreshed = await getProspectDetail(prospect.kind, prospect.id)
                  if (refreshed.ok) setDetail(refreshed.detail)
                  return true
                }}
              />
              <div className="mt-2 space-y-1.5">
                {detail.tasks.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 text-[12.5px]">
                    <ListTodo className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                    <span className="min-w-0 flex-1 truncate text-text-primary">{t.title}</span>
                    <Badge variant="outline" className="capitalize">{statusLabel(t.status)}</Badge>
                  </div>
                ))}
              </div>
            </Section>

            {detail.conversationCount > 0 && (
              <Section icon={MessageSquare} title="Conversations">
                <p className="text-[12.5px] text-text-secondary">
                  {detail.conversationCount} linked conversation{detail.conversationCount === 1 ? '' : 's'} — preserved on conversion.
                </p>
              </Section>
            )}
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  title: string
  count?: number
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
        <Icon className="h-3.5 w-3.5" />
        <span>{title}</span>
        {typeof count === 'number' && <span className="tabular-nums">· {count}</span>}
      </div>
      {children}
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-2">
      <span className="text-text-tertiary">{label}</span>
      <span className="truncate text-text-primary">{value || '—'}</span>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-[12.5px] text-text-tertiary">{children}</p>
}

function AddInline({
  placeholder,
  multiline,
  onSubmit,
}: {
  placeholder: string
  multiline?: boolean
  onSubmit: (value: string) => Promise<boolean>
}) {
  const [value, setValue] = React.useState('')
  const [pending, startTransition] = React.useTransition()

  function submit() {
    const text = value.trim()
    if (!text) return
    startTransition(async () => {
      const ok = await onSubmit(text)
      if (ok) setValue('')
    })
  }

  return (
    <div className="flex items-start gap-2">
      {multiline ? (
        <Textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="min-h-[40px] flex-1 text-[12.5px]"
        />
      ) : (
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          className="h-8 flex-1 text-[12.5px]"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
        />
      )}
      <Button size="sm" variant="secondary" className="h-8 shrink-0" disabled={pending || !value.trim()} onClick={submit}>
        {pending ? '…' : 'Add'}
      </Button>
    </div>
  )
}

'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Trash2,
  Loader2,
  Search,
  X,
  User as UserIcon,
  Mail,
  Phone,
  Send,
  Info,
  CalendarDays,
  ListChecks,
  MessageSquare,
  Radio,
} from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { TagPicker } from '@/components/tags/tag-picker'
import { TagBadge } from '@/components/tags/tag-badge'
import { ActivityFeedItem } from '@/components/pipeline/activity-feed-item'
import {
  getOpportunity,
  updateOpportunity,
  deleteOpportunity,
  moveOpportunity,
  getActivities,
  addNote,
  searchContactsForOpportunity,
  type OpportunityWithContact,
  type ActivityWithMeta,
} from '@/app/(dashboard)/pipeline/actions'
import { CustomFieldsForm } from '@/components/custom-fields/custom-fields-form'
import {
  listTags,
  setOpportunityTags,
  getOpportunityTagIds,
  type TagRow,
} from '@/app/(dashboard)/settings/tags/actions'
import { formatCurrency, initialsOf } from '@/lib/pipeline/format'
import { displayContactName } from '@/lib/contacts/names'
import type { Database } from '@/types/database'
import { cn } from '@/lib/utils'

type StageRow = Database['public']['Tables']['pipeline_stages']['Row']
type OpportunityStatus = 'open' | 'won' | 'lost'
type SideSection = 'details' | 'scheduling' | 'tasks' | 'notes' | 'channels'

interface ContactSuggestion {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
}

interface OpportunityDetailSheetProps {
  opportunityId: string | null
  stages: StageRow[]
  defaultCurrency?: string
  onOpenChange: (open: boolean) => void
}

const SIDE_ITEMS: { id: SideSection; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'details', label: 'Opportunity Details', icon: Info },
  { id: 'scheduling', label: 'Scheduling', icon: CalendarDays },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'notes', label: 'Notes', icon: MessageSquare },
  { id: 'channels', label: 'Channels', icon: Radio },
]

function formatDateTime(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function OpportunityDetailSheet({
  opportunityId,
  stages,
  defaultCurrency = 'USD',
  onOpenChange,
}: OpportunityDetailSheetProps) {
  const router = useRouter()
  const [opp, setOpp] = React.useState<OpportunityWithContact | null>(null)
  const [activities, setActivities] = React.useState<ActivityWithMeta[]>([])
  const [allTags, setAllTags] = React.useState<TagRow[]>([])
  const [tagIds, setTagIds] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [noteDraft, setNoteDraft] = React.useState('')
  const [addingNote, setAddingNote] = React.useState(false)
  const [section, setSection] = React.useState<SideSection>('details')
  const [dirty, setDirty] = React.useState(false)

  // Form state
  const [title, setTitle] = React.useState('')
  const [value, setValue] = React.useState('')
  const [stageId, setStageId] = React.useState('')
  const [status, setStatus] = React.useState<OpportunityStatus>('open')
  const [expectedClose, setExpectedClose] = React.useState('')
  const [contact, setContact] = React.useState<ContactSuggestion | null>(null)
  const [contactQuery, setContactQuery] = React.useState('')
  const [contactSuggestions, setContactSuggestions] = React.useState<ContactSuggestion[]>([])
  const [contactPickerOpen, setContactPickerOpen] = React.useState(false)
  const [customFields, setCustomFields] = React.useState<Record<string, unknown>>({})

  function populateForm(o: OpportunityWithContact) {
    setTitle(o.title)
    setValue(String(o.value ?? 0))
    setStageId(o.stage_id)
    setStatus((o.status as OpportunityStatus) ?? 'open')
    setExpectedClose(o.expected_close_date ?? '')
    setContact(o.contact ? {
      id: o.contact.id,
      first_name: o.contact.first_name ?? null,
      last_name: o.contact.last_name ?? null,
      name: o.contact.name,
      phone: o.contact.phone,
      email: o.contact.email,
    } : null)
    setCustomFields((o.custom_fields as Record<string, unknown>) ?? {})
    setDirty(false)
  }

  React.useEffect(() => {
    if (!opportunityId) {
      setOpp(null)
      setActivities([])
      setTagIds([])
      setSection('details')
      setDirty(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setSection('details')
    Promise.all([
      getOpportunity(opportunityId),
      getActivities(opportunityId),
      getOpportunityTagIds(opportunityId),
      listTags(),
    ]).then(([o, acts, ids, tags]) => {
      if (cancelled) return
      setOpp(o)
      setActivities(acts)
      setTagIds(ids)
      setAllTags(tags)
      if (o) populateForm(o)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [opportunityId])

  React.useEffect(() => {
    if (!contactPickerOpen) return
    let cancelled = false
    const t = setTimeout(async () => {
      const rows = await searchContactsForOpportunity(contactQuery)
      if (!cancelled) setContactSuggestions(rows)
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
  }, [contactQuery, contactPickerOpen])

  function markDirty() {
    if (!dirty) setDirty(true)
  }

  async function handleSave() {
    if (!opp) return
    if (!title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    const numValue = Number((value || '0').replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0
    const stageChanged = stageId !== opp.stage_id

    const res = await updateOpportunity(opp.id, {
      title: title.trim(),
      value: numValue,
      currency: defaultCurrency,
      contact_id: contact?.id ?? null,
      expected_close_date: expectedClose || undefined,
      status,
      custom_fields: customFields,
    })
    if (res && 'error' in res && res.error) {
      setSaving(false)
      toast.error(res.error)
      return
    }

    if (stageChanged) {
      const moveRes = await moveOpportunity(opp.id, stageId)
      if (moveRes && 'error' in moveRes && moveRes.error) {
        setSaving(false)
        toast.error(moveRes.error)
        return
      }
    }

    await setOpportunityTags(opp.id, tagIds)

    setSaving(false)
    setDirty(false)
    toast.success('Opportunity updated')

    const [fresh, freshActs] = await Promise.all([
      getOpportunity(opp.id),
      getActivities(opp.id),
    ])
    setOpp(fresh)
    setActivities(freshActs)
    router.refresh()
  }

  async function handleDelete() {
    if (!opp) return
    if (!confirm(`Delete "${opp.title}"? This cannot be undone.`)) return
    setDeleting(true)
    const res = await deleteOpportunity(opp.id)
    setDeleting(false)
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Opportunity deleted')
    onOpenChange(false)
    router.refresh()
  }

  function handleCancel() {
    if (opp) populateForm(opp)
  }

  async function handleAddNote() {
    if (!opp || !noteDraft.trim()) return
    setAddingNote(true)
    const res = await addNote(opp.id, noteDraft.trim())
    setAddingNote(false)
    if ('error' in res && res.error) {
      toast.error(res.error)
      return
    }
    setNoteDraft('')
    const fresh = await getActivities(opp.id)
    setActivities(fresh)
    router.refresh()
  }

  const stage = stages.find((s) => s.id === stageId)
  const selectedTags = allTags.filter((t) => tagIds.includes(t.id))

  return (
    <Dialog open={Boolean(opportunityId)} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(780px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[calc(100vw-2rem)] max-w-[960px] flex-col overflow-hidden p-0 gap-0 bg-bg-secondary">
        {loading && !opp ? (
          <>
            <VisuallyHidden><DialogTitle>Loading opportunity</DialogTitle></VisuallyHidden>
            <div className="p-6 space-y-3 animate-pulse">
              <div className="h-6 w-2/3 rounded bg-bg-tertiary" />
              <div className="h-4 w-1/2 rounded bg-bg-tertiary" />
              <div className="h-32 rounded bg-bg-tertiary" />
            </div>
          </>
        ) : !opp ? (
          <>
            <VisuallyHidden><DialogTitle>Opportunity not found</DialogTitle></VisuallyHidden>
            <div className="p-6 text-[13px] text-text-secondary">Opportunity not found.</div>
          </>
        ) : (
          <div className="flex flex-col overflow-hidden h-full">
            {/* Header */}
            <DialogHeader className="border-b border-border-subtle px-6 pt-5 pb-5 pr-14 space-y-0 shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {stage && (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium"
                        style={{ backgroundColor: `${stage.color}1f`, color: stage.color }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                        {stage.name}
                      </span>
                    )}
                    <span className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium uppercase tracking-wider',
                      status === 'won' && 'bg-emerald-500/10 text-emerald-400',
                      status === 'lost' && 'bg-rose-500/10 text-rose-400',
                      status === 'open' && 'bg-bg-tertiary text-text-tertiary',
                    )}>
                      {status}
                    </span>
                  </div>
                  <DialogTitle className="text-[22px] leading-[1.2] font-semibold tracking-[-0.01em] truncate">
                    {opp.title}
                  </DialogTitle>
                  <DialogDescription asChild>
                    <div className="text-[28px] leading-[1.1] font-semibold tabular-nums text-accent">
                      {formatCurrency(Number(value) || Number(opp.value), defaultCurrency)}
                    </div>
                  </DialogDescription>
                  {selectedTags.length > 0 && (
                    <div className="flex flex-wrap gap-1 pt-1">
                      {selectedTags.map((t) => <TagBadge key={t.id} name={t.name} color={t.color} />)}
                    </div>
                  )}
                </div>
              </div>
            </DialogHeader>

            {/* Body: sidebar + content */}
            <div className="flex flex-1 overflow-hidden">
              {/* Sidebar */}
              <nav className="w-48 shrink-0 border-r border-border-subtle py-3 px-2 flex flex-col gap-0.5">
                {SIDE_ITEMS.map(({ id, label, icon: Icon }) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setSection(id)}
                    className={cn(
                      'flex items-center gap-2.5 w-full rounded-[7px] px-3 py-2 text-left text-[13px] font-medium transition-colors',
                      section === id
                        ? 'bg-bg-tertiary text-text-primary'
                        : 'text-text-secondary hover:bg-bg-tertiary/50 hover:text-text-primary',
                    )}
                  >
                    <Icon className={cn(
                      'h-3.5 w-3.5 shrink-0',
                      section === id ? 'text-accent' : 'text-text-tertiary',
                    )} />
                    <span className="truncate">{label}</span>
                  </button>
                ))}
              </nav>

              {/* Content */}
              <div className="flex-1 overflow-hidden flex flex-col">

                {/* DETAILS — always inline */}
                {section === 'details' && (
                  <>
                    <div className="flex-1 overflow-y-auto px-6 py-5">
                      <div className="space-y-4">
                        <Field label="Title">
                          <Input
                            value={title}
                            onChange={(e) => { setTitle(e.target.value); markDirty() }}
                            maxLength={160}
                          />
                        </Field>

                        <Field label={`Value (${defaultCurrency})`}>
                          <Input
                            value={value}
                            onChange={(e) => { setValue(e.target.value); markDirty() }}
                            onBlur={(e) => {
                              const n = parseFloat(e.target.value.replace(/[^0-9.,-]/g, '').replace(',', '.'))
                              if (!isNaN(n)) setValue(n.toFixed(2))
                            }}
                            inputMode="decimal"
                            placeholder="0,00"
                          />
                        </Field>

                        <Field label="Stage">
                          <Select value={stageId} onValueChange={(v) => { setStageId(v); markDirty() }}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {stages.map((s) => (
                                <SelectItem key={s.id} value={s.id}>
                                  <span className="inline-flex items-center gap-2">
                                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
                                    {s.name}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>

                        <div className="grid grid-cols-2 gap-3">
                          <Field label="Status">
                            <Select value={status} onValueChange={(v) => { setStatus(v as OpportunityStatus); markDirty() }}>
                              <SelectTrigger><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="open">Open</SelectItem>
                                <SelectItem value="won">Won</SelectItem>
                                <SelectItem value="lost">Lost</SelectItem>
                              </SelectContent>
                            </Select>
                          </Field>
                          <Field label="Expected close">
                            <Input
                              type="date"
                              value={expectedClose}
                              onChange={(e) => { setExpectedClose(e.target.value); markDirty() }}
                            />
                          </Field>
                        </div>

                        <Field label="Contact">
                          {contact ? (
                            <div className="flex items-center justify-between gap-2 rounded-[8px] border border-border-subtle px-3 py-2">
                              <div className="min-w-0">
                                <div className="text-[13px] font-medium text-text-primary truncate">
                                  {displayContactName(contact, 'Unnamed')}
                                </div>
                                <div className="text-[11.5px] text-text-tertiary truncate">
                                  {contact.phone ?? contact.email ?? ''}
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => { setContact(null); markDirty() }}
                                className="text-text-tertiary hover:text-text-primary"
                                aria-label="Clear contact"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
                              <Input
                                value={contactQuery}
                                onChange={(e) => { setContactQuery(e.target.value); setContactPickerOpen(true) }}
                                onFocus={() => setContactPickerOpen(true)}
                                onBlur={() => setTimeout(() => setContactPickerOpen(false), 150)}
                                placeholder="Search by name, phone, or email"
                                className="pl-8"
                              />
                              {contactPickerOpen && contactSuggestions.length > 0 && (
                                <div className="absolute z-50 mt-1 w-full rounded-[8px] border border-border-subtle bg-bg-primary shadow-elevation-md max-h-[220px] overflow-y-auto">
                                  {contactSuggestions.map((s) => (
                                    <button
                                      key={s.id}
                                      type="button"
                                      onClick={() => { setContact(s); setContactPickerOpen(false); setContactQuery(''); markDirty() }}
                                      className="flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-bg-secondary text-left"
                                    >
                                      <div className="min-w-0">
                                        <div className="text-[12.5px] font-medium text-text-primary truncate">{displayContactName(s, 'Unnamed')}</div>
                                        <div className="text-[11px] text-text-tertiary truncate">{s.phone ?? s.email ?? ''}</div>
                                      </div>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </Field>

                        <Field label="Tags">
                          <TagPicker
                            allTags={allTags}
                            value={tagIds}
                            onChange={(ids) => { setTagIds(ids); markDirty() }}
                            onTagCreated={(tag) => setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))}
                          />
                        </Field>

                        <CustomFieldsForm
                          entity="opportunity"
                          value={customFields}
                          onChange={(v) => { setCustomFields(v); markDirty() }}
                        />
                      </div>
                    </div>

                    {/* Fixed footer */}
                    <div className="border-t border-border-subtle px-6 py-3 shrink-0 flex items-center justify-between gap-4">
                      <div className="space-y-0.5 text-[11px] text-text-tertiary leading-relaxed">
                        <div>Created On: <span className="text-text-secondary">{formatDateTime(opp.created_at)}</span></div>
                        <div>Audit Logs: <span className="font-mono text-text-secondary">{opp.id}</span></div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          onClick={handleDelete}
                          disabled={deleting}
                          className="text-rose-400 hover:text-rose-300 hover:bg-rose-500/10"
                          aria-label="Delete opportunity"
                        >
                          {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleCancel} disabled={!dirty}>
                          Cancel
                        </Button>
                        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
                          {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                          Update
                        </Button>
                      </div>
                    </div>
                  </>
                )}

                {/* SCHEDULING */}
                {section === 'scheduling' && (
                  <div className="flex-1 flex items-center justify-center px-6 py-10">
                    <div className="text-center space-y-2">
                      <CalendarDays className="h-8 w-8 text-text-tertiary mx-auto" />
                      <p className="text-[13px] font-medium text-text-secondary">Scheduling</p>
                      <p className="text-[12px] text-text-tertiary">Coming soon</p>
                    </div>
                  </div>
                )}

                {/* TASKS */}
                {section === 'tasks' && (
                  <div className="flex-1 flex items-center justify-center px-6 py-10">
                    <div className="text-center space-y-2">
                      <ListChecks className="h-8 w-8 text-text-tertiary mx-auto" />
                      <p className="text-[13px] font-medium text-text-secondary">Tasks</p>
                      <p className="text-[12px] text-text-tertiary">Coming soon</p>
                    </div>
                  </div>
                )}

                {/* NOTES */}
                {section === 'notes' && (
                  <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                      {activities.length === 0 ? (
                        <p className="text-[12.5px] text-text-tertiary py-8 text-center">No activity yet.</p>
                      ) : (
                        activities.map((a) => <ActivityFeedItem key={a.id} activity={a} />)
                      )}
                    </div>
                    <div className="border-t border-border-subtle px-6 py-3 shrink-0">
                      <div className="flex gap-2">
                        <Textarea
                          value={noteDraft}
                          onChange={(e) => setNoteDraft(e.target.value)}
                          placeholder="Add a note…"
                          rows={2}
                          className="resize-none text-[13px]"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                              e.preventDefault()
                              handleAddNote()
                            }
                          }}
                        />
                        <Button
                          size="sm"
                          onClick={handleAddNote}
                          disabled={addingNote || !noteDraft.trim()}
                          className="self-end"
                        >
                          {addingNote ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                        </Button>
                      </div>
                      <p className="mt-1 text-[10.5px] text-text-tertiary">⌘+Enter to send</p>
                    </div>
                  </div>
                )}

                {/* CHANNELS */}
                {section === 'channels' && (
                  <div className="flex-1 flex items-center justify-center px-6 py-10">
                    <div className="text-center space-y-2">
                      <Radio className="h-8 w-8 text-text-tertiary mx-auto" />
                      <p className="text-[13px] font-medium text-text-secondary">Channels</p>
                      <p className="text-[12px] text-text-tertiary">Coming soon</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-medium text-text-secondary">{label}</Label>
      {children}
    </div>
  )
}

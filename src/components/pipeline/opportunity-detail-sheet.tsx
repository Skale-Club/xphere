'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Pencil,
  Trash2,
  Loader2,
  Check,
  Search,
  X,
  Calendar,
  User as UserIcon,
  Building2,
  Mail,
  Phone,
  Send,
} from 'lucide-react'

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
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
import { CustomFieldsDisplay } from '@/components/custom-fields/custom-fields-display'
import {
  listTags,
  setOpportunityTags,
  getOpportunityTagIds,
  type TagRow,
} from '@/app/(dashboard)/settings/tags/actions'
import { formatCurrency, initialsOf } from '@/lib/pipeline/format'
import type { Database } from '@/types/database'
import { cn } from '@/lib/utils'

type StageRow = Database['public']['Tables']['pipeline_stages']['Row']
type OpportunityStatus = 'open' | 'won' | 'lost'

interface ContactSuggestion {
  id: string
  name: string | null
  phone: string | null
  email: string | null
}

interface OpportunityDetailSheetProps {
  opportunityId: string | null
  stages: StageRow[]
  onOpenChange: (open: boolean) => void
}

export function OpportunityDetailSheet({
  opportunityId,
  stages,
  onOpenChange,
}: OpportunityDetailSheetProps) {
  const router = useRouter()
  const [opp, setOpp] = React.useState<OpportunityWithContact | null>(null)
  const [activities, setActivities] = React.useState<ActivityWithMeta[]>([])
  const [allTags, setAllTags] = React.useState<TagRow[]>([])
  const [tagIds, setTagIds] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(false)
  const [editing, setEditing] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [noteDraft, setNoteDraft] = React.useState('')
  const [addingNote, setAddingNote] = React.useState(false)

  // Edit form state
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

  // Load opportunity, tags, activities when sheet opens
  React.useEffect(() => {
    if (!opportunityId) {
      setOpp(null)
      setActivities([])
      setTagIds([])
      setEditing(false)
      return
    }
    let cancelled = false
    setLoading(true)
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
      if (o) {
        setTitle(o.title)
        setValue(String(o.value ?? 0))
        setStageId(o.stage_id)
        setStatus((o.status as OpportunityStatus) ?? 'open')
        setExpectedClose(o.expected_close_date ?? '')
        setContact(o.contact ? {
          id: o.contact.id,
          name: o.contact.name,
          phone: o.contact.phone,
          email: o.contact.email,
        } : null)
        setCustomFields((o.custom_fields as Record<string, unknown>) ?? {})
      }
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [opportunityId])

  // Contact search debounce
  React.useEffect(() => {
    if (!contactPickerOpen) return
    let cancelled = false
    const t = setTimeout(async () => {
      const rows = await searchContactsForOpportunity(contactQuery)
      if (!cancelled) setContactSuggestions(rows)
    }, 180)
    return () => { cancelled = true; clearTimeout(t) }
  }, [contactQuery, contactPickerOpen])

  async function handleSave() {
    if (!opp) return
    if (!title.trim()) { toast.error('Title is required'); return }
    setSaving(true)
    const numValue = Number((value || '0').replace(/[^0-9.,-]/g, '').replace(',', '.')) || 0
    const stageChanged = stageId !== opp.stage_id

    const res = await updateOpportunity(opp.id, {
      title: title.trim(),
      value: numValue,
      currency: opp.currency,
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
    setEditing(false)
    toast.success('Opportunity updated')

    // Refresh local state
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

  const stage = stages.find((s) => s.id === (editing ? stageId : opp?.stage_id))
  const selectedTags = allTags.filter((t) => tagIds.includes(t.id))

  return (
    <Sheet open={Boolean(opportunityId)} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-[560px] flex flex-col overflow-hidden p-0">
        {loading && !opp ? (
          <div className="p-6 space-y-3 animate-pulse">
            <div className="h-6 w-2/3 rounded bg-bg-tertiary" />
            <div className="h-4 w-1/2 rounded bg-bg-tertiary" />
            <div className="h-32 rounded bg-bg-tertiary" />
          </div>
        ) : !opp ? (
          <div className="p-6 text-[13px] text-text-secondary">Opportunity not found.</div>
        ) : (
          <div className="flex flex-col overflow-hidden h-full">
            {/* Header */}
            <SheetHeader className="border-b border-border-subtle px-6 py-5 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-text-tertiary">
                    {stage && (
                      <span
                        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-medium"
                        style={{
                          backgroundColor: `${stage.color}22`,
                          color: stage.color,
                        }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color }} />
                        {stage.name}
                      </span>
                    )}
                    <span className="capitalize text-text-tertiary">· {status}</span>
                  </div>
                  <SheetTitle className="mt-1 text-[18px] truncate">
                    {editing ? 'Edit opportunity' : opp.title}
                  </SheetTitle>
                  {!editing && (
                    <SheetDescription className="text-[14px] text-accent font-semibold tabular-nums">
                      {formatCurrency(Number(opp.value), opp.currency)}
                    </SheetDescription>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {!editing && (
                    <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleDelete}
                    disabled={deleting}
                    className="text-rose-400 hover:text-rose-300"
                  >
                    {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>

              {!editing && selectedTags.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedTags.map((t) => (
                    <TagBadge key={t.id} name={t.name} color={t.color} />
                  ))}
                </div>
              )}
            </SheetHeader>

            <Tabs defaultValue="info" className="flex flex-col flex-1 overflow-hidden">
              <TabsList className="mx-6 mt-4 self-start">
                <TabsTrigger value="info">Info</TabsTrigger>
                <TabsTrigger value="activity">
                  Activity
                  {activities.length > 0 && (
                    <span className="ml-1 text-[10px] text-text-tertiary">
                      {activities.length}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* INFO TAB */}
              <TabsContent value="info" className="flex-1 overflow-y-auto px-6 py-5 m-0">
                {editing ? (
                  <div className="space-y-4">
                    <Field label="Title">
                      <Input
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        maxLength={160}
                        autoFocus
                      />
                    </Field>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Value">
                        <Input
                          value={value}
                          onChange={(e) => setValue(e.target.value)}
                          inputMode="decimal"
                          placeholder="0,00"
                        />
                      </Field>
                      <Field label="Stage">
                        <Select value={stageId} onValueChange={setStageId}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
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
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <Field label="Status">
                        <Select value={status} onValueChange={(v) => setStatus(v as OpportunityStatus)}>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
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
                          onChange={(e) => setExpectedClose(e.target.value)}
                        />
                      </Field>
                    </div>

                    <Field label="Contact">
                      {contact ? (
                        <div className="flex items-center justify-between gap-2 rounded-[8px] border border-border-subtle bg-bg-secondary px-3 py-2">
                          <div className="min-w-0">
                            <div className="text-[13px] font-medium text-text-primary truncate">
                              {contact.name ?? 'Unnamed'}
                            </div>
                            <div className="text-[11.5px] text-text-tertiary truncate">
                              {contact.phone ?? contact.email ?? ''}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => setContact(null)}
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
                                  onClick={() => {
                                    setContact(s)
                                    setContactPickerOpen(false)
                                    setContactQuery('')
                                  }}
                                  className="flex w-full items-center justify-between gap-2 px-3 py-2 hover:bg-bg-secondary text-left"
                                >
                                  <div className="min-w-0">
                                    <div className="text-[12.5px] font-medium text-text-primary truncate">
                                      {s.name ?? 'Unnamed'}
                                    </div>
                                    <div className="text-[11px] text-text-tertiary truncate">
                                      {s.phone ?? s.email ?? ''}
                                    </div>
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
                        onChange={setTagIds}
                        onTagCreated={(tag) => setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))}
                      />
                    </Field>

                    <CustomFieldsForm
                      entity="opportunity"
                      value={customFields}
                      onChange={setCustomFields}
                    />

                    <div className="flex items-center justify-end gap-2 pt-2">
                      <Button variant="ghost" onClick={() => { setEditing(false); /* reset state */ }}>
                        Cancel
                      </Button>
                      <Button onClick={handleSave} disabled={saving}>
                        {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                        Save changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <MetaRow icon={Calendar} label="Expected close" value={opp.expected_close_date ?? 'Not set'} />
                    <MetaRow icon={Calendar} label="Created" value={new Date(opp.created_at).toLocaleDateString()} />
                    <MetaRow icon={Calendar} label="Last updated" value={new Date(opp.updated_at).toLocaleDateString()} />

                    <CustomFieldsDisplay
                      entity="opportunity"
                      customFields={opp.custom_fields as Record<string, unknown>}
                    />

                    {opp.contact && (
                      <>
                        <div className="border-t border-border-subtle pt-3 -mx-2 px-2 text-[11px] uppercase tracking-wide text-text-tertiary">
                          Contact
                        </div>
                        <Link
                          href={`/contacts?id=${opp.contact.id}`}
                          className="block rounded-[10px] border border-border-subtle bg-bg-tertiary/40 p-3 transition-colors hover:bg-bg-tertiary/70"
                        >
                          <div className="flex items-center gap-3">
                            <Avatar className="h-9 w-9">
                              <AvatarFallback className="text-[11px] font-semibold bg-accent-muted text-accent">
                                {initialsOf(opp.contact.name ?? opp.contact.phone ?? '')}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="text-[13px] font-medium text-text-primary truncate">
                                {opp.contact.name ?? '(unnamed)'}
                              </div>
                              <div className="flex items-center gap-3 text-[11.5px] text-text-tertiary">
                                {opp.contact.phone && (
                                  <span className="inline-flex items-center gap-1">
                                    <Phone className="h-3 w-3" /> {opp.contact.phone}
                                  </span>
                                )}
                                {opp.contact.email && (
                                  <span className="inline-flex items-center gap-1">
                                    <Mail className="h-3 w-3" /> {opp.contact.email}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </Link>
                      </>
                    )}
                  </div>
                )}
              </TabsContent>

              {/* ACTIVITY TAB */}
              <TabsContent value="activity" className="flex-1 overflow-hidden flex flex-col m-0">
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-3">
                  {activities.length === 0 ? (
                    <p className="text-[12.5px] text-text-tertiary py-8 text-center">
                      No activity yet.
                    </p>
                  ) : (
                    activities.map((a) => <ActivityFeedItem key={a.id} activity={a} />)
                  )}
                </div>
                <div className="border-t border-border-subtle px-6 py-3">
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
              </TabsContent>
            </Tabs>
          </div>
        )}
      </SheetContent>
    </Sheet>
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

function MetaRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] bg-bg-tertiary text-text-tertiary">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div className="min-w-0">
        <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">{label}</div>
        <div className="text-[12.5px] text-text-primary truncate">{value || '—'}</div>
      </div>
    </div>
  )
}

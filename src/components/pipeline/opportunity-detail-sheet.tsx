'use client'

/**
 * OpportunityDetailSheet (v2 — inline edit + tabbed + mobile-first).
 *
 * Every field commits on its own (no Update button) — mirrors the chat
 * contact info panel and the AccountDetailSheet. Sections live in a left
 * sidebar on desktop and a horizontal scrollable tab bar on mobile:
 *   Details · Contact · Activity · Tasks · Notes · Scheduling
 *
 * Reuses platform primitives:
 *   - InlineEditField for text/date fields
 *   - TasksTable / NotesGrid (client) fed by getTasks / getNotes
 *   - ActivityFeedItem for the read-only timeline
 *   - getSchedulingProfile / getEventTypes for the Scheduling CTA
 *   - updateOpportunity (partial) / moveOpportunity / setOpportunityTags
 */

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
  Info,
  CalendarDays,
  CalendarPlus,
  ListChecks,
  StickyNote,
  Activity as ActivityIcon,
  ExternalLink,
  Check,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { VisuallyHidden } from '@radix-ui/react-visually-hidden'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
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
import { TagPicker } from '@/components/tags/tag-picker'
import { ActivityFeedItem } from '@/components/pipeline/activity-feed-item'
import { InlineEditField, InlineEditActions } from '@/components/chat/inline-edit-field'
import { TasksTable } from '@/components/tasks/tasks-table'
import { NotesGrid } from '@/components/notes/notes-grid'
import { CustomFieldsForm } from '@/components/custom-fields/custom-fields-form'
import { formatPhoneDisplay } from '@/lib/phone-numbers/format'
import { formatEmailDisplay } from '@/lib/email-addresses/format'
import {
  getOpportunity,
  updateOpportunity,
  deleteOpportunity,
  moveOpportunity,
  getActivities,
  searchContactsForOpportunity,
  type OpportunityWithContact,
  type ActivityWithMeta,
} from '@/app/(dashboard)/pipeline/actions'
import {
  listTags,
  setOpportunityTags,
  getOpportunityTagIds,
  type TagRow,
} from '@/app/(dashboard)/settings/tags/actions'
import { getTasks, type TaskRow } from '@/app/(dashboard)/tasks/actions'
import { getNotes, type NoteRow } from '@/app/(dashboard)/notes/actions'
import {
  getSchedulingProfile,
  type SchedulingProfile,
} from '@/app/(dashboard)/scheduling/_actions/scheduling-profile'
import {
  getEventTypes,
  type EventTypeRow,
} from '@/app/(dashboard)/scheduling/_actions/event-types'
import { formatCurrency } from '@/lib/pipeline/format'
import { formatDateTime as formatDateTimeTz } from '@/lib/datetime'
import { useOrgSettings } from '@/components/providers/org-settings-provider'
import { displayContactName, initialsFromContactName } from '@/lib/contacts/names'
import type { Database } from '@/types/database'
import { cn } from '@/lib/utils'

type StageRow = Database['public']['Tables']['pipeline_stages']['Row']
type OpportunityStatus = 'open' | 'won' | 'lost'
type SideSection = 'details' | 'contact' | 'activity' | 'tasks' | 'notes' | 'scheduling'

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
  { id: 'details', label: 'Details', icon: Info },
  { id: 'contact', label: 'Contact', icon: UserIcon },
  { id: 'activity', label: 'Activity', icon: ActivityIcon },
  { id: 'tasks', label: 'Tasks', icon: ListChecks },
  { id: 'notes', label: 'Notes', icon: StickyNote },
  { id: 'scheduling', label: 'Scheduling', icon: CalendarDays },
]

export function OpportunityDetailSheet({
  opportunityId,
  stages,
  defaultCurrency = 'USD',
  onOpenChange,
}: OpportunityDetailSheetProps) {
  const router = useRouter()
  const { timezone } = useOrgSettings()
  const [opp, setOpp] = React.useState<OpportunityWithContact | null>(null)
  const [activities, setActivities] = React.useState<ActivityWithMeta[]>([])
  const [allTags, setAllTags] = React.useState<TagRow[]>([])
  const [tagIds, setTagIds] = React.useState<string[]>([])
  const [loading, setLoading] = React.useState(false)
  const [deleting, setDeleting] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const [section, setSection] = React.useState<SideSection>('details')

  // Lazily-loaded section data
  const [tasks, setTasks] = React.useState<TaskRow[] | null>(null)
  const [notes, setNotes] = React.useState<NoteRow[] | null>(null)
  const [profile, setProfile] = React.useState<SchedulingProfile | null>(null)
  const [eventTypes, setEventTypes] = React.useState<EventTypeRow[]>([])
  const [schedLoaded, setSchedLoaded] = React.useState(false)

  // Contact picker (Contact tab)
  const [contactQuery, setContactQuery] = React.useState('')
  const [contactSuggestions, setContactSuggestions] = React.useState<ContactSuggestion[]>([])
  const [contactPickerOpen, setContactPickerOpen] = React.useState(false)

  const oppId = opp?.id ?? null

  // ── Initial load ──────────────────────────────────────────────────────────
  React.useEffect(() => {
    if (!opportunityId) {
      setOpp(null)
      setActivities([])
      setTagIds([])
      setTasks(null)
      setNotes(null)
      setSchedLoaded(false)
      setSection('details')
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
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [opportunityId])

  // ── Re-fetch opp + activities (after stage/status changes that log events) ──
  const refreshOpp = React.useCallback(async () => {
    if (!oppId) return
    const [fresh, freshActs] = await Promise.all([
      getOpportunity(oppId),
      getActivities(oppId),
    ])
    setOpp(fresh)
    setActivities(freshActs)
    router.refresh()
  }, [oppId, router])

  // ── Tasks / Notes lazy fetch (+ refetch on focus, the slide-over seam) ──────
  const fetchTasks = React.useCallback(async () => {
    if (!oppId) return
    const res = await getTasks({ entity_type: 'opportunity', entity_id: oppId })
    setTasks(res.ok ? res.data : [])
  }, [oppId])

  const fetchNotes = React.useCallback(async () => {
    if (!oppId) return
    const res = await getNotes({ entity_type: 'opportunity', entity_id: oppId })
    setNotes(res.ok ? res.data : [])
  }, [oppId])

  const fetchScheduling = React.useCallback(async () => {
    const [p, et] = await Promise.all([getSchedulingProfile(), getEventTypes()])
    setProfile(p.ok ? p.data : null)
    setEventTypes(et.ok ? et.data : [])
    setSchedLoaded(true)
  }, [])

  // Load section data when the section becomes active.
  React.useEffect(() => {
    if (!oppId) return
    if (section === 'tasks' && tasks === null) void fetchTasks()
    if (section === 'notes' && notes === null) void fetchNotes()
    if (section === 'scheduling' && !schedLoaded) void fetchScheduling()
  }, [section, oppId, tasks, notes, schedLoaded, fetchTasks, fetchNotes, fetchScheduling])

  // TasksTable / NotesGrid mutate via their own slide-overs + router.refresh().
  // Our in-sheet lists are client-fetched, so re-pull them when the window
  // regains focus (covers returning from the slide-over) for the active tab.
  React.useEffect(() => {
    function onFocus() {
      if (section === 'tasks') void fetchTasks()
      else if (section === 'notes') void fetchNotes()
    }
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [section, fetchTasks, fetchNotes])

  // ── Contact picker search ───────────────────────────────────────────────────
  React.useEffect(() => {
    if (!contactPickerOpen) return
    let cancelled = false
    const t = setTimeout(async () => {
      const rows = await searchContactsForOpportunity(contactQuery)
      if (!cancelled) setContactSuggestions(rows)
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [contactQuery, contactPickerOpen])

  // ── Inline save handlers ────────────────────────────────────────────────────
  const saveField = (field: 'title' | 'expected_close_date') => async (next: string) => {
    if (!oppId) return
    const payload =
      field === 'expected_close_date'
        ? { expected_close_date: next || undefined }
        : { title: next.trim() }
    const res = await updateOpportunity(oppId, payload)
    if (res && 'error' in res && res.error) throw new Error(res.error)
    setOpp((prev) =>
      prev ? ({ ...prev, [field]: field === 'title' ? next.trim() : next || null } as OpportunityWithContact) : prev,
    )
  }

  async function saveValue(next: number) {
    if (!oppId) return
    const res = await updateOpportunity(oppId, { value: next, currency: defaultCurrency })
    if (res && 'error' in res && res.error) throw new Error(res.error)
    setOpp((prev) => (prev ? { ...prev, value: next } : prev))
  }

  async function saveStage(stageId: string) {
    if (!oppId || !opp || stageId === opp.stage_id) return
    const res = await moveOpportunity(oppId, stageId)
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Stage updated')
    await refreshOpp()
  }

  async function saveStatus(status: OpportunityStatus) {
    if (!oppId || !opp || status === opp.status) return
    const res = await updateOpportunity(oppId, { status })
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Status updated')
    await refreshOpp()
  }

  async function saveContact(next: ContactSuggestion | null) {
    if (!oppId) return
    const res = await updateOpportunity(oppId, { contact_id: next?.id ?? null })
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      return
    }
    setOpp((prev) =>
      prev
        ? {
            ...prev,
            contact_id: next?.id ?? null,
            contact: next
              ? {
                  id: next.id,
                  first_name: next.first_name,
                  last_name: next.last_name,
                  name: next.name,
                  phone: next.phone,
                  email: next.email,
                  company: null,
                }
              : null,
          }
        : prev,
    )
    setContactPickerOpen(false)
    setContactQuery('')
    toast.success(next ? 'Contact linked' : 'Contact removed')
  }

  async function saveTags(ids: string[]) {
    if (!oppId) return
    setTagIds(ids)
    const res = await setOpportunityTags(oppId, ids)
    if (res && 'error' in (res as { error?: string }) && (res as { error?: string }).error) {
      toast.error((res as { error?: string }).error!)
    }
  }

  async function saveCustomFields(v: Record<string, unknown>) {
    if (!oppId) return
    const res = await updateOpportunity(oppId, { custom_fields: v })
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      return
    }
    setOpp((prev) => (prev ? { ...prev, custom_fields: v } : prev))
  }

  async function handleDelete() {
    if (!opp) return
    setDeleting(true)
    const res = await deleteOpportunity(opp.id)
    setDeleting(false)
    setConfirmDelete(false)
    if (res && 'error' in res && res.error) {
      toast.error(res.error)
      return
    }
    toast.success('Opportunity deleted')
    onOpenChange(false)
    router.refresh()
  }

  const stage = opp ? stages.find((s) => s.id === opp.stage_id) : undefined
  const status = (opp?.status as OpportunityStatus) ?? 'open'

  return (
    <>
      <Dialog open={Boolean(opportunityId)} onOpenChange={onOpenChange}>
        <DialogContent
          className={cn(
            'flex flex-col overflow-hidden p-0 gap-0 bg-bg-secondary',
            // Mobile: near-fullscreen. Desktop: capped width + height.
            'w-[calc(100vw-1rem)] h-[calc(100dvh-1rem)]',
            'sm:w-[calc(100vw-2rem)] md:h-[min(820px,calc(100vh-2rem))] md:max-w-[960px]',
          )}
        >
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
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <VisuallyHidden><DialogTitle>{opp.title}</DialogTitle></VisuallyHidden>
              <VisuallyHidden>
                <DialogDescription>Edit opportunity details, contact, tasks and notes.</DialogDescription>
              </VisuallyHidden>

              {/* ── Header: inline title + value, display badges ──────────── */}
              <div className="shrink-0 border-b border-border-subtle px-5 pt-5 pb-4 pr-14">
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
                  {/* Only show the status badge when it adds information the stage
                      badge doesn't already convey. If the stage is already a
                      won/lost stage, the status badge is redundant. */}
                  {!(status === 'won' && stage?.is_won) && !(status === 'lost' && stage?.is_lost) && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-medium uppercase tracking-wider',
                        status === 'won' && 'bg-emerald-500/10 text-emerald-400',
                        status === 'lost' && 'bg-rose-500/10 text-rose-400',
                        status === 'open' && 'bg-bg-tertiary text-text-tertiary',
                      )}
                    >
                      {status}
                    </span>
                  )}
                </div>
                <div className="mt-2">
                  <InlineEditField
                    value={opp.title}
                    placeholder="Untitled opportunity"
                    onSave={saveField('title')}
                    allowEmpty={false}
                    ariaLabel="Edit title"
                    className="!px-1 [&_span]:text-[20px] [&_span]:font-semibold [&_span]:tracking-tight"
                  />
                </div>
                <div className="mt-0.5">
                  <InlineValueField
                    value={Number(opp.value) || 0}
                    currency={defaultCurrency}
                    onSave={saveValue}
                  />
                </div>
              </div>

              {/* ── Body: nav + content (column on mobile, row on desktop) ── */}
              <div className="flex min-h-0 flex-1 flex-col overflow-hidden md:flex-row">
                {/* Nav: horizontal scroll tabs on mobile, vertical sidebar on md+ */}
                <nav
                  className={cn(
                    'shrink-0 border-border-subtle',
                    'flex gap-1 overflow-x-auto border-b px-2 py-2',
                    'md:w-48 md:flex-col md:gap-0.5 md:overflow-x-visible md:border-b-0 md:border-r md:px-2 md:py-3',
                  )}
                >
                  {SIDE_ITEMS.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setSection(id)}
                      className={cn(
                        'flex shrink-0 items-center gap-2 rounded-[7px] px-3 py-2 text-left text-[13px] font-medium transition-colors',
                        'md:w-full',
                        section === id
                          ? 'bg-bg-tertiary text-text-primary'
                          : 'text-text-secondary hover:bg-bg-tertiary/50 hover:text-text-primary',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-3.5 w-3.5 shrink-0',
                          section === id ? 'text-accent' : 'text-text-tertiary',
                        )}
                      />
                      <span>{label}</span>
                    </button>
                  ))}
                </nav>

                {/* Content */}
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
                  {/* DETAILS */}
                  {section === 'details' && (
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                      <div className="space-y-3">
                        <FieldRow label="Stage">
                          <Select value={opp.stage_id} onValueChange={saveStage}>
                            <SelectTrigger className="h-9 rounded-[8px] border-border-subtle bg-bg-secondary text-[12.5px] hover:bg-bg-tertiary focus:ring-accent">
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
                        </FieldRow>

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <FieldRow label="Status">
                            <Select value={status} onValueChange={(v) => saveStatus(v as OpportunityStatus)}>
                              <SelectTrigger className="h-9 rounded-[8px] border-border-subtle bg-bg-secondary text-[12.5px] hover:bg-bg-tertiary focus:ring-accent">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="open">Open</SelectItem>
                                <SelectItem value="won">Won</SelectItem>
                                <SelectItem value="lost">Lost</SelectItem>
                              </SelectContent>
                            </Select>
                          </FieldRow>
                          <FieldRow label="Expected close">
                            <DatePickerField
                              value={opp.expected_close_date ?? ''}
                              onChange={(v) => void saveField('expected_close_date')(v)}
                            />
                          </FieldRow>
                        </div>

                        <FieldRow label="Tags">
                          <TagPicker
                            allTags={allTags}
                            value={tagIds}
                            onChange={saveTags}
                            onTagCreated={(tag) =>
                              setAllTags((prev) => [...prev, tag].sort((a, b) => a.name.localeCompare(b.name)))
                            }
                          />
                        </FieldRow>

                        <CustomFieldsForm
                          entity="opportunity"
                          value={(opp.custom_fields as Record<string, unknown>) ?? {}}
                          onChange={saveCustomFields}
                        />
                      </div>
                    </div>
                  )}

                  {/* CONTACT */}
                  {section === 'contact' && (
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                      {opp.contact ? (
                        <div className="space-y-3">
                          <div className="flex items-center gap-3 rounded-[10px] border border-border-subtle bg-bg-secondary p-3">
                            <Avatar className="h-10 w-10 shrink-0">
                              <AvatarFallback className="bg-accent-muted text-accent text-[13px] font-semibold">
                                {initialsFromContactName(
                                  opp.contact,
                                  opp.contact.email ?? opp.contact.phone ?? '?',
                                )}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-[14px] font-medium text-text-primary">
                                {displayContactName(opp.contact, 'Unnamed')}
                              </div>
                              <div className="truncate text-[12px] text-text-tertiary">
                                {opp.contact.phone
                                  ? formatPhoneDisplay(opp.contact.phone)
                                  : opp.contact.email ?? ''}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => void saveContact(null)}
                              className="shrink-0 rounded p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary"
                              aria-label="Unlink contact"
                              title="Unlink contact"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {opp.contact.email && (
                              <InfoCell label="Email" value={formatEmailDisplay(opp.contact.email)} />
                            )}
                            {opp.contact.phone && (
                              <InfoCell label="Phone" value={formatPhoneDisplay(opp.contact.phone)} />
                            )}
                            {opp.contact.company && (
                              <InfoCell label="Company" value={opp.contact.company} />
                            )}
                          </div>
                          <Button asChild variant="secondary" size="sm" className="gap-1.5">
                            <Link href={`/chat?contact=${opp.contact.id}`} onClick={() => onOpenChange(false)}>
                              Open contact <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label className="text-[12px] text-text-secondary">Link a contact</Label>
                          <div className="relative">
                            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
                            <Input
                              value={contactQuery}
                              onChange={(e) => {
                                setContactQuery(e.target.value)
                                setContactPickerOpen(true)
                              }}
                              onFocus={() => setContactPickerOpen(true)}
                              onBlur={() => setTimeout(() => setContactPickerOpen(false), 150)}
                              placeholder="Search by name, phone, or email"
                              className="pl-8"
                            />
                            {contactPickerOpen && contactSuggestions.length > 0 && (
                              <div className="absolute z-50 mt-1 max-h-[240px] w-full overflow-y-auto rounded-[8px] border border-border-subtle bg-bg-primary shadow-elevation-md">
                                {contactSuggestions.map((s) => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onClick={() => void saveContact(s)}
                                    className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-bg-secondary"
                                  >
                                    <div className="min-w-0">
                                      <div className="truncate text-[12.5px] font-medium text-text-primary">
                                        {displayContactName(s, 'Unnamed')}
                                      </div>
                                      <div className="truncate text-[11px] text-text-tertiary">
                                        {s.phone ? formatPhoneDisplay(s.phone) : formatEmailDisplay(s.email)}
                                      </div>
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ACTIVITY */}
                  {section === 'activity' && (
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                      {activities.length === 0 ? (
                        <p className="py-8 text-center text-[12.5px] text-text-tertiary">No activity yet.</p>
                      ) : (
                        <div className="space-y-0">
                          {activities.map((a, i) => (
                            <ActivityFeedItem key={a.id} activity={a} last={i === activities.length - 1} />
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TASKS */}
                  {section === 'tasks' && (
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                      {tasks === null ? (
                        <Loading />
                      ) : (
                        <TasksTable
                          tasks={tasks}
                          prefill={{ entity_type: 'opportunity', entity_id: opp.id }}
                          compact
                        />
                      )}
                    </div>
                  )}

                  {/* NOTES */}
                  {section === 'notes' && (
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                      {notes === null ? (
                        <Loading />
                      ) : (
                        <NotesGrid
                          notes={notes}
                          prefill={{ entity_type: 'opportunity', entity_id: opp.id }}
                          compact
                        />
                      )}
                    </div>
                  )}

                  {/* SCHEDULING */}
                  {section === 'scheduling' && (
                    <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
                      {!schedLoaded ? (
                        <Loading />
                      ) : !profile || eventTypes.length === 0 ? (
                        <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                          <CalendarPlus className="h-8 w-8 text-text-tertiary" />
                          <div>
                            <p className="text-[13px] font-medium text-text-secondary">
                              Scheduling isn&apos;t set up yet
                            </p>
                            <p className="mx-auto mt-1 max-w-[280px] text-[12px] text-text-tertiary">
                              Connect a calendar and create an event type to start booking
                              meetings from opportunities.
                            </p>
                          </div>
                          <Button asChild size="sm" className="gap-1.5">
                            <Link href="/scheduling" onClick={() => onOpenChange(false)}>
                              <CalendarDays className="h-3.5 w-3.5" />
                              Set up scheduling
                            </Link>
                          </Button>
                        </div>
                      ) : (
                        <div className="space-y-2">
                          <Label className="text-[12px] text-text-secondary">Event types</Label>
                          <div className="divide-y divide-border-subtle rounded-[10px] border border-border-subtle">
                            {eventTypes.map((et) => (
                              <Link
                                key={et.id}
                                href={`/book/${profile.slug}/${et.slug}`}
                                onClick={() => onOpenChange(false)}
                                className="flex items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-bg-tertiary/40"
                              >
                                <span
                                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                                  style={{ backgroundColor: et.color }}
                                />
                                <span className="min-w-0 flex-1 truncate text-[12.5px] text-text-primary">
                                  {et.title}
                                </span>
                                <span className="shrink-0 text-[11px] text-text-tertiary">
                                  {et.duration_minutes} min
                                </span>
                                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                              </Link>
                            ))}
                          </div>
                          <Button asChild variant="ghost" size="sm" className="gap-1.5">
                            <Link href="/scheduling" onClick={() => onOpenChange(false)}>
                              Manage scheduling <ExternalLink className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* ── Footer ─────────────────────────────────────────────────── */}
              <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border-subtle px-5 py-3">
                <div className="space-y-0.5 text-[11px] leading-relaxed text-text-tertiary">
                  <div>
                    Created On: <span className="text-text-secondary">{formatDateTimeTz(opp.created_at, timezone)}</span>
                  </div>
                  <div className="hidden sm:block">
                    Audit Logs: <span className="font-mono text-text-secondary">{opp.id}</span>
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleting}
                  className="shrink-0 gap-1.5 text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
                >
                  {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this opportunity?</AlertDialogTitle>
            <AlertDialogDescription>
              {opp ? `"${opp.title}" will be permanently removed. This cannot be undone.` : ''}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                void handleDelete()
              }}
              disabled={deleting}
              className="bg-rose-500 hover:bg-rose-600"
            >
              {deleting ? 'Deleting…' : 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

/**
 * Inline currency editor for the header value. Display shows the formatted
 * amount; clicking swaps to a raw-number input with Save/Cancel (reusing
 * InlineEditActions). Mirrors InlineEditField's commit/rollback/toast loop.
 */
function InlineValueField({
  value,
  currency,
  onSave,
}: {
  value: number
  currency: string
  onSave: (next: number) => Promise<void>
}) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(String(value))
  const [saving, setSaving] = React.useState(false)
  const inputRef = React.useRef<HTMLInputElement | null>(null)

  React.useEffect(() => {
    if (!editing) setDraft(String(value))
  }, [value, editing])

  React.useEffect(() => {
    if (editing) inputRef.current?.focus()
  }, [editing])

  async function commit() {
    const n = Number(draft.replace(/[^0-9.,-]/g, '').replace(',', '.'))
    const parsed = isNaN(n) ? 0 : n
    if (parsed === value) {
      setEditing(false)
      return
    }
    setSaving(true)
    try {
      await onSave(parsed)
      setEditing(false)
      toast.success('Saved')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not save')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <div
        className="flex w-full items-center gap-1"
        onBlur={(e) => {
          const next = e.relatedTarget as Node | null
          if (next && e.currentTarget.contains(next)) return
          void commit()
        }}
      >
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit()
            } else if (e.key === 'Escape') {
              e.preventDefault()
              setDraft(String(value))
              setEditing(false)
            }
          }}
          inputMode="decimal"
          disabled={saving}
          className="h-9 max-w-[200px] text-[18px] font-semibold tabular-nums"
        />
        <InlineEditActions saving={saving} onSave={() => void commit()} onCancel={() => setEditing(false)} />
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => setEditing(true)}
      className="group inline-flex items-center gap-1.5 rounded-[6px] px-1 py-0.5 text-left transition-colors hover:bg-bg-tertiary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      title="Click to edit value"
    >
      <span className="text-[28px] font-semibold leading-[1.1] tabular-nums text-accent">
        {formatCurrency(value, currency)}
      </span>
    </button>
  )
}

// ── Inline date picker (calendar popover) ────────────────────────────────────
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DOW = ['Su','Mo','Tu','We','Th','Fr','Sa']

function DatePickerField({
  value,
  onChange,
}: {
  value: string       // 'YYYY-MM-DD' or ''
  onChange: (v: string) => void
}) {
  const [open, setOpen] = React.useState(false)
  const today = new Date()
  const parsed = value ? new Date(value + 'T00:00:00') : null
  const [view, setView] = React.useState<{ year: number; month: number }>(() => {
    const d = parsed ?? today
    return { year: d.getFullYear(), month: d.getMonth() }
  })

  function prevMonth() {
    setView((v) => v.month === 0 ? { year: v.year - 1, month: 11 } : { ...v, month: v.month - 1 })
  }
  function nextMonth() {
    setView((v) => v.month === 11 ? { year: v.year + 1, month: 0 } : { ...v, month: v.month + 1 })
  }

  const firstDay = new Date(view.year, view.month, 1).getDay()
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate()
  const cells: (number | null)[] = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)]

  function select(day: number) {
    const mm = String(view.month + 1).padStart(2, '0')
    const dd = String(day).padStart(2, '0')
    const iso = `${view.year}-${mm}-${dd}`
    onChange(iso)
    setOpen(false)
  }

  function clear(e: React.MouseEvent) {
    e.stopPropagation()
    onChange('')
  }

  const displayLabel = parsed
    ? parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'Pick a date'

  const isSelected = (day: number) => {
    if (!parsed) return false
    return parsed.getFullYear() === view.year && parsed.getMonth() === view.month && parsed.getDate() === day
  }
  const isToday = (day: number) =>
    today.getFullYear() === view.year && today.getMonth() === view.month && today.getDate() === day

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-[8px] border border-border-subtle',
            'bg-bg-secondary px-3 py-2 text-[12.5px] transition-colors',
            'hover:bg-bg-tertiary focus:outline-none focus-visible:ring-2 focus-visible:ring-accent',
            parsed ? 'text-text-primary' : 'text-text-tertiary',
          )}
        >
          <div className="flex items-center gap-2">
            <CalendarDays className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
            {displayLabel}
          </div>
          {parsed && (
            <span
              role="button"
              tabIndex={0}
              onClick={clear}
              onKeyDown={(e) => e.key === 'Enter' && clear(e as unknown as React.MouseEvent)}
              className="rounded p-0.5 text-text-tertiary hover:text-text-primary"
              aria-label="Clear date"
            >
              <X className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-auto p-0 border border-border-subtle bg-bg-secondary shadow-elevation-lg rounded-[12px] overflow-hidden"
      >
        {/* Month navigation */}
        <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle">
          <button type="button" onClick={prevMonth} className="rounded-[6px] p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-[12.5px] font-semibold text-text-primary">
            {MONTHS[view.month]} {view.year}
          </span>
          <button type="button" onClick={nextMonth} className="rounded-[6px] p-1 text-text-tertiary hover:bg-bg-tertiary hover:text-text-primary transition-colors">
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {/* Day-of-week header */}
        <div className="grid grid-cols-7 px-2 pt-2">
          {DOW.map((d) => (
            <div key={d} className="flex h-7 items-center justify-center text-[10.5px] font-medium text-text-tertiary">
              {d}
            </div>
          ))}
        </div>
        {/* Day cells */}
        <div className="grid grid-cols-7 gap-y-0.5 px-2 pb-3">
          {cells.map((day, i) =>
            day == null ? (
              <div key={`e-${i}`} />
            ) : (
              <button
                key={day}
                type="button"
                onClick={() => select(day)}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-medium transition-colors',
                  isSelected(day)
                    ? 'bg-accent text-white'
                    : isToday(day)
                    ? 'text-accent ring-1 ring-accent/50 hover:bg-accent/10'
                    : 'text-text-primary hover:bg-bg-tertiary',
                )}
              >
                {day}
              </button>
            ),
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[12px] font-medium text-text-secondary">{label}</Label>
      {children}
    </div>
  )
}

function InfoCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[8px] border border-border-subtle px-3 py-2">
      <div className="text-[10.5px] uppercase tracking-wide text-text-tertiary">{label}</div>
      <div className="mt-0.5 truncate text-[12.5px] text-text-primary">{value}</div>
    </div>
  )
}

function Loading() {
  return (
    <div className="flex items-center justify-center py-10">
      <Loader2 className="h-4 w-4 animate-spin text-text-tertiary" />
    </div>
  )
}

'use client'

/**
 * Contact info panel (SEED-039 rewrite).
 *
 * The right sidebar of the chat inbox. Surfaces the full client picture:
 *   - Inline-editable contact fields (name, phone, email, company)
 *   - Available reach channels derived from phone/email + open conversations
 *   - Quick action buttons (task / schedule / note / deal)
 *   - Collapsible sections in order: Info, Tasks, Bookings, Notes,
 *     Opportunities, Other conversations
 *   - Custom fields rendered using FIELD_RENDER_CONFIG (read-only display for
 *     non-text types, inline editable for text/long_text/number/email/url)
 *
 * Renders gracefully when `contactId` is null | falls back to the
 * UnregisteredCard with a CTA to create the contact pre-filled with whatever
 * signals the conversation already has.
 */

import * as React from 'react'
import Link from 'next/link'
import {
  Phone,
  Mail,
  Building2,
  Calendar,
  MapPin,
  Pencil,
  PhoneCall,
  TrendingUp,
  UserPlus,
  StickyNote,
  Plus,
  ChevronDown,
  X,
  PanelRightClose,
  CheckCircle2,
  Circle,
  CalendarCheck,
  CalendarPlus,
  Briefcase,
  ListTodo,
  MessageCircle,
  MessageSquare,
  ExternalLink,
} from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import {
  getContact,
  updateContactField,
  addContactNote,
  type ContactDetail,
} from '@/app/(dashboard)/contacts/actions'
import { NewContactDialog } from '@/components/contacts/new-contact-dialog'
import { InlineContactPicker } from '@/components/chat/inline-contact-picker'
import { InlineEditField } from '@/components/chat/inline-edit-field'
import { FIELD_RENDER_CONFIG } from '@/lib/custom-fields/render-config'
import type { CustomFieldType } from '@/types/database'
import { formatCurrency } from '@/lib/pipeline/format'
import { prefillDialPad } from '@/components/calls/dial-pad-context'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface ContactInfoPanelProps {
  contactId: string | null
  conversationId?: string | null
  fallbackName?: string | null
  fallbackPhone?: string | null
  fallbackEmail?: string | null
  onClose?: () => void
  onCollapse?: () => void
}

function initialsOf(name: string | null, phone: string | null, email: string | null): string {
  const base = name || email || phone || '?'
  const parts = base.replace(/[^a-zA-Z0-9 ]/g, ' ').trim().split(/\s+/)
  if (parts.length >= 2 && parts[0] && parts[1]) {
    return (parts[0][0] + parts[1][0]).toUpperCase()
  }
  return base.slice(0, 2).toUpperCase()
}

function relativeTime(iso: string | null): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

function shortDate(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow =
    d.getFullYear() === tomorrow.getFullYear() &&
    d.getMonth() === tomorrow.getMonth() &&
    d.getDate() === tomorrow.getDate()
  if (sameDay) return `Today ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  if (isTomorrow) return `Tomorrow ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

function dueChipStyle(iso: string | null): { label: string; cls: string } {
  if (!iso) return { label: 'No date', cls: 'bg-bg-tertiary text-text-tertiary' }
  const due = new Date(iso).getTime()
  const now = Date.now()
  const diffMs = due - now
  const day = 24 * 60 * 60 * 1000
  if (diffMs < 0) return { label: shortDate(iso), cls: 'bg-rose-500/15 text-rose-400' }
  if (diffMs < day) return { label: shortDate(iso), cls: 'bg-amber-500/15 text-amber-400' }
  return { label: shortDate(iso), cls: 'bg-bg-tertiary text-text-tertiary' }
}

interface ReachChannel {
  channel: Channel
  label: string
  active: boolean
  /** When a matching open conversation exists, prefer linking to it. */
  conversationId?: string
}

function availableChannelsForContact(contact: ContactDetail): ReachChannel[] {
  const out: ReachChannel[] = []
  const openConvs = (contact.conversations ?? []).filter(
    (c) => c.status === 'open' || c.status === 'pending' || c.status === 'waiting',
  )
  const firstByChannel = (...names: string[]): string | undefined =>
    openConvs.find((c) => names.includes(c.channel))?.id

  if (contact.phone) {
    out.push({
      channel: 'whatsapp',
      label: 'WhatsApp',
      active: Boolean(firstByChannel('whatsapp', 'ghl_whatsapp')),
      conversationId: firstByChannel('whatsapp', 'ghl_whatsapp'),
    })
    out.push({
      channel: 'sms',
      label: 'SMS',
      active: Boolean(firstByChannel('sms', 'ghl_sms')),
      conversationId: firstByChannel('sms', 'ghl_sms'),
    })
    const voiceConv = firstByChannel('voice')
    if (voiceConv) out.push({ channel: 'voice', label: 'Voice', active: true, conversationId: voiceConv })
  }
  const messengerConv = firstByChannel('messenger')
  if (messengerConv) {
    out.push({ channel: 'messenger', label: 'Messenger', active: true, conversationId: messengerConv })
  }
  const instaConv = firstByChannel('instagram')
  if (instaConv) {
    out.push({ channel: 'instagram', label: 'Instagram', active: true, conversationId: instaConv })
  }
  const webConv = firstByChannel('widget', 'web')
  if (webConv) {
    out.push({ channel: 'web', label: 'Web', active: true, conversationId: webConv })
  }
  return out
}

export function ContactInfoPanel({
  contactId,
  conversationId,
  fallbackName,
  fallbackPhone,
  fallbackEmail,
  onClose,
  onCollapse,
}: ContactInfoPanelProps) {
  const [contact, setContact] = React.useState<ContactDetail | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [refreshKey, setRefreshKey] = React.useState(0)

  React.useEffect(() => {
    if (!contactId) {
      setContact(null)
      return
    }
    let cancelled = false
    setLoading(true)
    getContact(contactId).then((c) => {
      if (cancelled) return
      setContact(c)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [contactId, refreshKey])

  const refresh = React.useCallback(() => setRefreshKey((k) => k + 1), [])

  const saveField = React.useCallback(
    (field: string) => async (value: string) => {
      if (!contactId) throw new Error('No contact')
      const res = await updateContactField(contactId, { field, value })
      if (!res.ok) throw new Error(res.error ?? 'Save failed')
      // Update local state with the new value so subsequent renders pick it up
      // without a full refetch.
      setContact((prev) => {
        if (!prev) return prev
        if (field === 'name') return { ...prev, name: value || null }
        if (field === 'phone') return { ...prev, phone: value || null }
        if (field === 'email') return { ...prev, email: value || null }
        if (field === 'company') return { ...prev, company: value || null }
        if (field.startsWith('custom_fields.')) {
          const key = field.slice('custom_fields.'.length)
          const cf = { ...((prev.custom_fields as Record<string, unknown> | null) ?? {}) }
          if (value.trim() === '') delete cf[key]
          else cf[key] = value
          return { ...prev, custom_fields: cf }
        }
        return prev
      })
    },
    [contactId],
  )

  if (!contactId) {
    return (
      <UnregisteredCard
        conversationId={conversationId ?? null}
        name={fallbackName ?? null}
        phone={fallbackPhone ?? null}
        email={fallbackEmail ?? null}
        onClose={onClose}
        onCollapse={onCollapse}
      />
    )
  }

  if (loading && !contact) {
    return (
      <div className="flex h-full flex-col border-l border-border-subtle bg-bg-secondary/40 p-5 pt-safe pb-safe">
        <div className="space-y-3 animate-pulse">
          <div className="h-14 w-14 rounded-full bg-bg-tertiary" />
          <div className="h-4 w-2/3 rounded bg-bg-tertiary" />
          <div className="h-3 w-1/2 rounded bg-bg-tertiary" />
        </div>
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="flex h-full flex-col border-l border-border-subtle bg-bg-secondary/40 p-5 pt-safe pb-safe">
        <p className="text-[13px] text-text-secondary">Contact not found.</p>
      </div>
    )
  }

  const reach = availableChannelsForContact(contact)
  const customFields = (contact.custom_fields as Record<string, unknown> | null) ?? {}

  return (
    // SEED-040: pt-safe / pb-safe respect the iPhone notch + home indicator
    // when the panel takes over the full mobile viewport. On desktop the
    // safe-area insets resolve to 0 so the panel behaves identically.
    <div className="flex h-full flex-col border-l border-border-subtle bg-bg-secondary/40 pt-safe pb-safe">
      {/* Header */}
      <div className="border-b border-border-subtle px-5 py-5 relative">
        <div className="absolute right-3 top-3 flex items-center gap-1">
          {onCollapse && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 hidden md:inline-flex"
              onClick={onCollapse}
              title="Collapse contact panel"
              aria-label="Collapse contact panel"
            >
              <PanelRightClose className="h-4 w-4" />
            </Button>
          )}
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 md:hidden"
              onClick={onClose}
              aria-label="Close contact panel"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
        <div className="flex items-start gap-3">
          <Avatar className="h-14 w-14">
            <AvatarFallback className="bg-accent-muted text-accent text-[15px] font-semibold">
              {initialsOf(contact.name, contact.phone, contact.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <InlineEditField
              value={contact.name}
              placeholder="Unnamed contact"
              onSave={saveField('name')}
              ariaLabel="Edit name"
              className="!px-1 [&_span]:text-[16px] [&_span]:font-semibold [&_span]:tracking-tight"
            />
            {contact.account ? (
              <Link
                href={`/companies/${contact.account.id}`}
                className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate px-1 text-[12px] text-text-secondary hover:text-accent transition-colors"
                title={`Open account ${contact.account.name}`}
              >
                <Building2 className="h-3 w-3 shrink-0" />
                <span className="truncate">{contact.account.name}</span>
                <ExternalLink className="h-2.5 w-2.5 shrink-0 opacity-60" />
              </Link>
            ) : contact.company ? (
              <p className="mt-0.5 truncate px-1 text-[12px] text-text-secondary">{contact.company}</p>
            ) : null}
            {contact.tags.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {contact.tags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center rounded-full bg-accent-muted px-2 py-0.5 text-[10.5px] font-medium text-accent"
                  >
                    {t}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* SEED-039: quick channel action buttons (Call / WhatsApp / SMS).
            Call always available when phone exists. WhatsApp/SMS deep-link to
            their open conversation when one exists, otherwise rendered disabled
            to communicate that the channel isn't reachable yet. Additional
            channels (Messenger/Instagram/Web/Voice) only appear when there is
            an existing conversation to switch into. */}
        {(contact.phone || reach.length > 0) && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5">
            {contact.phone && (
              <ChannelActionButton
                icon={Phone}
                label="Call"
                onClick={() => prefillDialPad(contact.phone!)}
                title={`Call ${contact.phone}`}
              />
            )}
            {contact.phone && (() => {
              const wa = reach.find((r) => r.channel === 'whatsapp')
              return (
                <ChannelActionButton
                  icon={MessageCircle}
                  label="WhatsApp"
                  href={wa?.conversationId ? `/chat?conversation=${wa.conversationId}` : undefined}
                  disabled={!wa?.conversationId}
                  accent="emerald"
                  title={
                    wa?.conversationId
                      ? 'Open WhatsApp thread'
                      : 'No WhatsApp conversation yet'
                  }
                />
              )
            })()}
            {contact.phone && (() => {
              const sms = reach.find((r) => r.channel === 'sms')
              return (
                <ChannelActionButton
                  icon={MessageSquare}
                  label="SMS"
                  href={sms?.conversationId ? `/chat?conversation=${sms.conversationId}` : undefined}
                  disabled={!sms?.conversationId}
                  title={sms?.conversationId ? 'Open SMS thread' : 'No SMS conversation yet'}
                />
              )
            })()}
            {/* Extra channels: only show when there is a thread to jump to */}
            {reach
              .filter((r) => !['whatsapp', 'sms'].includes(r.channel) && r.conversationId)
              .map((r) => (
                <ChannelActionButton
                  key={`${r.channel}-${r.conversationId}`}
                  label={r.label}
                  href={`/chat?conversation=${r.conversationId}`}
                  badgeChannel={r.channel}
                  title={`Open ${r.label} thread`}
                />
              ))}
            {contact.email && (
              <ChannelActionButton
                icon={Mail}
                label="Email"
                href={`mailto:${contact.email}`}
                title={`Email ${contact.email}`}
              />
            )}
          </div>
        )}

        {/* SEED-039: quick actions */}
        <div className="mt-4 grid grid-cols-4 gap-1.5">
          <Button asChild size="sm" variant="secondary" className="h-8 px-2 text-[11.5px]">
            <Link href={`/tasks?contactId=${contact.id}&compose=1`} title="Create task">
              <ListTodo className="h-3 w-3" />
              Task
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary" className="h-8 px-2 text-[11.5px]">
            <Link href={`/scheduling?contactId=${contact.id}`} title="Schedule a meeting">
              <CalendarPlus className="h-3 w-3" />
              Schedule
            </Link>
          </Button>
          <NoteQuickAction contactId={contact.id} onSaved={refresh} />
          <Button asChild size="sm" variant="secondary" className="h-8 px-2 text-[11.5px]">
            <Link href={`/pipeline/new?contact_id=${contact.id}`} title="Create deal">
              <Briefcase className="h-3 w-3" />
              Deal
            </Link>
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 py-5 space-y-4">
          {/* ── Info ── */}
          <Section
            title="Info"
            defaultOpen
            actions={
              <Link
                href={`/contacts?id=${contact.id}`}
                className="text-[10px] text-text-tertiary hover:text-text-secondary"
              >
                <Pencil className="h-3 w-3 inline" /> Edit
              </Link>
            }
          >
            <InlineRow icon={Phone} label="Phone">
              <InlineEditField
                value={contact.phone}
                placeholder="Add phone"
                type="tel"
                onSave={saveField('phone')}
                ariaLabel="Edit phone"
              />
            </InlineRow>
            <InlineRow icon={Mail} label="Email">
              <InlineEditField
                value={contact.email}
                placeholder="Add email"
                type="email"
                onSave={saveField('email')}
                ariaLabel="Edit email"
              />
            </InlineRow>
            <InlineRow icon={Building2} label="Company">
              {contact.account ? (
                <Link
                  href={`/companies/${contact.account.id}`}
                  className="inline-flex w-full items-center gap-1 truncate rounded-[6px] px-1.5 py-0.5 text-[12.5px] text-text-primary hover:bg-bg-tertiary hover:text-accent transition-colors"
                  title={`Open account ${contact.account.name}`}
                >
                  <span className="truncate">{contact.account.name}</span>
                  <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                </Link>
              ) : (
                <InlineEditField
                  value={contact.company}
                  placeholder="Add company"
                  onSave={saveField('company')}
                  ariaLabel="Edit company"
                />
              )}
            </InlineRow>
            {contact.account?.address && (
              <InfoRow icon={MapPin} label="Address" value={contact.account.address} />
            )}
            <InfoRow
              icon={Calendar}
              label="Created"
              value={`${relativeTime(contact.created_at)} · ${contact.source}`}
            />
            {contact.notes && (
              <div className="mt-2 rounded-[8px] border border-border-subtle bg-bg-secondary px-3 py-2.5">
                <div className="text-[10px] font-medium uppercase tracking-wide text-text-tertiary">
                  Notes
                </div>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-text-primary">
                  {contact.notes}
                </p>
              </div>
            )}

            {/* SEED-039: custom fields rendered inline. */}
            {contact.customFieldDefs.length > 0 && (
              <div className="mt-2 space-y-2">
                {contact.customFieldDefs.map((def) => {
                  const raw = customFields[def.key]
                  const config = FIELD_RENDER_CONFIG[def.type as CustomFieldType]
                  const display = raw !== undefined && raw !== null && config
                    ? config.displayFormatter(raw)
                    : ''
                  const editableTypes = ['text', 'long_text', 'number', 'integer', 'url', 'email', 'phone', 'date']
                  const editable = editableTypes.includes(def.type)
                  return (
                    <div key={def.id} className="flex items-start gap-2.5">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-bg-tertiary ring-1 ring-border-subtle text-text-tertiary">
                        <Pencil className="h-3 w-3" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10px] uppercase tracking-wide text-text-tertiary">
                          {def.label}
                        </div>
                        {editable ? (
                          <InlineEditField
                            value={display || null}
                            placeholder="|"
                            type={def.type === 'email' ? 'email' : 'text'}
                            multiline={def.type === 'long_text'}
                            onSave={saveField(`custom_fields.${def.key}`)}
                            ariaLabel={`Edit ${def.label}`}
                          />
                        ) : (
                          <div
                            className={cn(
                              'text-[12.5px] px-1',
                              display ? 'text-text-primary' : 'italic text-text-tertiary',
                            )}
                          >
                            {display || '|'}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>

          {/* ── Tasks ── */}
          <Section
            title={`Tasks ${contact.tasks.length > 0 ? `(${contact.tasks.length})` : ''}`}
            defaultOpen={contact.tasks.length > 0}
            actions={
              <Link
                href={`/tasks?contactId=${contact.id}&compose=1`}
                className="text-[10px] text-text-tertiary hover:text-text-secondary"
              >
                <Plus className="h-3 w-3 inline" /> New
              </Link>
            }
          >
            {contact.tasks.length === 0 ? (
              <EmptyMini text="No tasks yet." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {contact.tasks.map((t) => {
                  const due = dueChipStyle(t.due_date)
                  const done = t.status === 'done'
                  return (
                    <Link
                      key={t.id}
                      href={`/tasks?id=${t.id}`}
                      className="group flex items-center gap-2.5 rounded-[8px] border border-border-subtle bg-bg-secondary px-2.5 py-2 hover:border-border-strong transition-colors"
                    >
                      {done ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      ) : (
                        <Circle className="h-3.5 w-3.5 shrink-0 text-text-tertiary" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            'truncate text-[12px]',
                            done ? 'text-text-tertiary line-through' : 'text-text-primary',
                          )}
                        >
                          {t.title}
                        </div>
                        {t.priority !== 'medium' && (
                          <span className="text-[10px] uppercase tracking-wide text-text-tertiary">
                            {t.priority}
                          </span>
                        )}
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                          due.cls,
                        )}
                      >
                        {due.label}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </Section>

          {/* ── Bookings ── */}
          <Section
            title={`Bookings ${contact.bookings.length > 0 ? `(${contact.bookings.length})` : ''}`}
            defaultOpen={contact.bookings.length > 0}
            actions={
              <Link
                href={`/scheduling?contactId=${contact.id}`}
                className="text-[10px] text-text-tertiary hover:text-text-secondary"
              >
                <Plus className="h-3 w-3 inline" /> New
              </Link>
            }
          >
            {contact.bookings.length === 0 ? (
              <EmptyMini text="No bookings." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {contact.bookings.map((b) => {
                  const statusCls =
                    b.status === 'cancelled'
                      ? 'bg-rose-500/15 text-rose-400'
                      : b.status === 'no_show'
                        ? 'bg-amber-500/15 text-amber-400'
                        : 'bg-emerald-500/15 text-emerald-400'
                  return (
                    <Link
                      key={b.id}
                      href={`/scheduling/bookings/${b.id}`}
                      className="group flex items-center gap-2.5 rounded-[8px] border border-border-subtle bg-bg-secondary px-2.5 py-2 hover:border-border-strong transition-colors"
                    >
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-accent-muted text-accent">
                        <CalendarCheck className="h-3 w-3" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] text-text-primary">
                          {b.event_type_name || 'Booking'}
                        </div>
                        <div className="text-[10.5px] text-text-tertiary">
                          {shortDate(b.start_at)}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-medium capitalize',
                          statusCls,
                        )}
                      >
                        {b.status.replace('_', ' ')}
                      </span>
                    </Link>
                  )
                })}
              </div>
            )}
          </Section>

          {/* ── Notes (notes table) ── */}
          <Section
            title={`Notes ${contact.contact_notes.length > 0 ? `(${contact.contact_notes.length})` : ''}`}
            defaultOpen={contact.contact_notes.length > 0}
            actions={<NoteQuickActionInline contactId={contact.id} onSaved={refresh} />}
          >
            {contact.contact_notes.length === 0 ? (
              <EmptyMini text="No notes yet." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {contact.contact_notes.map((n) => (
                  <div
                    key={n.id}
                    className="rounded-[8px] border border-border-subtle bg-bg-secondary px-2.5 py-2"
                  >
                    <p className="line-clamp-3 text-[12px] leading-relaxed text-text-primary">
                      {n.content}
                    </p>
                    <p className="mt-1 text-[10.5px] text-text-tertiary">
                      {relativeTime(n.created_at)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>

          {/* ── Opportunities ── */}
          <Section
            title={`Opportunities ${contact.opportunities.length > 0 ? `(${contact.opportunities.length})` : ''}`}
            defaultOpen={contact.opportunities.length > 0}
          >
            {contact.opportunities.length === 0 ? (
              <EmptyMini text="No deals linked." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {contact.opportunities.slice(0, 5).map((o) => (
                  <Link
                    key={o.id}
                    href={`/pipeline/${o.id}`}
                    className="group flex items-center gap-2.5 rounded-[8px] border border-border-subtle bg-bg-secondary px-2.5 py-2 hover:border-border-strong transition-colors"
                  >
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px] bg-accent-muted text-accent">
                      <TrendingUp className="h-3 w-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] font-medium text-text-primary">
                        {o.title}
                      </div>
                      <div className="inline-flex items-center gap-1 text-[10.5px] text-text-tertiary">
                        {o.stage && (
                          <>
                            <span
                              className="h-1.5 w-1.5 rounded-full"
                              style={{ backgroundColor: o.stage.color }}
                            />
                            {o.stage.name} ·
                          </>
                        )}{' '}
                        {o.status}
                      </div>
                    </div>
                    <div className="text-[11.5px] font-semibold tabular-nums text-text-primary shrink-0">
                      {formatCurrency(Number(o.value), o.currency)}
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* ── Recent calls ── */}
          <Section
            title={`Recent calls ${contact.call_logs.length > 0 ? `(${contact.call_logs.length})` : ''}`}
            defaultOpen={false}
          >
            {contact.call_logs.length === 0 ? (
              <EmptyMini text="No calls yet." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {contact.call_logs.slice(0, 3).map((c) => (
                  <Link
                    key={c.id}
                    href={`/voice/${c.id}`}
                    className="group flex items-center gap-2.5 rounded-[8px] border border-border-subtle bg-bg-secondary px-2.5 py-2 hover:border-border-strong transition-colors"
                  >
                    <div
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded-[6px]',
                        c.direction === 'inbound'
                          ? 'bg-emerald-500/15 text-emerald-400'
                          : 'bg-accent-muted text-accent',
                      )}
                    >
                      <PhoneCall className="h-3 w-3" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] capitalize text-text-primary">
                        {c.direction} · {c.status ?? '|'}
                      </div>
                      <div className="text-[10.5px] text-text-tertiary">
                        {relativeTime(c.started_at)}
                        {c.duration_seconds
                          ? ` · ${Math.floor(c.duration_seconds / 60)}:${(c.duration_seconds % 60)
                              .toString()
                              .padStart(2, '0')}`
                          : ''}
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Section>

          {/* ── Other conversations ── */}
          <Section
            title={`Other conversations ${contact.conversations.length > 1 ? `(${contact.conversations.length})` : ''}`}
            defaultOpen={false}
          >
            {contact.conversations.length === 0 ? (
              <EmptyMini text="No conversations." />
            ) : (
              <div className="flex flex-col gap-1.5">
                {contact.conversations.slice(0, 5).map((c) => (
                  <a
                    key={c.id}
                    href={`/chat?conversation=${c.id}`}
                    className="group flex items-center gap-2.5 rounded-[8px] border border-border-subtle bg-bg-secondary px-2.5 py-2 hover:border-border-strong transition-colors"
                  >
                    <ChannelBadge channel={(c.channel as Channel) ?? 'unknown'} showLabel={false} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[12px] text-text-primary">
                        {c.last_message || '|'}
                      </div>
                      <div className="text-[10.5px] text-text-tertiary">
                        {relativeTime(c.last_message_at)} · {c.status}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            )}
          </Section>
        </div>
      </ScrollArea>
    </div>
  )
}

/**
 * Compact channel-action button rendered in the contact header. Either
 * navigates to an existing conversation/url, opens the dial-pad, or remains
 * disabled when the channel isn't currently reachable.
 *
 * Visual language matches the existing reach chips so the row reads as a
 * cohesive action toolbar rather than a row of generic buttons.
 */
function ChannelActionButton({
  icon: Icon,
  label,
  onClick,
  href,
  disabled,
  title,
  accent,
  badgeChannel,
}: {
  icon?: React.ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  href?: string
  disabled?: boolean
  title?: string
  accent?: 'emerald'
  badgeChannel?: Channel
}) {
  const baseClasses = cn(
    'inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium ring-1 transition-colors',
    disabled
      ? 'cursor-not-allowed bg-bg-tertiary text-text-tertiary ring-border-subtle opacity-60'
      : accent === 'emerald'
        ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30 hover:bg-emerald-500/25'
        : 'bg-bg-tertiary text-text-secondary ring-border-subtle hover:bg-bg-tertiary/70 hover:text-text-primary',
  )
  const inner = (
    <>
      {badgeChannel ? (
        <ChannelBadge channel={badgeChannel} showLabel={false} size="sm" className="!h-3.5 !w-3.5" />
      ) : Icon ? (
        <Icon className="h-3 w-3" />
      ) : null}
      <span>{label}</span>
    </>
  )
  if (href && !disabled) {
    return (
      <Link href={href} className={baseClasses} title={title} aria-label={title ?? label}>
        {inner}
      </Link>
    )
  }
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      className={baseClasses}
      title={title}
      aria-label={title ?? label}
    >
      {inner}
    </button>
  )
}

function Section({
  title,
  children,
  defaultOpen = true,
  actions,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
  actions?: React.ReactNode
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1 text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-tertiary hover:text-text-secondary transition-colors"
        >
          <ChevronDown
            className={cn('h-3 w-3 transition-transform', !open && '-rotate-90')}
          />
          <span>{title}</span>
        </button>
        {open && actions ? <div className="text-[10px]">{actions}</div> : null}
      </div>
      {open && <div className="flex flex-col gap-2">{children}</div>}
    </div>
  )
}

function InlineRow({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-bg-tertiary ring-1 ring-border-subtle text-text-tertiary">
        <Icon className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</div>
        {children}
      </div>
    </div>
  )
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  value: string | null
}) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-bg-tertiary ring-1 ring-border-subtle text-text-tertiary">
        <Icon className="h-3 w-3" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</div>
        <div
          className={cn(
            'text-[12.5px] px-1',
            value ? 'text-text-primary' : 'italic text-text-tertiary',
          )}
        >
          {value || 'Not set'}
        </div>
      </div>
    </div>
  )
}

function EmptyMini({ text }: { text: string }) {
  return (
    <div className="rounded-[8px] border border-dashed border-border-subtle bg-bg-secondary/40 px-3 py-3 text-center text-[11.5px] text-text-tertiary">
      {text}
    </div>
  )
}

/**
 * Quick action button that opens an inline note composer next to the contact
 * header. Kept here (instead of a separate file) so the panel ships as a
 * single self-contained component.
 */
function NoteQuickAction({
  contactId,
  onSaved,
}: {
  contactId: string
  onSaved: () => void
}) {
  const [open, setOpen] = React.useState(false)
  const [value, setValue] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  async function save() {
    const text = value.trim()
    if (!text || saving) return
    setSaving(true)
    const res = await addContactNote(contactId, text)
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save note')
      return
    }
    toast.success('Note added')
    setValue('')
    setOpen(false)
    onSaved()
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        className="h-8 px-2 text-[11.5px]"
        onClick={() => setOpen((v) => !v)}
        title="Add note"
      >
        <StickyNote className="h-3 w-3" />
        Note
      </Button>
      {open && (
        <div className="col-span-4 mt-2 flex flex-col gap-1.5">
          <textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="Add a note about this contact…"
            rows={3}
            className="w-full resize-y rounded-[8px] border border-border-subtle bg-bg-primary px-2 py-1.5 text-[12.5px] text-text-primary outline-none focus:border-accent/60 focus:ring-[3px] focus:ring-accent/15"
          />
          <div className="flex justify-end gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[11.5px]"
              onClick={() => {
                setOpen(false)
                setValue('')
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              className="h-7 px-2 text-[11.5px]"
              onClick={save}
              disabled={saving || !value.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

/** Lightweight "+ New" inside the Notes section header. */
function NoteQuickActionInline({
  contactId,
  onSaved,
}: {
  contactId: string
  onSaved: () => void
}) {
  const [composing, setComposing] = React.useState(false)
  const [value, setValue] = React.useState('')
  const [saving, setSaving] = React.useState(false)

  async function save() {
    const text = value.trim()
    if (!text || saving) return
    setSaving(true)
    const res = await addContactNote(contactId, text)
    setSaving(false)
    if (!res.ok) {
      toast.error(res.error ?? 'Could not save note')
      return
    }
    toast.success('Note added')
    setValue('')
    setComposing(false)
    onSaved()
  }

  if (!composing) {
    return (
      <button
        type="button"
        onClick={() => setComposing(true)}
        className="text-[10px] text-text-tertiary hover:text-text-secondary"
      >
        <Plus className="h-3 w-3 inline" /> New
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1">
      <textarea
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="New note…"
        rows={2}
        className="w-40 resize-none rounded-[6px] border border-border-subtle bg-bg-primary px-2 py-1 text-[11.5px] text-text-primary outline-none focus:border-accent/60"
      />
      <button
        type="button"
        onClick={save}
        disabled={saving || !value.trim()}
        className="text-[10px] text-accent hover:underline disabled:text-text-tertiary"
      >
        Save
      </button>
      <button
        type="button"
        onClick={() => {
          setComposing(false)
          setValue('')
        }}
        className="text-[10px] text-text-tertiary hover:text-text-secondary"
      >
        Cancel
      </button>
    </div>
  )
}

function UnregisteredCard({
  conversationId,
  name,
  phone,
  email,
  onClose,
  onCollapse,
}: {
  conversationId: string | null
  name: string | null
  phone: string | null
  email: string | null
  onClose?: () => void
  onCollapse?: () => void
}) {
  return (
    <div className="flex h-full flex-col border-l border-border-subtle bg-bg-secondary/40">
      <div className="flex justify-end gap-1 p-2">
        {onCollapse && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 hidden md:inline-flex"
            onClick={onCollapse}
            title="Collapse contact panel"
            aria-label="Collapse contact panel"
          >
            <PanelRightClose className="h-4 w-4" />
          </Button>
        )}
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 md:hidden"
            onClick={onClose}
            aria-label="Close contact panel"
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>
      <div className="flex flex-1 flex-col items-center justify-center p-5">
        <div className="w-full rounded-[12px] border border-dashed border-border-subtle bg-bg-primary p-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bg-tertiary ring-1 ring-border-subtle text-text-tertiary">
            <UserPlus className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[14px] font-semibold tracking-tight text-text-primary">
            Contact not registered
          </h3>
          <p className="mt-1 text-[12px] text-text-secondary">
            Create a contact to unlock notes, deals, and call history alongside this conversation.
          </p>
          <div className="mt-4 flex flex-col items-stretch gap-2">
            <NewContactDialog
              defaultValues={{
                name: name ?? '',
                phone: phone ?? '',
                email: email ?? '',
              }}
              trigger={<Button size="sm">Create contact</Button>}
            />
            {conversationId && (
              <InlineContactPicker conversationId={conversationId} />
            )}
          </div>
        </div>

        {(name || phone || email) && (
          <div className="mt-5 space-y-2">
            {phone && <InfoRow icon={Phone} label="Phone" value={phone} />}
            {email && <InfoRow icon={Mail} label="Email" value={email} />}
            {name && <InfoRow icon={UserPlus} label="Name" value={name} />}
          </div>
        )}
      </div>
    </div>
  )
}

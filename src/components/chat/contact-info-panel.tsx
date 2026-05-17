'use client'

/**
 * Inline contact info panel (v2.2 / SEED-011).
 *
 * Adapts the slide-in ContactDetailSheet for the right column of the chat
 * inbox. When `contactId` is null but `phone`/`name`/`email` are present, we
 * render a "Not registered" card with a CTA to create the contact pre-filled
 * with whatever signals we have from the conversation.
 */

import * as React from 'react'
import Link from 'next/link'
import {
  Phone,
  Mail,
  Building2,
  Calendar,
  Pencil,
  MessageSquare,
  PhoneCall,
  TrendingUp,
  UserPlus,
  StickyNote,
  Plus,
  ChevronDown,
  X,
  PanelRightClose,
} from 'lucide-react'

import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { ChannelBadge, type Channel } from '@/components/design-system/channel-badge'
import { getContact, type ContactDetail } from '@/app/(dashboard)/contacts/actions'
import { NewContactDialog } from '@/components/contacts/new-contact-dialog'
import { formatCurrency } from '@/lib/pipeline/format'
import { cn } from '@/lib/utils'

interface ContactInfoPanelProps {
  contactId: string | null
  /** Fallback values when the conversation isn't linked to a contact yet. */
  fallbackName?: string | null
  fallbackPhone?: string | null
  fallbackEmail?: string | null
  /** Mobile sheet close button (X). Renders on mobile only. */
  onClose?: () => void
  /** Desktop collapse button. Renders on md+ when provided. */
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

export function ContactInfoPanel({
  contactId,
  fallbackName,
  fallbackPhone,
  fallbackEmail,
  onClose,
  onCollapse,
}: ContactInfoPanelProps) {
  const [contact, setContact] = React.useState<ContactDetail | null>(null)
  const [loading, setLoading] = React.useState(false)

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
  }, [contactId])

  if (!contactId) {
    return (
      <UnregisteredCard
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
      <div className="flex h-full flex-col border-l border-border-subtle bg-bg-secondary/40 p-5">
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
      <div className="flex h-full flex-col border-l border-border-subtle bg-bg-secondary/40 p-5">
        <p className="text-[13px] text-text-secondary">Contact not found.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col border-l border-border-subtle bg-bg-secondary/40">
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
            <h3 className="truncate text-[16px] font-semibold tracking-tight text-text-primary">
              {contact.name || 'Unnamed contact'}
            </h3>
            {contact.company && (
              <p className="mt-0.5 truncate text-[12px] text-text-secondary">{contact.company}</p>
            )}
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

        <div className="mt-4 grid grid-cols-3 gap-1.5">
          <Button asChild size="sm" variant="secondary" className="h-8">
            <Link href={`/contacts?id=${contact.id}`}>
              <Pencil className="h-3 w-3" />
              Edit
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary" className="h-8">
            <Link href={`/pipeline/new?contact_id=${contact.id}`}>
              <Plus className="h-3 w-3" />
              Deal
            </Link>
          </Button>
          <Button asChild size="sm" variant="secondary" className="h-8">
            <Link href={`/contacts?id=${contact.id}#notes`}>
              <StickyNote className="h-3 w-3" />
              Note
            </Link>
          </Button>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="px-5 py-5 space-y-4">
          <Section title="Info" defaultOpen>
            <InfoRow icon={Phone} label="Phone" value={contact.phone} />
            <InfoRow icon={Mail} label="Email" value={contact.email} />
            <InfoRow icon={Building2} label="Company" value={contact.company} />
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
          </Section>

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

          <Section
            title={`Recent calls ${contact.call_logs.length > 0 ? `(${contact.call_logs.length})` : ''}`}
            defaultOpen={contact.call_logs.length > 0}
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
                        {c.direction} · {c.status ?? '—'}
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
                        {c.last_message || '—'}
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

function Section({
  title,
  children,
  defaultOpen = true,
}: {
  title: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = React.useState(defaultOpen)
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center justify-between text-[10.5px] font-medium uppercase tracking-[0.08em] text-text-tertiary hover:text-text-secondary transition-colors"
      >
        <span>{title}</span>
        <ChevronDown
          className={cn(
            'h-3 w-3 transition-transform',
            !open && '-rotate-90',
          )}
        />
      </button>
      {open && <div className="flex flex-col gap-2">{children}</div>}
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
            'text-[12.5px]',
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

function UnregisteredCard({
  name,
  phone,
  email,
  onClose,
  onCollapse,
}: {
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
      <div className="p-5">
        <div className="rounded-[12px] border border-dashed border-border-subtle bg-bg-primary p-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-bg-tertiary ring-1 ring-border-subtle text-text-tertiary">
            <UserPlus className="h-5 w-5" />
          </div>
          <h3 className="mt-3 text-[14px] font-semibold tracking-tight text-text-primary">
            Contact not registered
          </h3>
          <p className="mt-1 text-[12px] text-text-secondary">
            Create a contact to unlock notes, deals, and call history alongside this conversation.
          </p>
          <div className="mt-4 flex justify-center">
            <NewContactDialog
              defaultValues={{
                name: name ?? '',
                phone: phone ?? '',
                email: email ?? '',
              }}
              trigger={<Button size="sm">Create contact</Button>}
            />
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

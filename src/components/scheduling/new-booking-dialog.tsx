'use client'

import * as React from 'react'
import { toast } from 'sonner'
import { format, addMinutes } from 'date-fns'
import { Loader2, Search, User, X } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
import { cn } from '@/lib/utils'
import { createBookingInternal } from '@/app/(dashboard)/scheduling/_actions/bookings'
import { searchContactsForOpportunity } from '@/app/(dashboard)/pipeline/actions'
import type { EventTypeRow } from '@/app/(dashboard)/scheduling/_actions/event-types'

const LOCATION_KIND_LABELS: Record<string, string> = {
  video: 'Video call',
  phone: 'Phone call',
  in_person: 'In person',
  google_meet: 'Google Meet',
  zoom: 'Zoom',
}

function humanizeKind(kind: string): string {
  return LOCATION_KIND_LABELS[kind] ?? kind.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

type ContactHit = {
  id: string
  first_name: string | null
  last_name: string | null
  name: string | null
  phone: string | null
  email: string | null
}

function contactLabel(c: ContactHit): string {
  return (
    [c.first_name?.trim(), c.last_name?.trim()].filter(Boolean).join(' ') ||
    c.name?.trim() ||
    c.email ||
    c.phone ||
    'Unnamed'
  )
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventTypes: EventTypeRow[]
  defaultStart: Date | null
  timezone: string
  onCreated: () => void
}

export function NewBookingDialog({ open, onOpenChange, eventTypes, defaultStart, timezone, onCreated }: Props) {
  const [eventTypeId, setEventTypeId] = React.useState<string>('')
  const [startTime, setStartTime] = React.useState('')   // 'HH:mm'
  const [name, setName] = React.useState('')
  const [email, setEmail] = React.useState('')
  const [phone, setPhone] = React.useState('')
  const [notes, setNotes] = React.useState('')
  const [locationKind, setLocationKind] = React.useState<string>('')
  const [contactId, setContactId] = React.useState<string | null>(null)
  const [saving, setSaving] = React.useState(false)

  // Contact search
  const [query, setQuery] = React.useState('')
  const [results, setResults] = React.useState<ContactHit[]>([])
  const [searchOpen, setSearchOpen] = React.useState(false)

  const eventType = eventTypes.find((e) => e.id === eventTypeId) ?? null

  // Reset on open.
  React.useEffect(() => {
    if (!open) return
    const first = eventTypes[0]
    setEventTypeId(first?.id ?? '')
    setStartTime(defaultStart ? format(defaultStart, 'HH:mm') : '09:00')
    setName('')
    setEmail('')
    setPhone('')
    setNotes('')
    setContactId(null)
    setQuery('')
    setResults([])
    setLocationKind((first?.allowed_location_kinds ?? [])[0] ?? '')
  }, [open, defaultStart, eventTypes])

  // Update default location kind when event type changes.
  React.useEffect(() => {
    setLocationKind((eventType?.allowed_location_kinds ?? [])[0] ?? '')
  }, [eventType])

  // Debounced contact search.
  React.useEffect(() => {
    if (!searchOpen) return
    const t = setTimeout(() => {
      void searchContactsForOpportunity(query).then(setResults)
    }, 250)
    return () => clearTimeout(t)
  }, [query, searchOpen])

  function pickContact(c: ContactHit) {
    setContactId(c.id)
    setName(contactLabel(c))
    setEmail(c.email ?? '')
    setPhone(c.phone ?? '')
    setQuery('')
    setSearchOpen(false)
  }

  function clearContact() {
    setContactId(null)
    setName('')
    setEmail('')
    setPhone('')
  }

  // Build the start Date in the host timezone from the picked day + time.
  const startDate = React.useMemo(() => {
    if (!defaultStart || !startTime) return null
    const [h, m] = startTime.split(':').map(Number)
    const d = new Date(defaultStart)
    d.setHours(h, m, 0, 0)
    return d
  }, [defaultStart, startTime])

  const endLabel = React.useMemo(() => {
    if (!startDate || !eventType) return null
    return format(addMinutes(startDate, eventType.duration_minutes), 'HH:mm')
  }, [startDate, eventType])

  async function handleSubmit() {
    if (!eventType || !startDate) return
    if (!name.trim()) { toast.error('Booker name is required'); return }
    setSaving(true)
    try {
      const res = await createBookingInternal({
        event_type_id: eventType.id,
        start_at: startDate.toISOString(),
        booker_name: name.trim(),
        booker_email: email.trim() || undefined,
        booker_phone: phone.trim() || undefined,
        booker_timezone: timezone,
        notes: notes.trim() || undefined,
        location_kind: locationKind || undefined,
        contact_id: contactId ?? undefined,
      })
      if (!res.ok) {
        toast.error(
          res.error === 'slot_taken'
            ? 'That slot was just taken — pick another time.'
            : res.error,
        )
        return
      }
      toast.success('Booking created')
      onOpenChange(false)
      onCreated()
    } finally {
      setSaving(false)
    }
  }

  const allowedKinds = eventType?.allowed_location_kinds ?? []

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px] max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          {defaultStart && (
            <p className="text-[12.5px] text-text-tertiary">
              {format(defaultStart, 'EEEE, MMMM d')}
            </p>
          )}
        </DialogHeader>

        <div className="space-y-3.5">
          {/* Event type */}
          <div className="space-y-1.5">
            <Label className="text-[12px] text-text-secondary">Event type</Label>
            <Select value={eventTypeId} onValueChange={setEventTypeId}>
              <SelectTrigger className="h-9"><SelectValue placeholder="Select an event type" /></SelectTrigger>
              <SelectContent>
                {eventTypes.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    <span className="inline-flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: e.color }} />
                      {e.title} · {e.duration_minutes}m
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* When */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-[12px] text-text-secondary">Start</Label>
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[12px] text-text-secondary">End</Label>
              <div className="flex h-9 items-center rounded-md border border-border-subtle bg-bg-secondary px-3 text-[13px] text-text-tertiary">
                {endLabel ?? '—'}
              </div>
            </div>
          </div>

          {/* Booker — contact search */}
          <div className="space-y-1.5">
            <Label className="text-[12px] text-text-secondary">Booker</Label>
            {contactId ? (
              <div className="flex items-center gap-2 rounded-md border border-border-subtle bg-bg-secondary px-3 py-2">
                <User className="h-3.5 w-3.5 text-text-tertiary" />
                <span className="flex-1 truncate text-[13px] text-text-primary">{name}</span>
                <button type="button" onClick={clearContact} className="text-text-tertiary hover:text-text-primary">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-tertiary" />
                <Input
                  value={query}
                  onChange={(e) => { setQuery(e.target.value); setSearchOpen(true) }}
                  onFocus={() => setSearchOpen(true)}
                  onBlur={() => setTimeout(() => setSearchOpen(false), 150)}
                  placeholder="Search a contact by name, phone, or email"
                  className="h-9 pl-8"
                />
                {searchOpen && results.length > 0 && (
                  <div className="absolute z-50 mt-1 max-h-[200px] w-full overflow-y-auto rounded-[8px] border border-border-subtle bg-bg-primary shadow-elevation-md">
                    {results.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => pickContact(c)}
                        className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-bg-secondary"
                      >
                        <span className="truncate text-[12.5px] font-medium text-text-primary">{contactLabel(c)}</span>
                        <span className="truncate text-[11px] text-text-tertiary">{c.email ?? c.phone ?? ''}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Manual fields (always editable) */}
          {!contactId && (
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Booker name *" className="h-9" />
          )}
          <div className="grid grid-cols-2 gap-3">
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" className="h-9" type="email" />
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (optional)" className="h-9" />
          </div>

          {/* Location kind */}
          {allowedKinds.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-[12px] text-text-secondary">Location</Label>
              <Select value={locationKind} onValueChange={setLocationKind}>
                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {allowedKinds.map((k) => (
                    <SelectItem key={k} value={k}>{humanizeKind(k)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-1.5">
            <Label className="text-[12px] text-text-secondary">Notes <span className="text-text-tertiary">(optional)</span></Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="resize-none" placeholder="Anything to remember about this meeting…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || !eventType || !startDate || !name.trim()} className={cn(saving && 'opacity-80')}>
            {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Create booking
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

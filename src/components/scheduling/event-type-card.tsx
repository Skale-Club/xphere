'use client'

import React, { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Clock, Video, Phone, MapPin, Copy, Pencil, Trash2, ExternalLink, Link2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from '@/components/ui/sheet'
import { EventTypeForm } from './event-type-form'
import { updateEventType, deleteEventType } from '@/app/(dashboard)/scheduling/_actions/event-types'
import type { EventTypeRow } from '@/app/(dashboard)/scheduling/_actions/event-types'

const LOCATION_ICONS: Record<string, React.ElementType> = {
  google_meet: Video,
  zoom: Video,
  whereby: Video,
  custom_link: Link2,
  video: Video,
  phone_call: Phone,
  custom_phone: Phone,
  phone: Phone,
  store_location: MapPin,
  client_address: MapPin,
  custom_address: MapPin,
  in_person: MapPin,
}

const LOCATION_LABELS: Record<string, string> = {
  google_meet: 'Google Meet',
  zoom: 'Zoom',
  whereby: 'Whereby',
  custom_link: 'Video link',
  video: 'Video call',
  phone_call: 'Phone call',
  custom_phone: 'Phone call',
  phone: 'Phone call',
  store_location: 'In person',
  client_address: 'Client address',
  custom_address: 'In person',
  in_person: 'In person',
}

interface EventTypeCardProps {
  eventType: EventTypeRow
  bookingSlug: string
  siteUrl: string
}

export function EventTypeCard({ eventType, bookingSlug, siteUrl }: EventTypeCardProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [editing, setEditing] = useState(false)

  const bookingUrl = `${siteUrl}/book/${bookingSlug}/${eventType.slug}`
  const primaryKind = eventType.allowed_location_kinds?.[0] ?? eventType.location_type
  const LocationIcon = LOCATION_ICONS[primaryKind] ?? Video
  const locationLabel = LOCATION_LABELS[primaryKind] ?? primaryKind

  function handleToggleActive(active: boolean) {
    startTransition(async () => {
      const result = await updateEventType(eventType.id, { active })
      if (!result.ok) toast.error(result.error)
      else router.refresh()
    })
  }

  function handleDelete() {
    if (!confirm(`Delete "${eventType.title}"? This cannot be undone.`)) return
    startTransition(async () => {
      const result = await deleteEventType(eventType.id)
      if (!result.ok) toast.error(result.error)
      else {
        toast.success('Event type deleted')
        router.refresh()
      }
    })
  }

  function handleCopy() {
    navigator.clipboard.writeText(bookingUrl)
    toast.success('Booking link copied')
  }

  async function handleEditSubmit(values: Parameters<React.ComponentProps<typeof EventTypeForm>['onSubmit']>[0]) {
    startTransition(async () => {
      const result = await updateEventType(eventType.id, values)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success('Event type updated')
      setEditing(false)
      router.refresh()
    })
  }

  return (
    <>
      <div className="group rounded-lg border border-border bg-card p-5 flex flex-col gap-3 hover:border-border/80 transition-colors">
        {/* Color bar + title */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5">
            <div className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: eventType.color }} />
            <h3 className="text-sm font-semibold leading-tight">{eventType.title}</h3>
          </div>
          <Switch
            checked={eventType.active}
            onCheckedChange={handleToggleActive}
            disabled={isPending}
            className="data-[state=checked]:bg-indigo-600 shrink-0"
          />
        </div>

        {/* Meta */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {eventType.duration_minutes} min
          </span>
          <span className="flex items-center gap-1">
            <LocationIcon className="h-3 w-3" />
            {locationLabel}
          </span>
        </div>

        {eventType.description && (
          <p className="text-xs text-muted-foreground line-clamp-2">{eventType.description}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-1 mt-auto pt-1">
          <Button size="sm" variant="ghost" className="h-7 gap-1.5 text-xs" onClick={handleCopy}>
            <Copy className="h-3.5 w-3.5" /> Copy link
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-red-400 hover:text-red-300"
            onClick={handleDelete}
            disabled={isPending}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7 ml-auto" asChild>
            <a href={bookingUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </div>

      <Sheet open={editing} onOpenChange={setEditing}>
        <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>Edit event type</SheetTitle>
          </SheetHeader>
          <EventTypeForm
            defaultValues={eventType}
            onSubmit={handleEditSubmit}
            loading={isPending}
            submitLabel="Update"
          />
        </SheetContent>
      </Sheet>
    </>
  )
}

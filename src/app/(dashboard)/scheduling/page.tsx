import { redirect } from 'next/navigation'
import { CalendarDays, Settings2, ExternalLink, Calendar, ListChecks } from 'lucide-react'
import { getUser } from '@/lib/supabase/server'
import { getEventTypes } from './_actions/event-types'
import { getSchedulingProfile } from './_actions/scheduling-profile'
import { EventTypeCard } from '@/components/scheduling/event-type-card'
import { NewEventTypeDialog } from '@/components/scheduling/new-event-type-dialog'
import { SchedulingProfileSetup } from '@/components/scheduling/scheduling-profile-setup'
import { Button } from '@/components/ui/button'
import { PageContainer } from '@/components/layout/page-header'
import Link from 'next/link'
import { getSiteOriginFromHeaders } from '@/lib/site-url'

interface Props {
  searchParams: Promise<{ calendar_connected?: string; error?: string }>
}

export default async function SchedulingPage({ searchParams }: Props) {
  const user = await getUser()
  if (!user) redirect('/')

  const sp = await searchParams
  const [profileResult, eventTypesResult] = await Promise.all([
    getSchedulingProfile(),
    getEventTypes(),
  ])

  const profile = profileResult.ok ? profileResult.data : null
  const eventTypes = eventTypesResult.ok ? eventTypesResult.data : []

  const siteUrl = await getSiteOriginFromHeaders()

  // No profile yet — show centered setup screen, no header buttons
  if (!profile) {
    return (
      <div className="flex h-full min-h-[calc(100vh-56px)] items-start sm:items-center justify-center px-4 pt-8 sm:pt-0">
        <SchedulingProfileSetup />
      </div>
    )
  }

  return (
    <PageContainer>
      {/* Header actions */}
      <div className="flex items-center justify-end gap-2">
        <Button asChild variant="outline" size="sm">
          <Link href="/scheduling/bookings">
            <ListChecks className="h-3.5 w-3.5 mr-1.5" /> Bookings
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/scheduling/calendar">
            <Calendar className="h-3.5 w-3.5 mr-1.5" /> Calendar
          </Link>
        </Button>
        <Button asChild variant="outline" size="sm">
          <Link href="/scheduling/availability">
            <Settings2 className="h-3.5 w-3.5 mr-1.5" /> Availability
          </Link>
        </Button>
        <NewEventTypeDialog />
      </div>

      {/* Google Calendar banners */}
      {sp.calendar_connected === 'true' && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-400">
          Google Calendar connected | busy times will be respected when generating slots.
        </div>
      )}
      {sp.error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          Error connecting Google Calendar: {sp.error}
        </div>
      )}

      {/* Booking page link */}
      <div className="rounded-lg border border-border bg-card p-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Your booking page</p>
          <code className="text-sm text-indigo-400">{siteUrl}/book/{profile.slug}</code>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild variant="outline" size="sm">
            <a href={`${siteUrl}/book/${profile.slug}`} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-3.5 w-3.5 mr-1.5" /> Preview
            </a>
          </Button>
          <Button asChild variant="outline" size="sm">
            <a href="/api/google/calendar-oauth">
              <Calendar className="h-3.5 w-3.5 mr-1.5" /> Connect Google Calendar
            </a>
          </Button>
        </div>
      </div>

      {/* Event types */}
      <div className="space-y-4">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Event Types</h2>
        {eventTypes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center">
            <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">No event types yet.</p>
            <p className="text-xs text-muted-foreground mt-1">Create one to start accepting bookings.</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {eventTypes.map((et) => (
              <EventTypeCard
                key={et.id}
                eventType={et}
                bookingSlug={profile.slug}
                siteUrl={siteUrl}
              />
            ))}
          </div>
        )}
      </div>
    </PageContainer>
  )
}

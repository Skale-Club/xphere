import { redirect } from 'next/navigation'
import { CalendarDays, Settings2, ExternalLink, Calendar } from 'lucide-react'
import { getUser } from '@/lib/supabase/server'
import { getEventTypes } from './_actions/event-types'
import { getSchedulingProfile } from './_actions/scheduling-profile'
import { EventTypeCard } from '@/components/scheduling/event-type-card'
import { NewEventTypeDialog } from '@/components/scheduling/new-event-type-dialog'
import { SchedulingProfileSetup } from '@/components/scheduling/scheduling-profile-setup'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface Props {
  searchParams: Promise<{ calendar_connected?: string; error?: string }>
}

export default async function SchedulingPage({ searchParams }: Props) {
  const user = await getUser()
  if (!user) redirect('/login')

  const sp = await searchParams
  const [profileResult, eventTypesResult] = await Promise.all([
    getSchedulingProfile(),
    getEventTypes(),
  ])

  const profile = profileResult.ok ? profileResult.data : null
  const eventTypes = eventTypesResult.ok ? eventTypesResult.data : []

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://xphere.app'

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      <div className="flex items-center justify-end gap-2">
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
        {profile && <NewEventTypeDialog />}
      </div>

      {/* Google Calendar banner */}
      {sp.calendar_connected === 'true' && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-4 py-3 text-sm text-emerald-400">
          Google Calendar connected — busy times will be respected when generating slots.
        </div>
      )}
      {sp.error && (
        <div className="rounded-lg bg-red-500/10 border border-red-500/20 px-4 py-3 text-sm text-red-400">
          Error connecting Google Calendar: {sp.error}
        </div>
      )}

      {/* Profile setup / booking link */}
      {!profile ? (
        <SchedulingProfileSetup />
      ) : (
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
      )}

      {/* Event types */}
      {profile && (
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
      )}
    </div>
  )
}

import { redirect } from 'next/navigation'
import { startOfWeek, endOfWeek } from 'date-fns'
import { getUser } from '@/lib/supabase/server'
import { getBookings } from '../_actions/bookings'
import { getEventTypes } from '../_actions/event-types'
import { getSchedulingProfile } from '../_actions/calendar-profile'
import { getUserAvailability } from '../_actions/availability'
import { getGoogleCalendarEvents } from '../_actions/google-events'
import { CalendarView } from '@/components/calendar/calendar-view'

export default async function SchedulingCalendarPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const now = new Date()
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(now, { weekStartsOn: 1 })

  const [bookingsResult, eventTypesResult, profileResult, availabilityResult, externalEvents] =
    await Promise.all([
      getBookings(),
      getEventTypes(),
      getSchedulingProfile(),
      getUserAvailability(),
      getGoogleCalendarEvents(weekStart.toISOString(), weekEnd.toISOString()),
    ])

  const bookings = bookingsResult.ok ? bookingsResult.data : []
  const eventTypes = eventTypesResult.ok ? eventTypesResult.data : []
  const availability = availabilityResult.ok ? availabilityResult.data : []
  const timezone = profileResult.ok && profileResult.data ? profileResult.data.timezone : 'UTC'

  // Build color map: event_type_id → color
  const eventTypeColors: Record<string, string> = {}
  for (const et of eventTypes) {
    eventTypeColors[et.id] = et.color
  }

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <CalendarView
        bookings={bookings}
        eventTypeColors={eventTypeColors}
        eventTypes={eventTypes}
        availability={availability}
        timezone={timezone}
        initialExternalEvents={externalEvents}
      />
    </div>
  )
}

import { redirect } from 'next/navigation'
import { getUser } from '@/lib/supabase/server'
import { getBookings } from '../_actions/bookings'
import { getEventTypes } from '../_actions/event-types'
import { getSchedulingProfile } from '../_actions/scheduling-profile'
import { CalendarView } from '@/components/scheduling/calendar-view'

export default async function SchedulingCalendarPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const [bookingsResult, eventTypesResult, profileResult] = await Promise.all([
    getBookings(),
    getEventTypes(),
    getSchedulingProfile(),
  ])

  const bookings = bookingsResult.ok ? bookingsResult.data : []
  const eventTypes = eventTypesResult.ok ? eventTypesResult.data : []
  const timezone = profileResult.ok && profileResult.data ? profileResult.data.timezone : 'UTC'

  // Build color map: event_type_id → color
  const eventTypeColors: Record<string, string> = {}
  for (const et of eventTypes) {
    eventTypeColors[et.id] = et.color
  }

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <CalendarView bookings={bookings} eventTypeColors={eventTypeColors} timezone={timezone} />
    </div>
  )
}

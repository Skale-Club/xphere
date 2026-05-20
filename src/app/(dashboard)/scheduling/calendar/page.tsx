import { redirect } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { getUser } from '@/lib/supabase/server'
import { getBookings } from '../_actions/bookings'
import { getEventTypes } from '../_actions/event-types'
import { CalendarView } from '@/components/scheduling/calendar-view'

export default async function SchedulingCalendarPage() {
  const user = await getUser()
  if (!user) redirect('/login')

  const [bookingsResult, eventTypesResult] = await Promise.all([
    getBookings(),
    getEventTypes(),
  ])

  const bookings = bookingsResult.ok ? bookingsResult.data : []
  const eventTypes = eventTypesResult.ok ? eventTypesResult.data : []

  // Build color map: event_type_id → color
  const eventTypeColors: Record<string, string> = {}
  for (const et of eventTypes) {
    eventTypeColors[et.id] = et.color
  }

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      <Button asChild variant="ghost" size="sm">
        <Link href="/scheduling"><ArrowLeft className="h-3.5 w-3.5" /> Back</Link>
      </Button>

      <CalendarView bookings={bookings} eventTypeColors={eventTypeColors} />
    </div>
  )
}

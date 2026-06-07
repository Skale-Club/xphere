import { redirect } from 'next/navigation'
import { format, parseISO } from 'date-fns'
import { CalendarCheck, Clock, User, Mail } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { getUser } from '@/lib/supabase/server'
import { getBookings, type BookingRow } from '../_actions/bookings'
import { BookingActionsCell } from '@/components/calendar/booking-actions-cell'
import { cn } from '@/lib/utils'

export default async function BookingsPage() {
  const user = await getUser()
  if (!user) redirect('/')

  const result = await getBookings()
  const bookings = result.ok ? result.data : []

  const now = new Date()
  const upcoming = bookings.filter(
    (b) => b.status === 'confirmed' && new Date(b.start_at) >= now,
  )
  const past = bookings.filter(
    (b) => (b.status === 'confirmed' || b.status === 'no_show') && new Date(b.start_at) < now,
  )
  const cancelled = bookings.filter((b) => b.status === 'cancelled')

  return (
    <div className="mx-auto w-full max-w-none px-4 sm:px-6 lg:px-8 py-8 space-y-6">
      {bookings.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <CalendarCheck className="mx-auto h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">No bookings yet.</p>
        </div>
      ) : (
        <div className="space-y-8">
          {upcoming.length > 0 && (
            <BookingSection title="Upcoming" bookings={upcoming} />
          )}
          {past.length > 0 && (
            <BookingSection title="Past" bookings={past} dimmed />
          )}
          {cancelled.length > 0 && (
            <BookingSection title="Cancelled" bookings={cancelled} dimmed />
          )}
        </div>
      )}
    </div>
  )
}

function BookingSection({
  title,
  bookings,
  dimmed,
}: {
  title: string
  bookings: BookingRow[]
  dimmed?: boolean
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
      <div className="divide-y divide-border rounded-lg border border-border overflow-hidden">
        {bookings.map((booking) => (
          <div
            key={booking.id}
            className={cn('flex items-center gap-4 px-4 py-3 bg-card', dimmed && 'opacity-60')}
          >
            <div className="flex-1 min-w-0 space-y-0.5">
              <div className="flex items-center gap-2 text-sm font-medium">
                <User className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {booking.booker_name}
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Mail className="h-3 w-3 shrink-0" />
                {booking.booker_email}
              </div>
            </div>
            <div className="text-right text-xs text-muted-foreground space-y-0.5">
              <div className="flex items-center gap-1 justify-end tabular-nums">
                <Clock className="h-3 w-3" />
                {format(parseISO(booking.start_at), 'MMM d, yyyy')}
              </div>
              <div className="tabular-nums">
                {format(parseISO(booking.start_at), 'HH:mm')} – {format(parseISO(booking.end_at), 'HH:mm')}
              </div>
            </div>
            <Badge
              variant="secondary"
              className={cn(
                'text-[11px] shrink-0',
                booking.status === 'confirmed' && 'bg-emerald-500/15 text-emerald-400',
                booking.status === 'cancelled' && 'bg-zinc-500/15 text-zinc-400',
                booking.status === 'no_show' && 'bg-amber-500/15 text-amber-400',
              )}
            >
              {booking.status}
            </Badge>
            {booking.status === 'confirmed' && (
              <BookingActionsCell bookingId={booking.id} />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

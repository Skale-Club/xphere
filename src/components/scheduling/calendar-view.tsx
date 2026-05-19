'use client'

import { useState, useMemo } from 'react'
import {
  format,
  startOfWeek,
  endOfWeek,
  addWeeks,
  subWeeks,
  eachDayOfInterval,
  isSameDay,
  parseISO,
  getHours,
  getMinutes,
  differenceInMinutes,
  isToday,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { BookingRow } from '@/app/(dashboard)/scheduling/_actions/bookings'

const HOURS = Array.from({ length: 24 }, (_, i) => i)
const VISIBLE_HOURS = HOURS.slice(6, 22) // 6am–10pm
const HOUR_HEIGHT = 60 // px per hour

interface CalendarViewProps {
  bookings: BookingRow[]
  eventTypeColors?: Record<string, string>
}

interface PositionedBooking {
  booking: BookingRow
  top: number
  height: number
  color: string
}

function positionBookingInDay(
  booking: BookingRow,
  color: string,
): PositionedBooking {
  const start = parseISO(booking.start_at)
  const end = parseISO(booking.end_at)
  const startHour = getHours(start) + getMinutes(start) / 60
  const duration = differenceInMinutes(end, start)
  const top = (startHour - 6) * HOUR_HEIGHT
  const height = Math.max((duration / 60) * HOUR_HEIGHT, 20)
  return { booking, top, height, color }
}

export function CalendarView({ bookings, eventTypeColors = {} }: CalendarViewProps) {
  const [currentWeekStart, setCurrentWeekStart] = useState(() =>
    startOfWeek(new Date(), { weekStartsOn: 1 }),
  )

  const weekEnd = endOfWeek(currentWeekStart, { weekStartsOn: 1 })
  const days = eachDayOfInterval({ start: currentWeekStart, end: weekEnd })

  const positionedByDay = useMemo(() => {
    const map = new Map<string, PositionedBooking[]>()
    for (const day of days) {
      const key = format(day, 'yyyy-MM-dd')
      const dayBookings = bookings
        .filter(
          (b) => b.status === 'confirmed' && isSameDay(parseISO(b.start_at), day),
        )
        .map((b) =>
          positionBookingInDay(b, eventTypeColors[b.event_type_id] ?? '#6366F1'),
        )
      map.set(key, dayBookings)
    }
    return map
  }, [bookings, days, eventTypeColors])

  function prevWeek() {
    setCurrentWeekStart((d) => subWeeks(d, 1))
  }
  function nextWeek() {
    setCurrentWeekStart((d) => addWeeks(d, 1))
  }
  function goToday() {
    setCurrentWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={goToday}>Today</Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={prevWeek}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={nextWeek}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <span className="text-sm font-medium">
          {format(currentWeekStart, 'MMMM yyyy')}
        </span>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5" />
          Week view
        </div>
      </div>

      {/* Day headers */}
      <div className="grid border-b border-border" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
        <div className="border-r border-border" />
        {days.map((day) => (
          <div
            key={day.toISOString()}
            className={cn(
              'py-2 text-center border-r border-border last:border-r-0',
              isToday(day) && 'bg-indigo-500/5',
            )}
          >
            <div className="text-[11px] font-medium uppercase text-muted-foreground">
              {format(day, 'EEE')}
            </div>
            <div
              className={cn(
                'mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold',
                isToday(day) && 'bg-indigo-600 text-white',
              )}
            >
              {format(day, 'd')}
            </div>
          </div>
        ))}
      </div>

      {/* Time grid */}
      <div className="overflow-y-auto" style={{ maxHeight: '600px' }}>
        <div className="relative grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
          {/* Hour labels */}
          <div className="relative">
            {VISIBLE_HOURS.map((h) => (
              <div
                key={h}
                className="flex items-start justify-end pr-2 text-[11px] text-muted-foreground tabular-nums"
                style={{ height: HOUR_HEIGHT }}
              >
                <span className="-mt-2">
                  {h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`}
                </span>
              </div>
            ))}
          </div>

          {/* Day columns */}
          {days.map((day) => {
            const key = format(day, 'yyyy-MM-dd')
            const dayEvents = positionedByDay.get(key) ?? []
            return (
              <div
                key={day.toISOString()}
                className={cn(
                  'relative border-r border-border last:border-r-0',
                  isToday(day) && 'bg-indigo-500/5',
                )}
                style={{ height: VISIBLE_HOURS.length * HOUR_HEIGHT }}
              >
                {/* Hour lines */}
                {VISIBLE_HOURS.map((h) => (
                  <div
                    key={h}
                    className="absolute inset-x-0 border-t border-border/40"
                    style={{ top: (h - 6) * HOUR_HEIGHT }}
                  />
                ))}

                {/* Bookings */}
                {dayEvents.map(({ booking, top, height, color }) => (
                  <div
                    key={booking.id}
                    className="absolute inset-x-0.5 rounded overflow-hidden px-1 py-0.5 text-white cursor-default"
                    style={{
                      top: Math.max(top, 0),
                      height,
                      backgroundColor: color,
                      opacity: 0.9,
                    }}
                    title={`${booking.booker_name} — ${format(parseISO(booking.start_at), 'HH:mm')}–${format(parseISO(booking.end_at), 'HH:mm')}`}
                  >
                    <div className="text-[11px] font-semibold leading-tight truncate">
                      {format(parseISO(booking.start_at), 'HH:mm')}
                    </div>
                    {height > 32 && (
                      <div className="text-[10px] leading-tight truncate opacity-90">
                        {booking.booker_name}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

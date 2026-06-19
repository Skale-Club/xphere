'use client'

import { useState, useMemo, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  format,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  addWeeks,
  subWeeks,
  addDays,
  subDays,
  addMonths,
  subMonths,
  eachDayOfInterval,
  isSameDay,
  isSameMonth,
  parseISO,
  differenceInMinutes,
  isToday,
} from 'date-fns'
import { toZonedTime } from 'date-fns-tz'
import { ChevronLeft, ChevronRight, Loader2, X, Clock, MapPin, User } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'
import { NewBookingDialog } from './new-booking-dialog'
import { NewEventTypeDialog } from './new-event-type-dialog'
import { cancelBooking } from '@/app/(dashboard)/calendar/_actions/bookings'
import { getGoogleCalendarEvents, type ExternalCalendarEvent } from '@/app/(dashboard)/calendar/_actions/google-events'
import type { BookingRow } from '@/app/(dashboard)/calendar/_actions/bookings'
import type { EventTypeRow } from '@/app/(dashboard)/calendar/_actions/event-types'
import type { AvailabilityRow } from '@/app/(dashboard)/calendar/_actions/availability'

const START_HOUR = 6
const END_HOUR = 22 // exclusive upper bound for labels; grid spans START..END
const HOUR_HEIGHT = 52
const VISIBLE_HOURS = Array.from({ length: END_HOUR - START_HOUR }, (_, i) => START_HOUR + i)
const GRID_HEIGHT = VISIBLE_HOURS.length * HOUR_HEIGHT

type View = 'day' | 'week' | 'month'

interface CalendarViewProps {
  bookings: BookingRow[]
  eventTypeColors?: Record<string, string>
  eventTypes?: EventTypeRow[]
  availability?: AvailabilityRow[]
  timezone?: string
  initialExternalEvents?: ExternalCalendarEvent[]
}

// ── helpers ──────────────────────────────────────────────────────────────────

function hourLabel(h: number): string {
  if (h === 0) return '12am'
  if (h < 12) return `${h}am`
  if (h === 12) return '12pm'
  return `${h - 12}pm`
}

function parseHHMM(t: string): number {
  const [h, m] = t.split(':').map(Number)
  return h + (m || 0) / 60
}

interface Positioned {
  booking: BookingRow
  topPx: number
  heightPx: number
  color: string
  leftPct: number
  widthPct: number
}

interface PositionedExternal {
  event: ExternalCalendarEvent
  topPx: number
  heightPx: number
}

// Lay out a single day's bookings, splitting overlaps into side-by-side columns.
function layoutDay(
  dayBookings: BookingRow[],
  colors: Record<string, string>,
  timezone: string,
): Positioned[] {
  const items = dayBookings
    .map((b) => {
      const start = toZonedTime(parseISO(b.start_at), timezone)
      const end = toZonedTime(parseISO(b.end_at), timezone)
      const startHour = start.getHours() + start.getMinutes() / 60
      const duration = differenceInMinutes(parseISO(b.end_at), parseISO(b.start_at))
      return {
        booking: b,
        startHour,
        endHour: startHour + duration / 60,
        topPx: (startHour - START_HOUR) * HOUR_HEIGHT,
        heightPx: Math.max((duration / 60) * HOUR_HEIGHT, 22),
        color: colors[b.event_type_id] ?? '#6366F1',
      }
    })
    .sort((a, b) => a.startHour - b.startHour || a.endHour - b.endHour)

  // Greedy column assignment within transitive-overlap clusters.
  const out: Positioned[] = []
  let cluster: typeof items = []
  let clusterEnd = -Infinity

  const flush = () => {
    if (cluster.length === 0) return
    const cols: number[] = [] // each entry = endHour of the last item in that column
    const colOf = new Map<typeof cluster[number], number>()
    for (const it of cluster) {
      let placed = -1
      for (let c = 0; c < cols.length; c++) {
        if (it.startHour >= cols[c] - 1e-6) { cols[c] = it.endHour; placed = c; break }
      }
      if (placed === -1) { cols.push(it.endHour); placed = cols.length - 1 }
      colOf.set(it, placed)
    }
    const colCount = cols.length
    for (const it of cluster) {
      const c = colOf.get(it) ?? 0
      out.push({
        booking: it.booking,
        topPx: it.topPx,
        heightPx: it.heightPx,
        color: it.color,
        leftPct: (c / colCount) * 100,
        widthPct: 100 / colCount,
      })
    }
    cluster = []
  }

  for (const it of items) {
    if (cluster.length === 0 || it.startHour < clusterEnd - 1e-6) {
      cluster.push(it)
      clusterEnd = Math.max(clusterEnd, it.endHour)
    } else {
      flush()
      cluster = [it]
      clusterEnd = it.endHour
    }
  }
  flush()
  return out
}

// Position external (Google Calendar) events for a given day.
function layoutExternalDay(
  dayEvents: ExternalCalendarEvent[],
  timezone: string,
): PositionedExternal[] {
  return dayEvents
    .filter((e) => !e.allDay)
    .map((e) => {
      const start = toZonedTime(parseISO(e.start), timezone)
      const startHour = start.getHours() + start.getMinutes() / 60
      const duration = differenceInMinutes(parseISO(e.end), parseISO(e.start))
      return {
        event: e,
        topPx: Math.max((startHour - START_HOUR) * HOUR_HEIGHT, 0),
        heightPx: Math.max((duration / 60) * HOUR_HEIGHT, 18),
      }
    })
    .filter((e) => e.topPx < GRID_HEIGHT)
}

// Working intervals (in decimal hours) for a given weekday (0=Sun..6=Sat).
function workingIntervals(availability: AvailabilityRow[], dow: number): Array<{ s: number; e: number }> {
  return availability
    .filter((a) => a.day_of_week === dow)
    .map((a) => ({ s: parseHHMM(a.start_time), e: parseHHMM(a.end_time) }))
    .sort((a, b) => a.s - b.s)
}

// Derive the date range (ISO strings) for a given view + cursor.
function rangeFor(view: View, cursor: Date): { timeMin: string; timeMax: string } {
  if (view === 'day') {
    const start = new Date(cursor)
    start.setHours(0, 0, 0, 0)
    const end = new Date(cursor)
    end.setHours(23, 59, 59, 999)
    return { timeMin: start.toISOString(), timeMax: end.toISOString() }
  }
  if (view === 'week') {
    return {
      timeMin: startOfWeek(cursor, { weekStartsOn: 1 }).toISOString(),
      timeMax: endOfWeek(cursor, { weekStartsOn: 1 }).toISOString(),
    }
  }
  return {
    timeMin: startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 }).toISOString(),
    timeMax: endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 }).toISOString(),
  }
}

// ── component ────────────────────────────────────────────────────────────────

export function CalendarView({
  bookings,
  eventTypeColors = {},
  eventTypes = [],
  availability = [],
  timezone = 'UTC',
  initialExternalEvents = [],
}: CalendarViewProps) {
  const router = useRouter()
  const [view, setView] = useState<View>('week')
  const [cursor, setCursor] = useState<Date>(() => new Date())
  const [now, setNow] = useState<Date>(() => new Date())
  const [externalEvents, setExternalEvents] = useState<ExternalCalendarEvent[]>(initialExternalEvents)
  const [, startFetchTransition] = useTransition()

  const [createOpen, setCreateOpen] = useState(false)
  const [createStart, setCreateStart] = useState<Date | null>(null)
  const [createEnd, setCreateEnd] = useState<Date | null>(null)
  const [etDialogOpen, setEtDialogOpen] = useState(false)
  const [selected, setSelected] = useState<BookingRow | null>(null)
  const [cancelling, setCancelling] = useState(false)

  // Drag-to-create selection (Google-Calendar style): anchor + current hour
  // within a single day column. Fractional hours; snapped to 15 min on commit.
  const [drag, setDrag] = useState<{ day: Date; anchorHour: number; currentHour: number } | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag
  const dragColRef = useRef<HTMLElement | null>(null)

  // Tick the now-indicator every minute.
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Auto-scroll the grid to ~8am on mount / view change.
  const scrollRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = (8 - START_HOUR) * HOUR_HEIGHT - 8
  }, [view])

  // Fetch Google Calendar events whenever cursor or view changes.
  useEffect(() => {
    const { timeMin, timeMax } = rangeFor(view, cursor)
    startFetchTransition(async () => {
      const events = await getGoogleCalendarEvents(timeMin, timeMax)
      setExternalEvents(events)
    })
  }, [view, cursor])

  const days = useMemo(() => {
    if (view === 'day') return [cursor]
    if (view === 'week') {
      const ws = startOfWeek(cursor, { weekStartsOn: 1 })
      return eachDayOfInterval({ start: ws, end: endOfWeek(cursor, { weekStartsOn: 1 }) })
    }
    // month → full weeks covering the month
    const ms = startOfWeek(startOfMonth(cursor), { weekStartsOn: 1 })
    const me = endOfWeek(endOfMonth(cursor), { weekStartsOn: 1 })
    return eachDayOfInterval({ start: ms, end: me })
  }, [view, cursor])

  const confirmed = useMemo(() => bookings.filter((b) => b.status === 'confirmed'), [bookings])

  function bookingsForDay(day: Date): BookingRow[] {
    return confirmed.filter((b) => isSameDay(toZonedTime(parseISO(b.start_at), timezone), day))
  }

  function externalForDay(day: Date): ExternalCalendarEvent[] {
    return externalEvents.filter((e) => isSameDay(toZonedTime(parseISO(e.start), timezone), day))
  }

  function dateAtHour(day: Date, hour: number): Date {
    const snapped = Math.round(hour * 4) / 4 // snap to 15-min
    const d = new Date(day)
    d.setHours(Math.floor(snapped), Math.round((snapped % 1) * 60), 0, 0)
    return d
  }

  function openCreateAt(day: Date, hour: number) {
    setCreateStart(dateAtHour(day, hour))
    setCreateEnd(null) // duration comes from the event type
    setCreateOpen(true)
  }

  function openCreateRange(day: Date, startHour: number, endHour: number) {
    setCreateStart(dateAtHour(day, startHour))
    setCreateEnd(dateAtHour(day, endHour))
    setCreateOpen(true)
  }

  function clampHour(h: number): number {
    return Math.min(END_HOUR, Math.max(START_HOUR, h))
  }

  function hourFromClientY(col: HTMLElement, clientY: number): number {
    const rect = col.getBoundingClientRect()
    return clampHour(START_HOUR + (clientY - rect.top) / HOUR_HEIGHT)
  }

  // Window-level move/up so the drag keeps tracking outside the column bounds.
  useEffect(() => {
    if (!drag) return
    function onMove(e: MouseEvent) {
      const col = dragColRef.current
      if (!col) return
      setDrag((d) => (d ? { ...d, currentHour: hourFromClientY(col, e.clientY) } : d))
    }
    function onUp() {
      const d = dragRef.current
      dragColRef.current = null
      setDrag(null)
      if (!d) return
      const lo = Math.min(d.anchorHour, d.currentHour)
      const hi = Math.max(d.anchorHour, d.currentHour)
      // < 15 min of travel → treat as a plain click (event-type duration).
      if (hi - lo < 0.25) openCreateAt(d.day, lo)
      else openCreateRange(d.day, lo, hi)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [drag])

  function nav(dir: -1 | 1) {
    setCursor((c) =>
      view === 'day' ? (dir === 1 ? addDays(c, 1) : subDays(c, 1))
      : view === 'week' ? (dir === 1 ? addWeeks(c, 1) : subWeeks(c, 1))
      : (dir === 1 ? addMonths(c, 1) : subMonths(c, 1)),
    )
  }

  const title =
    view === 'day' ? format(cursor, 'EEEE, MMMM d, yyyy')
    : view === 'week' ? `${format(days[0], 'MMM d')} – ${format(days[days.length - 1], 'MMM d, yyyy')}`
    : format(cursor, 'MMMM yyyy')

  async function handleCancel() {
    if (!selected) return
    setCancelling(true)
    try {
      const res = await cancelBooking(selected.id)
      if (!res.ok) { toast.error(res.error); return }
      toast.success('Booking cancelled')
      setSelected(null)
      router.refresh()
    } finally {
      setCancelling(false)
    }
  }

  const eventTitleFor = (id: string) => eventTypes.find((e) => e.id === id)?.title ?? 'Booking'

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setCursor(new Date())}>Today</Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav(-1)}><ChevronLeft className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => nav(1)}><ChevronRight className="h-4 w-4" /></Button>
        </div>
        <span className="text-sm font-medium truncate">{title}</span>
        {/* View segmented control */}
        <div className="flex items-center gap-0.5 rounded-lg bg-bg-tertiary p-0.5">
          {(['day', 'week', 'month'] as View[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                'rounded-[6px] px-2.5 py-1 text-[12px] font-medium capitalize transition-colors',
                view === v ? 'bg-bg-primary text-text-primary shadow-sm' : 'text-text-secondary hover:text-text-primary',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'month' ? (
        /* ── Month grid ─────────────────────────────────────────── */
        <div>
          <div className="grid grid-cols-7 border-b border-border">
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
              <div key={d} className="py-2 text-center text-[11px] font-medium uppercase text-muted-foreground border-r border-border last:border-r-0">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const dayB = bookingsForDay(day)
              const dayExt = externalForDay(day).filter((e) => !e.allDay)
              const inMonth = isSameMonth(day, cursor)
              return (
                <div
                  key={day.toISOString()}
                  onClick={() => openCreateAt(day, 9)}
                  className={cn(
                    'min-h-[96px] border-r border-b border-border last:border-r-0 p-1.5 cursor-pointer transition-colors hover:bg-bg-tertiary/30',
                    !inMonth && 'bg-bg-secondary/30',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setCursor(day); setView('day') }}
                      className={cn(
                        'flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-medium',
                        isToday(day) ? 'bg-indigo-600 text-white' : inMonth ? 'text-text-primary hover:bg-bg-tertiary' : 'text-text-tertiary',
                      )}
                    >
                      {format(day, 'd')}
                    </button>
                  </div>
                  <div className="mt-1 space-y-0.5">
                    {/* External events (Google Calendar) */}
                    {dayExt.slice(0, 2).map((e) => (
                      <div
                        key={e.id}
                        onClick={(ev) => ev.stopPropagation()}
                        className="flex w-full items-center gap-1 rounded px-1 py-0.5 bg-sky-500/10"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-sky-400" />
                        <span className="truncate text-[10.5px] text-sky-600 dark:text-sky-400">
                          {format(toZonedTime(parseISO(e.start), timezone), 'HH:mm')} {e.title}
                        </span>
                      </div>
                    ))}
                    {/* Internal bookings */}
                    {dayB.slice(0, Math.max(0, 3 - Math.min(dayExt.length, 2))).map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelected(b) }}
                        className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left"
                        style={{ backgroundColor: `${eventTypeColors[b.event_type_id] ?? '#6366F1'}22` }}
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: eventTypeColors[b.event_type_id] ?? '#6366F1' }} />
                        <span className="truncate text-[10.5px] text-text-secondary">
                          {format(toZonedTime(parseISO(b.start_at), timezone), 'HH:mm')} {b.booker_name}
                        </span>
                      </button>
                    ))}
                    {(dayB.length + dayExt.length) > 3 && (
                      <div className="px-1 text-[10px] text-text-tertiary">+{dayB.length + dayExt.length - 3} more</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* ── Day / Week time grid ───────────────────────────────── */
        <>
          {/* Scrollable time grid (header is sticky inside so columns always align) */}
          <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: '620px' }}>
            {/* Sticky day headers */}
            <div className="sticky top-0 z-30 bg-card grid border-b border-border" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
              <div className="border-r border-border" />
              {days.map((day, i) => (
                <div
                  key={day.toISOString()}
                  className={cn('py-2 text-center border-r border-border last:border-r-0 animate-in fade-in slide-in-from-top-2 duration-300 fill-mode-both', isToday(day) && 'bg-indigo-500/5')}
                  style={{ animationDelay: `${i * 35}ms` }}
                >
                  <div className="text-[11px] font-medium uppercase text-muted-foreground">{format(day, 'EEE')}</div>
                  <div className={cn('mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold', isToday(day) && 'bg-indigo-600 text-white')}>
                    {format(day, 'd')}
                  </div>
                </div>
              ))}
            </div>

            <div className="grid pt-2" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
              {/* Hour labels — absolutely positioned on each line (no clipping) */}
              <div className="relative" style={{ height: GRID_HEIGHT }}>
                {VISIBLE_HOURS.map((h, i) => (
                  <span
                    key={h}
                    className="absolute right-2 text-[11px] text-muted-foreground tabular-nums"
                    style={{ top: i * HOUR_HEIGHT, transform: i === 0 ? undefined : 'translateY(-50%)' }}
                  >
                    {hourLabel(h)}
                  </span>
                ))}
              </div>

              {/* Day columns */}
              {days.map((day, i) => {
                const positioned = layoutDay(bookingsForDay(day), eventTypeColors, timezone)
                const positionedExt = layoutExternalDay(externalForDay(day), timezone)
                const dow = day.getDay()
                const intervals = workingIntervals(availability, dow)
                // Non-working shaded blocks within visible range
                const shaded: Array<{ top: number; height: number }> = []
                let pos = START_HOUR
                for (const iv of intervals) {
                  const s = Math.max(iv.s, START_HOUR)
                  if (s > pos) shaded.push({ top: (pos - START_HOUR) * HOUR_HEIGHT, height: (s - pos) * HOUR_HEIGHT })
                  pos = Math.max(pos, Math.min(iv.e, END_HOUR))
                }
                if (pos < END_HOUR) shaded.push({ top: (pos - START_HOUR) * HOUR_HEIGHT, height: (END_HOUR - pos) * HOUR_HEIGHT })

                const showNow = isToday(day)
                const nowZoned = toZonedTime(now, timezone)
                const nowHour = nowZoned.getHours() + nowZoned.getMinutes() / 60
                const nowTop = (nowHour - START_HOUR) * HOUR_HEIGHT
                const nowVisible = showNow && nowHour >= START_HOUR && nowHour < END_HOUR

                const dragOnThisDay = drag && isSameDay(drag.day, day)
                const dragLo = dragOnThisDay ? Math.min(drag.anchorHour, drag.currentHour) : 0
                const dragHi = dragOnThisDay ? Math.max(drag.anchorHour, drag.currentHour) : 0

                return (
                  <div
                    key={day.toISOString()}
                    onMouseDown={(e) => {
                      // Only left-click on empty grid starts a drag (bookings stop it).
                      if (e.button !== 0) return
                      if ((e.target as HTMLElement).closest('[data-booking]')) return
                      if ((e.target as HTMLElement).closest('[data-ext-event]')) return
                      const col = e.currentTarget as HTMLElement
                      dragColRef.current = col
                      const hour = hourFromClientY(col, e.clientY)
                      setDrag({ day, anchorHour: hour, currentHour: hour })
                    }}
                    className={cn('relative border-r border-border last:border-r-0 select-none animate-in fade-in slide-in-from-bottom-3 duration-300 fill-mode-both', isToday(day) && 'bg-indigo-500/5')}
                    style={{ height: GRID_HEIGHT, animationDelay: `${i * 35}ms` }}
                  >
                    {/* Working-hours shading (non-working dimmed) */}
                    {shaded.map((s, i) => (
                      <div key={`sh-${i}`} className="absolute inset-x-0 bg-bg-tertiary/25 pointer-events-none" style={{ top: s.top, height: s.height }} />
                    ))}

                    {/* Hour lines (visual only — create happens via click/drag on the column) */}
                    {VISIBLE_HOURS.map((h, i) => (
                      <div
                        key={h}
                        className="absolute inset-x-0 border-t border-border/40 pointer-events-none"
                        style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                      />
                    ))}

                    {/* Google Calendar external events (background layer) */}
                    {positionedExt.map(({ event, topPx, heightPx }) => (
                      <div
                        key={event.id}
                        data-ext-event
                        title={event.title}
                        className="absolute z-[5] inset-x-0.5 rounded-[4px] border border-sky-400/40 bg-sky-400/10 px-1.5 py-0.5 pointer-events-none overflow-hidden"
                        style={{ top: topPx, height: heightPx }}
                      >
                        {heightPx >= 18 && (
                          <span className="block truncate text-[10px] font-medium text-sky-600 dark:text-sky-300 leading-tight">
                            {event.title}
                          </span>
                        )}
                      </div>
                    ))}

                    {/* Drag-to-create selection preview */}
                    {dragOnThisDay && dragHi > dragLo && (
                      <div
                        className="absolute inset-x-1 z-20 rounded-md border border-indigo-400/60 bg-indigo-500/25 pointer-events-none"
                        style={{ top: (dragLo - START_HOUR) * HOUR_HEIGHT, height: (dragHi - dragLo) * HOUR_HEIGHT }}
                      >
                        <span className="absolute left-1 top-0.5 text-[10px] font-medium text-indigo-100">
                          {dateAtHour(day, dragLo).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                          {' – '}
                          {dateAtHour(day, dragHi).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}
                        </span>
                      </div>
                    )}

                    {/* Now indicator */}
                    {nowVisible && (
                      <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: nowTop }}>
                        <div className="relative h-0 border-t-2 border-red-500">
                          <span className="absolute -left-1 -top-[5px] h-2.5 w-2.5 rounded-full bg-red-500" />
                        </div>
                      </div>
                    )}

                    {/* Bookings */}
                    {positioned.map(({ booking, topPx, heightPx, color, leftPct, widthPct }, bi) => (
                      <button
                        key={booking.id}
                        type="button"
                        data-booking
                        onMouseDown={(e) => e.stopPropagation()}
                        onClick={(e) => { e.stopPropagation(); setSelected(booking) }}
                        className="absolute z-10 rounded-md overflow-hidden px-1.5 py-0.5 text-left text-white transition-opacity hover:opacity-100 animate-in fade-in zoom-in-95 duration-200 fill-mode-both"
                        style={{
                          top: Math.max(topPx, 0),
                          height: heightPx,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          backgroundColor: color,
                          opacity: 0.92,
                          animationDelay: `${i * 35 + bi * 40 + 80}ms`,
                        }}
                        title={`${booking.booker_name} · ${format(toZonedTime(parseISO(booking.start_at), timezone), 'HH:mm')}–${format(toZonedTime(parseISO(booking.end_at), timezone), 'HH:mm')}`}
                      >
                        <div className="text-[10.5px] font-semibold leading-tight truncate">
                          {format(toZonedTime(parseISO(booking.start_at), timezone), 'HH:mm')}
                        </div>
                        {heightPx > 30 && (
                          <div className="text-[10px] leading-tight truncate opacity-90">{booking.booker_name}</div>
                        )}
                      </button>
                    ))}
                  </div>
                )
              })}
            </div>
          </div>
        </>
      )}

      {/* Create booking dialog */}
      <NewBookingDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        eventTypes={eventTypes}
        defaultStart={createStart}
        defaultEnd={createEnd}
        timezone={timezone}
        onCreated={() => router.refresh()}
        onCreateEventType={() => { setCreateOpen(false); setEtDialogOpen(true) }}
      />

      {/* Event-type creation (opened from the booking dialog when none exist) */}
      <NewEventTypeDialog open={etDialogOpen} onOpenChange={setEtDialogOpen} hideTrigger />

      {/* Booking detail dialog */}
      <Dialog open={selected !== null} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="sm:max-w-[400px]">
          {selected && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: eventTypeColors[selected.event_type_id] ?? '#6366F1' }} />
                  {eventTitleFor(selected.event_type_id)}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2.5 text-[13px]">
                <div className="flex items-center gap-2 text-text-secondary">
                  <User className="h-3.5 w-3.5 text-text-tertiary" />
                  <span className="text-text-primary">{selected.booker_name}</span>
                  {selected.booker_email && <span className="text-text-tertiary">· {selected.booker_email}</span>}
                </div>
                <div className="flex items-center gap-2 text-text-secondary">
                  <Clock className="h-3.5 w-3.5 text-text-tertiary" />
                  {format(toZonedTime(parseISO(selected.start_at), timezone), 'EEE, MMM d · HH:mm')}–
                  {format(toZonedTime(parseISO(selected.end_at), timezone), 'HH:mm')}
                </div>
                {(selected as BookingRow & { location_kind?: string }).location_kind && (
                  <div className="flex items-center gap-2 text-text-secondary">
                    <MapPin className="h-3.5 w-3.5 text-text-tertiary" />
                    {(selected as BookingRow & { location_kind?: string }).location_kind}
                  </div>
                )}
                {selected.notes && <p className="text-text-tertiary border-t border-border-subtle pt-2">{selected.notes}</p>}
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="outline" size="sm" onClick={() => setSelected(null)}>Close</Button>
                <Button variant="destructive" size="sm" onClick={handleCancel} disabled={cancelling}>
                  {cancelling ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <X className="mr-1.5 h-3.5 w-3.5" />}
                  Cancel booking
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
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
import { cancelBooking } from '@/app/(dashboard)/scheduling/_actions/bookings'
import type { BookingRow } from '@/app/(dashboard)/scheduling/_actions/bookings'
import type { EventTypeRow } from '@/app/(dashboard)/scheduling/_actions/event-types'
import type { AvailabilityRow } from '@/app/(dashboard)/scheduling/_actions/availability'

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

// Working intervals (in decimal hours) for a given weekday (0=Sun..6=Sat).
function workingIntervals(availability: AvailabilityRow[], dow: number): Array<{ s: number; e: number }> {
  return availability
    .filter((a) => a.day_of_week === dow)
    .map((a) => ({ s: parseHHMM(a.start_time), e: parseHHMM(a.end_time) }))
    .sort((a, b) => a.s - b.s)
}

// ── component ────────────────────────────────────────────────────────────────

export function CalendarView({
  bookings,
  eventTypeColors = {},
  eventTypes = [],
  availability = [],
  timezone = 'UTC',
}: CalendarViewProps) {
  const router = useRouter()
  const [view, setView] = useState<View>('week')
  const [cursor, setCursor] = useState<Date>(() => new Date())
  const [now, setNow] = useState<Date>(() => new Date())

  const [createOpen, setCreateOpen] = useState(false)
  const [createStart, setCreateStart] = useState<Date | null>(null)
  const [selected, setSelected] = useState<BookingRow | null>(null)
  const [cancelling, setCancelling] = useState(false)

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

  function openCreateAt(day: Date, hour: number) {
    const d = new Date(day)
    // snap to 15-min
    const snapped = Math.round(hour * 4) / 4
    d.setHours(Math.floor(snapped), Math.round((snapped % 1) * 60), 0, 0)
    setCreateStart(d)
    setCreateOpen(true)
  }

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
                    {dayB.slice(0, 3).map((b) => (
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
                    {dayB.length > 3 && (
                      <div className="px-1 text-[10px] text-text-tertiary">+{dayB.length - 3} more</div>
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
          {/* Day headers */}
          <div className="grid border-b border-border" style={{ gridTemplateColumns: `56px repeat(${days.length}, 1fr)` }}>
            <div className="border-r border-border" />
            {days.map((day) => (
              <div key={day.toISOString()} className={cn('py-2 text-center border-r border-border last:border-r-0', isToday(day) && 'bg-indigo-500/5')}>
                <div className="text-[11px] font-medium uppercase text-muted-foreground">{format(day, 'EEE')}</div>
                <div className={cn('mx-auto mt-1 flex h-7 w-7 items-center justify-center rounded-full text-sm font-semibold', isToday(day) && 'bg-indigo-600 text-white')}>
                  {format(day, 'd')}
                </div>
              </div>
            ))}
          </div>

          {/* Scrollable time grid */}
          <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: '620px' }}>
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
              {days.map((day) => {
                const positioned = layoutDay(bookingsForDay(day), eventTypeColors, timezone)
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

                return (
                  <div
                    key={day.toISOString()}
                    className={cn('relative border-r border-border last:border-r-0', isToday(day) && 'bg-indigo-500/5')}
                    style={{ height: GRID_HEIGHT }}
                  >
                    {/* Working-hours shading (non-working dimmed) */}
                    {shaded.map((s, i) => (
                      <div key={`sh-${i}`} className="absolute inset-x-0 bg-bg-tertiary/25 pointer-events-none" style={{ top: s.top, height: s.height }} />
                    ))}

                    {/* Hour lines + click-to-create layer */}
                    {VISIBLE_HOURS.map((h, i) => (
                      <div
                        key={h}
                        onClick={(e) => {
                          const rect = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect()
                          const y = e.clientY - rect.top
                          openCreateAt(day, START_HOUR + y / HOUR_HEIGHT)
                        }}
                        className="absolute inset-x-0 border-t border-border/40 cursor-pointer hover:bg-accent/5"
                        style={{ top: i * HOUR_HEIGHT, height: HOUR_HEIGHT }}
                      />
                    ))}

                    {/* Now indicator */}
                    {nowVisible && (
                      <div className="absolute inset-x-0 z-20 pointer-events-none" style={{ top: nowTop }}>
                        <div className="relative h-0 border-t-2 border-red-500">
                          <span className="absolute -left-1 -top-[5px] h-2.5 w-2.5 rounded-full bg-red-500" />
                        </div>
                      </div>
                    )}

                    {/* Bookings */}
                    {positioned.map(({ booking, topPx, heightPx, color, leftPct, widthPct }) => (
                      <button
                        key={booking.id}
                        type="button"
                        onClick={(e) => { e.stopPropagation(); setSelected(booking) }}
                        className="absolute z-10 rounded-md overflow-hidden px-1.5 py-0.5 text-left text-white transition-opacity hover:opacity-100"
                        style={{
                          top: Math.max(topPx, 0),
                          height: heightPx,
                          left: `calc(${leftPct}% + 2px)`,
                          width: `calc(${widthPct}% - 4px)`,
                          backgroundColor: color,
                          opacity: 0.92,
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
        timezone={timezone}
        onCreated={() => router.refresh()}
      />

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

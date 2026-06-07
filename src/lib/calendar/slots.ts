// Slot generation engine for the calendar system.
// Given user availability + existing bookings + Google Calendar busy times,
// returns available time slots for a specific date.

import {
  addMinutes,
  format,
  parseISO,
  startOfDay,
  endOfDay,
  isWithinInterval,
  isBefore,
  isAfter,
  setHours,
  setMinutes,
  setSeconds,
  setMilliseconds,
} from 'date-fns'
import { fromZonedTime, toZonedTime } from 'date-fns-tz'

export interface TimeSlot {
  start: string // ISO 8601 UTC
  end: string   // ISO 8601 UTC
  startLocal: string // HH:mm in user's timezone
  endLocal: string
}

export interface BusyInterval {
  start: string
  end: string
}

export interface AvailabilityWindow {
  start_time: string // 'HH:mm:ss' or 'HH:mm'
  end_time: string
}

// Check if two intervals overlap.
function overlaps(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return isBefore(aStart, bEnd) && isAfter(aEnd, bStart)
}

// Parse 'HH:mm:ss' or 'HH:mm' into [hours, minutes].
function parseTime(timeStr: string): [number, number] {
  const parts = timeStr.split(':')
  return [parseInt(parts[0], 10), parseInt(parts[1], 10)]
}

// Generate available slots for a given date.
// All times are handled in the host's timezone (availability is defined in that timezone).
export function generateSlots(params: {
  date: string        // 'YYYY-MM-DD' | the date to generate slots for
  timezone: string    // IANA timezone of the host (e.g. 'America/Sao_Paulo')
  durationMinutes: number
  availability: AvailabilityWindow | null  // null = no availability set for this day
  existingBookings: BusyInterval[]  // confirmed bookings (UTC ISO strings)
  busyTimes: BusyInterval[]         // Google Calendar busy times (UTC ISO strings)
  bufferMinutes?: number            // buffer between slots (default 0)
  minAdvanceMinutes?: number        // min advance notice (default 60)
}): TimeSlot[] {
  const {
    date,
    timezone,
    durationMinutes,
    availability,
    existingBookings,
    busyTimes,
    bufferMinutes = 0,
    minAdvanceMinutes = 60,
  } = params

  if (!availability) return []

  const [startH, startM] = parseTime(availability.start_time)
  const [endH, endM] = parseTime(availability.end_time)

  // Build window start and end in the host's local timezone
  const localDate = parseISO(date) // interpreted as local date
  const windowStartLocal = setMilliseconds(
    setSeconds(setMinutes(setHours(localDate, startH), startM), 0),
    0,
  )
  const windowEndLocal = setMilliseconds(
    setSeconds(setMinutes(setHours(localDate, endH), endM), 0),
    0,
  )

  // Convert to UTC
  const windowStartUtc = fromZonedTime(windowStartLocal, timezone)
  const windowEndUtc = fromZonedTime(windowEndLocal, timezone)

  // All busy intervals merged
  const allBusy: BusyInterval[] = [...existingBookings, ...busyTimes]
  const now = new Date()
  const minAdvanceCutoff = addMinutes(now, minAdvanceMinutes)

  const slots: TimeSlot[] = []
  let cursor = windowStartUtc

  const stepMinutes = durationMinutes + bufferMinutes

  while (isBefore(addMinutes(cursor, durationMinutes), windowEndUtc) ||
         addMinutes(cursor, durationMinutes).getTime() === windowEndUtc.getTime()) {
    const slotStart = cursor
    const slotEnd = addMinutes(cursor, durationMinutes)

    // Skip slots that are too soon
    if (isBefore(slotStart, minAdvanceCutoff)) {
      cursor = addMinutes(cursor, stepMinutes)
      continue
    }

    // Skip if overlaps any busy interval
    const blocked = allBusy.some((busy) => {
      const bStart = parseISO(busy.start)
      const bEnd = parseISO(busy.end)
      return overlaps(slotStart, slotEnd, bStart, bEnd)
    })

    if (!blocked) {
      // Convert back to local time for display
      const startLocal = toZonedTime(slotStart, timezone)
      const endLocal = toZonedTime(slotEnd, timezone)

      slots.push({
        start: slotStart.toISOString(),
        end: slotEnd.toISOString(),
        startLocal: format(startLocal, 'HH:mm'),
        endLocal: format(endLocal, 'HH:mm'),
      })
    }

    cursor = addMinutes(cursor, stepMinutes)
  }

  return slots
}

// ── Debug / troubleshooting types ────────────────────────────────────────────

export type SlotBlockReason = 'past' | 'booked' | 'google_busy'

export interface DebugTimeSlot extends TimeSlot {
  available: boolean
  reason?: SlotBlockReason
}

// Like generateSlots but returns ALL candidate slots (available + blocked),
// each tagged with the reason it was blocked. Used by the troubleshooting view.
export function generateSlotsWithReasons(params: {
  date: string
  timezone: string
  durationMinutes: number
  availability: AvailabilityWindow | null
  existingBookings: BusyInterval[]
  busyTimes: BusyInterval[]
  bufferMinutes?: number
  minAdvanceMinutes?: number
}): DebugTimeSlot[] {
  const {
    date,
    timezone,
    durationMinutes,
    availability,
    existingBookings,
    busyTimes,
    bufferMinutes = 0,
    minAdvanceMinutes = 60,
  } = params

  if (!availability) return []

  const [startH, startM] = parseTime(availability.start_time)
  const [endH, endM] = parseTime(availability.end_time)

  const localDate = parseISO(date)
  const windowStartLocal = setMilliseconds(
    setSeconds(setMinutes(setHours(localDate, startH), startM), 0), 0,
  )
  const windowEndLocal = setMilliseconds(
    setSeconds(setMinutes(setHours(localDate, endH), endM), 0), 0,
  )

  const windowStartUtc = fromZonedTime(windowStartLocal, timezone)
  const windowEndUtc = fromZonedTime(windowEndLocal, timezone)

  const now = new Date()
  const minAdvanceCutoff = addMinutes(now, minAdvanceMinutes)
  const stepMinutes = durationMinutes + bufferMinutes

  const slots: DebugTimeSlot[] = []
  let cursor = windowStartUtc

  while (
    isBefore(addMinutes(cursor, durationMinutes), windowEndUtc) ||
    addMinutes(cursor, durationMinutes).getTime() === windowEndUtc.getTime()
  ) {
    const slotStart = cursor
    const slotEnd = addMinutes(cursor, durationMinutes)

    const startLocal = toZonedTime(slotStart, timezone)
    const endLocal = toZonedTime(slotEnd, timezone)
    const base: TimeSlot = {
      start: slotStart.toISOString(),
      end: slotEnd.toISOString(),
      startLocal: format(startLocal, 'HH:mm'),
      endLocal: format(endLocal, 'HH:mm'),
    }

    if (isBefore(slotStart, minAdvanceCutoff)) {
      slots.push({ ...base, available: false, reason: 'past' })
      cursor = addMinutes(cursor, stepMinutes)
      continue
    }

    // Check bookings first, then Google Calendar
    const bookedBy = existingBookings.find((b) =>
      overlaps(slotStart, slotEnd, parseISO(b.start), parseISO(b.end)),
    )
    if (bookedBy) {
      slots.push({ ...base, available: false, reason: 'booked' })
      cursor = addMinutes(cursor, stepMinutes)
      continue
    }

    const gcalBusy = busyTimes.find((b) =>
      overlaps(slotStart, slotEnd, parseISO(b.start), parseISO(b.end)),
    )
    if (gcalBusy) {
      slots.push({ ...base, available: false, reason: 'google_busy' })
      cursor = addMinutes(cursor, stepMinutes)
      continue
    }

    slots.push({ ...base, available: true })
    cursor = addMinutes(cursor, stepMinutes)
  }

  return slots
}

// Get which days of the month have availability (for date picker highlighting).
export function getDaysWithAvailability(
  year: number,
  month: number, // 0-indexed
  availableDays: number[], // day_of_week 0-6 that have availability set
  timezone: string,
): string[] {
  const dates: string[] = []
  const now = new Date()

  // Iterate all days of the month
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(year, month, day)
    const dow = date.getDay()
    if (availableDays.includes(dow) && isAfter(date, now)) {
      dates.push(format(date, 'yyyy-MM-dd'))
    }
  }

  return dates
}

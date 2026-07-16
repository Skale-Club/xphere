// Single source of truth for the bookings.status vocabulary (LIFE-02).
// Mirrors the DB CHECK constraint in
// supabase/migrations/1224_booking_status_showed.sql exactly. Every writer
// that sets bookings.status imports BookingStatus / BOOKING_STATUSES from
// here instead of redeclaring its own local union type -- three separate,
// mutually-inconsistent local declarations existed before Phase 127
// (src/lib/calendar/transition.ts, src/lib/flows/engine.ts,
// src/lib/action-engine/executors/update-booking-status.ts); flows/engine.ts's
// version wrongly included 'pending'/'completed' and was missing 'showed',
// which let it attempt an invalid `status: 'completed'` write the DB CHECK
// constraint rejects at runtime.
//
// Vocabulary note (LIFE-02): the DB has no 'completed' status. A booking
// that was attended transitions to 'showed' -- the ONLY completion/
// attendance value. The workflow-facing event name 'meeting.completed'
// (src/lib/calendar/events.ts) is emitted when a booking transitions to
// 'showed' -- see src/lib/calendar/transition.ts::markShowed. One
// real-world moment, two names, reconciled there instead of adding a
// redundant 'completed' DB status.

import type { Database } from '@/types/database'

export type BookingStatus = Database['public']['Tables']['bookings']['Row']['status']

export const BOOKING_STATUSES: readonly BookingStatus[] = [
  'confirmed',
  'cancelled',
  'no_show',
  'showed',
] as const

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === 'string' && (BOOKING_STATUSES as readonly string[]).includes(value)
}

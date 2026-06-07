// SEED-027 Phase A: typed calendar event names.
// Every booking lifecycle transition or time-based trigger emits one of these
// via lib/calendar/transition.ts (Phase B). The workflow engine's trigger
// registry indexes workflows by these values.

export type CalendarEvent =
  | 'meeting.scheduled'
  | 'meeting.confirmed'
  | 'meeting.cancelled'
  | 'meeting.rescheduled'
  | 'meeting.no_show'
  | 'meeting.completed'
  | 'meeting.starts_in'
  | 'meeting.ended'

export const CALENDAR_EVENTS: readonly CalendarEvent[] = [
  'meeting.scheduled',
  'meeting.confirmed',
  'meeting.cancelled',
  'meeting.rescheduled',
  'meeting.no_show',
  'meeting.completed',
  'meeting.starts_in',
  'meeting.ended',
] as const

export interface CalendarEventPayload {
  event: CalendarEvent
  booking_id: string
  org_id: string
  // Populated for meeting.starts_in only.
  offset_minutes?: number
  // Populated for meeting.rescheduled only.
  rescheduled_from?: string
  rescheduled_to?: string
}

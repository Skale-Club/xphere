---
status: partial
phase: 130-calendar-product-coherence
source: [130-06-PLAN.md]
started: 2026-07-16T05:20:00Z
updated: 2026-07-16T05:20:00Z
---

## Current Test

[awaiting human testing — requires an authenticated dashboard session, which the autonomous orchestrator does not hold]

## Tests

### 1. Bookings page shows `showed` bucket
expected: /calendar/bookings renders Upcoming/Past/Cancelled sections; a booking with status `showed` appears in Past with a distinct sky badge; empty states render a message (not a blank page)
result: [pending]

### 2. Calendar view bounded + refetch
expected: /calendar/calendar loads only the visible week's bookings; navigating weeks/views re-fetches; cancel + new-booking dialogs refresh the visible range without full reload
result: [pending]

### 3. Round-robin removed
expected: "New event type" dialog offers no Round robin option (single-step form, personal only)
result: [pending]

### 4. Dead preference control removed
expected: /calendar/preferences no longer shows the default location select (empty-state card in its place); page renders without errors
result: [pending]

### 5. Allowed meeting locations control
expected: event type form shows the "Allowed meeting locations" checkbox group with exactly 6 kinds (no zoom/whereby/store location); saving persists; invalid kinds rejected
result: [pending]

### 6. google_meet link generation
expected: creating a booking on an event type with location kind google_meet (with Google connected) produces a meeting_url on the booking/confirmation
result: [pending]

### 7. Contact panel booking labels
expected: contact side panel booking summaries show the real event-type title (not the generic "Booking") and a distinct badge for showed
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps

## Notes

Automated smoke check by the orchestrator (2026-07-16): production build server (`npx next start`) served /calendar, /calendar/bookings, /calendar/calendar, /calendar/preferences, /login — all 200, zero server errors. All logic-level behavior is covered by the phase's 46+ unit tests (green). These UAT items are visual/interaction confirmations only.

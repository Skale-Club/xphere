---
phase: 130-calendar-product-coherence
plan: 03
subsystem: calendar
tags: [ui, product-coherence, dead-code-removal, react, next.js]

# Dependency graph
requires:
  - phase: 130-calendar-product-coherence
    provides: 130-RESEARCH.md's grep-confirmed dead-control findings (round_robin, default_location_type)
provides:
  - Single-step event type creation dialog (booking_type always 'personal')
  - Preferences page with the dead location-type select removed
affects: [130-calendar-product-coherence remaining plans, any future round-robin or per-org-location feature work]

# Tech tracking
tech-stack:
  added: []
  patterns: [UI-only removal preserving underlying DB columns per D-02 (hide/disable with data preserved)]

key-files:
  created: []
  modified:
    - src/components/calendar/new-event-type-dialog.tsx
    - src/components/calendar/meeting-preferences.tsx
    - src/app/(dashboard)/calendar/preferences/page.tsx

key-decisions:
  - "Left the code comment in new-event-type-dialog.tsx referencing 'round-robin'/'round_robin' as the removal rationale, per the plan's own acceptance criteria parenthetical allowing the comment (only user-facing labels needed to disappear); Task 2's comment was pre-revised by the planner to avoid the grep-target literal entirely."
  - "getSchedulingProfile()/updateSchedulingPreferences()/SchedulingProfile type in calendar-profile.ts left completely untouched — still backs the Connections page's sync_mode/conflict_calendar_ids settings."

patterns-established:
  - "Dead customer-facing control removal: strip the UI, leave the DB column/action/type in place (D-02) — grep-verify the acceptance criteria distinguish 'user-facing string' from 'code comment documenting the removal'."

requirements-completed: [SYNC-04]

# Metrics
duration: 15min
completed: 2026-07-16
---

# Phase 130 Plan 03: Remove Dead Round-Robin Chooser and Location-Type Select Summary

**Collapsed the event-type creation dialog to a single always-personal form step, and replaced the Preferences page's non-functional "Meeting location" select with an empty-state card — zero DB changes, zero data loss.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-16T07:14:15Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `new-event-type-dialog.tsx` no longer shows the "Personal booking" vs "Round robin" chooser step — every event type created goes straight to the form and is always submitted with `booking_type: 'personal'`
- `meeting-preferences.tsx` no longer renders the "Meeting location" select that promised per-option behavior (e.g. automatic Google Meet link generation) nothing in the booking-creation path ever implemented
- `preferences/page.tsx` no longer fetches `getSchedulingProfile()` to hydrate the removed control
- `calendar_profiles.default_location_type`, the `booking_type` column, and all existing `'round_robin'`-flagged rows are untouched in the database — this was a UI-only removal per D-02

## Task Commits

Each task was committed atomically:

1. **Task 1: Remove the round-robin booking-type chooser from event type creation** - `b3dd3665` (feat)
2. **Task 2: Remove the dead default_location_type control from Preferences** - `3b9a3090` (feat)

**Plan metadata:** (pending — see final commit below)

## Files Created/Modified
- `src/components/calendar/new-event-type-dialog.tsx` - Single-step dialog; drops the `BookingType`/`BOOKING_TYPES` chooser entirely
- `src/components/calendar/meeting-preferences.tsx` - Now a props-less component rendering an empty-state card
- `src/app/(dashboard)/calendar/preferences/page.tsx` - No longer calls `getSchedulingProfile()` or passes `defaultLocationType`

## Decisions Made
- Kept `getSchedulingProfile`/`updateSchedulingPreferences`/`SchedulingProfile` (in `calendar-profile.ts`) fully intact since the Connections page still depends on `sync_mode`/`conflict_calendar_ids` from the same action file — confirmed via grep that `getSchedulingProfile` remains referenced by `calendar/connections/page.tsx`, `calendar/page.tsx`, `calendar/calendar/page.tsx`, and `opportunity-detail-sheet.tsx`.
- Followed the plan's acceptance-criteria parenthetical literally: Task 1's code comment intentionally still contains the words "round-robin"/"round_robin" as removal-rationale documentation (not a user-facing label); verified via grep that no rendered "Round robin" or "Personal booking" text remains in the component.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Both dead controls are fully removed from the customer-facing UI with zero backend/data impact.
- `booking_type` and `default_location_type` columns remain exactly as they were for every existing row, ready for a future real round-robin or per-org-location feature to build on top of without a data migration.
- Manual/browser QA for this plan's changes is deferred to the phase-level checkpoint in Plan 130-06, per the plan's `<verification>` note.

---
*Phase: 130-calendar-product-coherence*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: src/components/calendar/new-event-type-dialog.tsx
- FOUND: src/components/calendar/meeting-preferences.tsx
- FOUND: src/app/(dashboard)/calendar/preferences/page.tsx
- FOUND commit: b3dd3665
- FOUND commit: 3b9a3090

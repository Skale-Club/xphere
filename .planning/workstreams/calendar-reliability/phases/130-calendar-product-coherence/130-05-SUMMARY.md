---
phase: 130-calendar-product-coherence
plan: 05
subsystem: calendar
tags: [google-calendar, bookings, vitest, tdd, sync]

# Dependency graph
requires:
  - phase: 129-provider-synchronization-integrity
    provides: "bookings.google_event_id dedicated column (migration 1254) + createCalendarEvent id persistence at the same two call sites this plan extends"
  - phase: 127-canonical-booking-lifecycle
    provides: "confirmed the booking-creation insert in bookings.ts's createBooking/createBookingInternal was NOT moved by Phase 127 — the pre-127 call sites this plan targeted were still current"
provides:
  - "createBooking and createBookingInternal both invoke createMeetingLink (already-correct, previously-dead-code-only logic in transition.ts::confirmBooking) whenever the resolved location kind is google_meet"
  - "meeting_url + google_event_id persisted onto the booking row before the confirmation-email pipeline's freshBooking re-fetch runs"
affects: [130-06-manual-browser-qa]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Location-kind-gated side effect placed BEFORE the notification-gating check (if (email)) in createBookingInternal, since the effect's scope is the location kind, not whether a notification will fire"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/calendar/_actions/bookings.ts
    - tests/calendar-bookings.test.ts

key-decisions:
  - "Renamed the plan's proposed 'Test 7'/'Test 8' labels to 'Test 14'/'Test 15' to avoid colliding with pre-existing tests of the same number already present in cancelBookingByToken's and cancelBooking's describe blocks in the same file (numbers the plan's original sketch predates)"
  - "Persisted google_event_id onto the dedicated bookings.google_event_id column exactly as Phase 129 shipped it (confirmed via 129-02-SUMMARY.md) — no location_data fallback needed"

requirements-completed: [SYNC-04]

# Metrics
duration: 14min
completed: 2026-07-16
---

# Phase 130 Plan 05: Wire createMeetingLink Into Booking Creation Summary

**`createBooking`/`createBookingInternal` now call the previously-dead-code `createMeetingLink()` whenever a booking's resolved location kind is `google_meet`, persisting the real Meet link and its Calendar event id onto Phase 129's dedicated `bookings.google_event_id` column before the confirmation email re-fetches it.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-16T07:22:00Z (approx, per session start)
- **Completed:** 2026-07-16T07:36:22Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- `createBooking` inserts a Google Meet-enabled Calendar event (via `createMeetingLink`) immediately after the existing plain `createCalendarEvent` block, awaited and completed before the confirmation-email IIFE's `freshBooking` re-fetch — closing the gap where `google_meet` was an allowed, selectable location kind (Plan 130-04) but never actually produced a working link
- `createBookingInternal` gets the identical fix, placed before its `if (email)` gate (the notification-path gate) rather than inside it — the plan's explicit correction, since Meet-link generation is about the booking's location kind, not whether a notification will be sent
- Both call sites persist `meeting_url` and `google_event_id` onto the same dedicated `bookings.google_event_id` column Phase 129 introduced — deliberately overwriting the plain-event id Phase 129's own block writes a few lines earlier in each function, since the Meet-enabled event is the more relevant one for a `google_meet` booking. No wholesale `location_data` replacement anywhere in the diff.
- 2 new regression tests (`tests/calendar-bookings.test.ts`) prove the call-with-right-args path and the never-called-for-other-kinds path independently; `createMeetingLink` failures are non-fatal (wrapped try/catch), matching every other Google Calendar call site in this file

## Task Commits

Full TDD RED-GREEN (no REFACTOR needed — GREEN matched the plan's specified shape exactly):

1. **Task 1 RED: failing tests for google_meet meeting-link wiring** - `743b4563` (test)
2. **Task 1 GREEN: wire createMeetingLink into booking creation for google_meet** - `4194c602` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP update)

## Files Created/Modified

- `src/app/(dashboard)/calendar/_actions/bookings.ts` - `createBooking` and `createBookingInternal` each gain an `if (effectiveLocationKind === 'google_meet')` block that awaits `createMeetingLink` and conditionally `.update()`s `meeting_url`/`google_event_id` on the just-inserted booking row
- `tests/calendar-bookings.test.ts` - added `createMeetingLink: vi.fn(async () => null)` to the existing google-calendar mock factory, a static `createMeetingLink` import, and a new `describe('createBooking — Google Meet location kind (SYNC-04)', ...)` block with Test 14 (calls with correct args) and Test 15 (never called for non-google_meet kinds)

## Decisions Made

- Test numbers 14/15 chosen instead of the plan's literal 7/8 — those numbers were already claimed by pre-existing tests in `describe('cancelBookingByToken', ...)` (Test 7) and `describe('cancelBooking (dashboard)', ...)` (Test 8) in the same file, added by Phase 127 plans after this plan's numbering was originally sketched. Renumbering avoids duplicate-named tests in the suite output; no functional impact.
- Confirmed via `129-02-SUMMARY.md` that `bookings.google_event_id` shipped exactly as the expected dedicated column (not a different name, not absent) — the plan's `location_data`-merge fallback path was not needed.
- Confirmed via `127-01-SUMMARY.md`/on-disk read that Phase 127 did not move `createBooking`/`createBookingInternal`'s booking-creation insert out of `bookings.ts` — the plan's pre-127 code shape assumption held exactly, so the diff was applied as originally written (adjusted only for Phase 129's already-present `google_event_id` update block a few lines above each new insertion point).

## Deviations from Plan

None beyond the test-numbering rename documented above (cosmetic, not a Rule 1-4 deviation — no production behavior affected, just avoiding duplicate test labels in an already-decided-collision numbering scheme).

## Issues Encountered

None. `npx vitest run tests/calendar-bookings.test.ts` is green at 16/16 (14 pre-existing + 2 new). `npm run build` succeeds with no new type errors (only a pre-existing, unrelated Sentry `sentry.client.config.ts` deprecation warning appears in output).

## User Setup Required

None - no external service configuration required. This plan only wires an already-existing, already-correct API call (`createMeetingLink`, unchanged by this plan) into two call sites; no new migrations, no new env vars.

## Next Phase Readiness

- SYNC-04's "modest effort" gap (an event type allowing `google_meet` as a location never actually producing a Meet link) is closed at the code level for both native booking-creation paths.
- Automated coverage is scoped to `createBooking` per the plan's explicit boundary (`createBookingInternal` has no existing unit-test describe block in this file); its identical production change is verified by `npm run build` plus Plan 130-06's manual/browser QA checkpoint, matching this file's existing test-coverage boundary.
- Plan 130-06 (manual/browser QA against a real connected Google Calendar integration) is the remaining verification step for this phase's `google_meet` completion — no blockers.

---
*Phase: 130-calendar-product-coherence*
*Completed: 2026-07-16*

## Self-Check: PASSED

Both key files confirmed present on disk (`src/app/(dashboard)/calendar/_actions/bookings.ts`, `tests/calendar-bookings.test.ts`) and modified per `git diff --stat`. Both task commit hashes (`743b4563`, `4194c602`) confirmed present in `git log --oneline`.

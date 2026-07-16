---
phase: 127-canonical-booking-lifecycle
plan: 05
subsystem: calendar
tags: [xkedule, webhook, vitest, booking-lifecycle, calendar-events]

requires:
  - phase: 127-canonical-booking-lifecycle
    provides: "src/lib/calendar/booking-status.ts's shared BookingStatus type (Plan 127-01) — imported to replace the route's own local status union"
provides:
  - "src/app/api/xkedule/webhook/route.ts::mapStatus now maps Xkedule's 'completed' status to the DB's 'showed' status instead of silently absorbing it into 'confirmed'"
  - "src/app/api/xkedule/webhook/route.ts::calendarEventFor now emits 'meeting.completed' for status 'showed', checked ahead of the 'booking.confirmed' branch and the final 'meeting.rescheduled' fallback"
  - "The existing-row update branch now checks its own {error} result and returns { skipped: 'update_failed' } (mirroring the insert branch's 'insert_failed' convention) instead of unconditionally emitting a calendar event after a discarded/failed update"
  - "tests/xkedule-webhook.test.ts — first-ever test coverage for POST /api/xkedule/webhook (17 tests)"
affects: [129-04]

tech-stack:
  added: []
  patterns:
    - "Chain-proxy fake Supabase client for a webhook route handler, modeled on tests/calendar-bookings.test.ts's buildFakeAdmin — per-table .from() dispatch, captured insert/update vi.fn mocks for payload assertions, exported POST(request) called directly with a real Request object rather than testing internal helpers"

key-files:
  created:
    - tests/xkedule-webhook.test.ts
  modified:
    - src/app/api/xkedule/webhook/route.ts

key-decisions:
  - "Covered mapStatus/calendarEventFor's many input/output combinations entirely through the exported POST handler (constructing distinct event/booking.status payloads) rather than exporting the two private helper functions for direct unit testing, per the plan's explicit instruction"
  - "Wrote all 17 test cases (covering both Task 1's and Task 2's behavior bullets) in a single RED commit since they share one fake-client harness and one test file — then applied each task's fix in its own GREEN commit, verifying the correct subset of tests flipped green at each stage (16/17 after Task 1, 17/17 after Task 2)"

requirements-completed: [LIFE-02, LIFE-03]

duration: 15min
completed: 2026-07-16
---

# Phase 127 Plan 05: Xkedule Webhook completed→showed + Failed-Write Event Suppression Summary

**Xkedule's 'completed' booking status now reaches the DB's 'showed' value and fires meeting.completed; the existing-row mirror-update branch no longer emits a calendar event describing a write that never happened.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-15T23:35:00-04:00 (approx)
- **Completed:** 2026-07-15T23:42:24-04:00
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `mapStatus('completed')` now returns `'showed'` instead of falling through to `'confirmed'` — Xkedule-sourced bookings can finally reach the DB's only attendance/completion value and trigger `showed`-gated workflows
- `calendarEventFor(event, 'showed')` now returns `'meeting.completed'`, checked before the `event === 'booking.confirmed'` branch and the final `'meeting.rescheduled'` fallback — closing the fallback misclassification the plan's objective called out
- The existing-row update branch now captures `{ error }` from `supabase.from('bookings').update(...)` and returns `{ skipped: 'update_failed' }` before reaching `emitCalendarEvent` on failure, mirroring the insert branch's pre-existing `'insert_failed'` convention
- `tests/xkedule-webhook.test.ts` (new, 17 tests) is the first-ever test coverage for this route: mapStatus's full input space (7 tests), calendarEventFor's full priority ordering (7 tests), and the existing-row branch's success/failure/regression paths (3 tests) — all driven through the route's exported `POST(request)` with a chain-proxy fake Supabase client

## Task Commits

Each task was committed atomically (TDD RED-GREEN, both tasks sharing one RED test-authoring commit since they touch the same file/harness):

1. **RED (both tasks): failing tests for status/event mapping + update-failure handling** - `6c5f6268` (test)
2. **Task 1: mapStatus completed→showed + calendarEventFor showed→meeting.completed** - `824ea510` (feat)
3. **Task 2: existing-row update branch skips emit on failed write** - `5b27a6aa` (fix)

**Plan metadata:** (pending — this commit)

_Note: the RED commit includes all 17 test cases (both tasks' behavior bullets) since they share one test file and fake-client harness; each subsequent GREEN commit was verified to flip exactly the expected subset of tests (16/17 passing after Task 1's commit, 17/17 after Task 2's commit) before being made._

## Files Created/Modified

- `tests/xkedule-webhook.test.ts` - first test file for this route; chain-proxy fake Supabase client (api_keys/bookings/event_types/org_members/contacts), payload/request builders, 17 tests across 3 describe blocks (mapStatus, calendarEventFor, existing-row update branch)
- `src/app/api/xkedule/webhook/route.ts` - `mapStatus` and `calendarEventFor` retyped against the shared `BookingStatus` (Plan 127-01's `booking-status.ts`); `mapStatus` gains the `'completed' → 'showed'` branch; `calendarEventFor` gains the `status === 'showed' → 'meeting.completed'` branch; the existing-row update branch now checks `{ error: updateErr }` and short-circuits with `{ skipped: 'update_failed' }` before `emitCalendarEvent`

## Decisions Made

- Tested `mapStatus`/`calendarEventFor` exclusively through the exported `POST` handler (constructing payloads with the right `event`/`booking.status` combinations) rather than exporting the two private helpers, matching the plan's explicit test-authoring instruction and keeping the route's internal helpers private
- Combined both tasks' test cases into a single RED commit (one test file, one fake-client harness) but kept two separate GREEN commits, one per task's fix, each independently verified against the correct subset of passing/failing tests

## Deviations from Plan

None - plan executed exactly as written. The RED/GREEN commit grouping (all tests written once, fixes committed separately per task) is a TDD execution-organization choice, not a scope or behavior deviation — every acceptance criterion and behavior bullet from both tasks is implemented and tested exactly as specified.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness

- `npx vitest run tests/xkedule-webhook.test.ts` — 17/17 green
- `npm run build` — passes (production build + type check)
- `grep -n "mapStatus\|calendarEventFor\|update_failed" src/app/api/xkedule/webhook/route.ts` confirms all three fixes are present
- Per the plan's heads-up: this test file's describe blocks (mapStatus / calendarEventFor / existing-row update branch) are scoped by concern so Plan 129-04 can add a new describe block for existing-row status transitions through the lifecycle service without restructuring what's here
- No blockers

---
*Phase: 127-canonical-booking-lifecycle*
*Completed: 2026-07-16*

## Self-Check: PASSED

All key-files confirmed present on disk (`tests/xkedule-webhook.test.ts`, `src/app/api/xkedule/webhook/route.ts`, `127-05-SUMMARY.md`). All 3 task commits confirmed present in git history (`6c5f6268`, `824ea510`, `5b27a6aa`).

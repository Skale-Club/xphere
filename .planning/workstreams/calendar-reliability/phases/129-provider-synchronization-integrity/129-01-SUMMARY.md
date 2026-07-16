---
phase: 129-provider-synchronization-integrity
plan: 01
subsystem: calendar
tags: [google-calendar, freeBusy, booking-validation, conflict-calendars, typescript]

# Dependency graph
requires:
  - phase: 126-booking-trust-boundary
    provides: resolveAndValidateSlot as the shared slot-validation core used by both createBooking and the MCP bookings_create tool
provides:
  - fetchBusyTimes(userId, orgId, timeMin, timeMax, calendarIds = ['primary']) — one freeBusy request merging busy intervals across multiple calendars
  - All 3 fetchBusyTimes call sites (resolveAndValidateSlot, getAvailableSlots, getDebugSlots) honoring calendar_profiles.conflict_calendar_ids identically
  - database.ts calendar_profiles Row/Insert/Update types matching the live schema (sync_mode, default_location_type, conflict_calendar_ids)
affects: [130-calendar-ui-coherence, future-google-event-id-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Multi-item Google freeBusy request (items: ids.map(id => ({id}))) instead of N sequential single-calendar requests"
    - "Per-call-site conflict_calendar_ids lookup with ['primary'] fallback, applied identically across display and validation paths to prevent slot-availability drift"

key-files:
  created:
    - tests/google-calendar-busy.test.ts
  modified:
    - src/lib/calendar/google-calendar.ts
    - src/lib/calendar/booking-validation.ts
    - src/app/(dashboard)/calendar/_actions/bookings.ts
    - src/types/database.ts
    - tests/booking-validation.test.ts

key-decisions:
  - "Extended fetchBusyTimes's 5th parameter from a single calendarId string to a calendarIds: string[] array (default ['primary']) rather than adding a new function — backward-compatible for all existing 4-arg callers"
  - "Fixed database.ts's stale calendar_profiles types (missing sync_mode/default_location_type/conflict_calendar_ids since migrations 1141/1142) at the root instead of adding another local cast, per the plan's interfaces block"

requirements-completed: [SYNC-01]

# Metrics
duration: 9min
completed: 2026-07-16
---

# Phase 129 Plan 01: Multi-Calendar Conflict Detection Summary

**`fetchBusyTimes` now issues one Google freeBusy request across all of an organizer's configured `conflict_calendar_ids`, and all 3 call sites (slot validation + both slot-display paths) honor that selection identically instead of hardcoding `'primary'`.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-16T05:36:55Z
- **Completed:** 2026-07-16T05:45:01Z
- **Tasks:** 2 completed
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- `fetchBusyTimes` accepts `calendarIds: string[] = ['primary']`, issues exactly one multi-`items` freeBusy request, and merges the returned busy intervals across all requested calendars
- `resolveAndValidateSlot`, `getAvailableSlots`, and `getDebugSlots` all read the organizer's `calendar_profiles.conflict_calendar_ids` and pass it through to `fetchBusyTimes`, falling back to `['primary']` when unset — closing SYNC-01 Gap 1 (an organizer's Settings selection was silently ignored everywhere it mattered)
- `database.ts`'s `calendar_profiles` types now include `sync_mode`, `default_location_type`, and `conflict_calendar_ids`, matching the live schema since migrations 1141/1142 (previously only worked around via a hand-maintained cast in `calendar-profile.ts`)

## Task Commits

Each task was committed atomically (Task 1 followed full TDD RED-GREEN):

1. **Task 1 RED: failing test for fetchBusyTimes multi-calendar merge** - `3acd9112` (test)
2. **Task 1 GREEN: merge busy intervals across multiple calendar ids** - `ae370174` (feat)
3. **Task 2: wire conflict_calendar_ids into all 3 call sites** - `fae1252b` (feat)

_Note: Task 1 used tdd="true" per plan frontmatter; no REFACTOR commit was needed — the GREEN implementation matched the plan's specified shape exactly._

## Files Created/Modified
- `src/lib/calendar/google-calendar.ts` - `fetchBusyTimes` signature/body changed to accept and merge multiple calendar ids in one request
- `tests/google-calendar-busy.test.ts` - new: 4 tests covering default-to-primary, multi-id merge/single-request, missing-calendar-in-response, non-ok-response fail-open
- `src/lib/calendar/booking-validation.ts` - `resolveAndValidateSlot` reads `conflict_calendar_ids` alongside `timezone`, passes it as `fetchBusyTimes`'s 5th arg
- `src/app/(dashboard)/calendar/_actions/bookings.ts` - `getAvailableSlots` and `getDebugSlots` apply the identical pattern (both still use `.single()` for the profile query, unchanged)
- `src/types/database.ts` - `calendar_profiles` Row/Insert/Update gain `sync_mode`, `default_location_type`, `conflict_calendar_ids` to match the live schema
- `tests/booking-validation.test.ts` - 2 new tests (12, 13) asserting `conflict_calendar_ids` forwarding and the `['primary']` fallback

## Decisions Made
- Kept `fetchBusyTimes`'s existing parameter position (5th arg) and changed its type from `string` to `string[]` rather than introducing a new overload — every pre-existing 4-arg call site continues to compile and behave identically (defaults to `['primary']`, single-item request)
- Fixed the root cause in `database.ts` for the missing `calendar_profiles` columns instead of adding a 4th cast site, per the plan's `<interfaces>` block noting `calendar-profile.ts` already works around this with a hand-maintained type and a comment flagging the stale generated type

## Deviations from Plan

None - plan executed exactly as written. The two TypeScript errors initially surfaced by `npx tsc --noEmit` in the new `tests/google-calendar-busy.test.ts` (tuple-index-out-of-bounds on `fetchMock.mock.calls[0][1]`) were an artifact of the plan's example test code being illustrative pseudocode, not literal TypeScript — fixed by adding explicit parameter types to the mock function and optional-chaining the call-args access, following the exact pattern already used in `tests/twilio-configure-number.test.ts` (`fetchMock.mock.calls[0]?.[1]?.body as string`). This is test-file-only typing cleanup with no behavioral change, applied before the Task 1 GREEN commit so it never landed as a separate deviation commit.

## Issues Encountered
None. `npx tsc --noEmit` still reports pre-existing errors in unrelated files (`tests/email-template-builder.test.ts`, `tests/meta-inbox-bot-toggle.test.ts`, `tests/workflows/*.test.ts`) — confirmed out of scope (not touched by this plan, not caused by these changes) and left untouched per the scope-boundary rule.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- SYNC-01 Gap 1 (conflict calendars ignored) is closed. SYNC-01 Gap 2 (Google event id discarded) and SYNC-02 (Xkedule/GHL lifecycle conformance) remain for subsequent plans in this phase.
- No blockers for continuing Phase 129 with the next plan (129-02 or whichever plan addresses Gap 2 / SYNC-02).

---
*Phase: 129-provider-synchronization-integrity*
*Completed: 2026-07-16*

## Self-Check: PASSED

All key files verified present on disk (`tests/google-calendar-busy.test.ts`, `src/lib/calendar/google-calendar.ts`, `src/lib/calendar/booking-validation.ts`, `src/app/(dashboard)/calendar/_actions/bookings.ts`, `src/types/database.ts`, this SUMMARY.md). All 3 task commit hashes (`3acd9112`, `ae370174`, `fae1252b`) confirmed present in `git log`.

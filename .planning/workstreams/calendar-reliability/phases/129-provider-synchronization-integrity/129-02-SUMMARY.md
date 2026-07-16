---
phase: 129-provider-synchronization-integrity
plan: 02
subsystem: calendar
tags: [google-calendar, bookings, supabase-migration, typescript, vitest, tdd]

# Dependency graph
requires:
  - phase: 129-provider-synchronization-integrity
    provides: fetchBusyTimes multi-calendar conflict detection (129-01) — orthogonal, no file overlap beyond shared context
provides:
  - "bookings.google_event_id nullable TEXT column (migration 1254, not yet applied to production — see Plan 129-06)"
  - "createBooking and createBookingInternal both persist createCalendarEvent's returned event id onto the new booking row, non-fatally"
affects: [130-calendar-ui-coherence, future-cancel-reschedule-google-propagation (CAL-F02)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Follow-up .update() keyed on the newly inserted row's id, guarded by an `if (returnedValue)` check, kept inside the same non-fatal try/catch as the original fire-and-forget external call — no new failure mode introduced"

key-files:
  created:
    - supabase/migrations/1254_bookings_google_event_id.sql
  modified:
    - src/types/database.ts
    - src/app/(dashboard)/calendar/_actions/bookings.ts
    - tests/calendar-bookings.test.ts

key-decisions:
  - "Used migration number 1254 (not the plan's placeholder <next>) since migration 1253_google_calendar_provider_enum.sql (Phase 129-03's deviation fix) was already the latest on this branch"
  - "Stored the event id in a dedicated google_event_id column rather than reusing location_data (clobbered by the unrelated google_meet flow) or external_source/external_id (which mean the opposite data-flow direction — externally-originated mirror rows, not natively-created rows pushed outward)"

requirements-completed: [SYNC-01]

# Metrics
duration: 9min
completed: 2026-07-16
---

# Phase 129 Plan 02: Persist Google Calendar Event Id on Native Bookings Summary

**`bookings.google_event_id` (migration 1254, nullable TEXT) now durably stores the Google Calendar event id returned by `createCalendarEvent` at both native booking-creation call sites (`createBooking`, `createBookingInternal`), closing SYNC-01 Gap 2's storage foundation for future cancel/reschedule propagation.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-07-16T06:23:40Z
- **Completed:** 2026-07-16T06:32:12Z
- **Tasks:** 2 completed
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- New migration `1254_bookings_google_event_id.sql` adds a nullable `bookings.google_event_id TEXT` column with a documented column comment explaining scope (no backfill, foundation-only)
- `database.ts`'s `bookings` `Row`/`Insert`/`Update` types all include `google_event_id: string | null`
- Both `createBooking` and `createBookingInternal` now capture `createCalendarEvent`'s return value and, when truthy, issue a follow-up `.update({ google_event_id })` on the just-created booking row — a null/failed sync leaves the column untouched and the booking still succeeds (the write is strictly non-fatal, wrapped in the same existing try/catch)
- 2 new regression tests (`tests/calendar-bookings.test.ts` Test 12/13) prove the persisted-id path and the null-skip path independently

## Task Commits

Each task was committed atomically (Task 2 followed full TDD RED-GREEN; no REFACTOR commit needed — GREEN matched the plan's specified shape exactly):

1. **Task 1: migration + database.ts types** - `b95214f4` (feat)
2. **Task 2 RED: failing test for google_event_id persistence** - `435f86d8` (test)
3. **Task 2 GREEN: persist Google event id at both call sites** - `e614300b` (feat)

**Plan metadata:** commit pending (this SUMMARY + STATE/ROADMAP update)

## Files Created/Modified
- `supabase/migrations/1254_bookings_google_event_id.sql` - new: nullable `google_event_id TEXT` column + column comment, idempotent `ADD COLUMN IF NOT EXISTS`
- `src/types/database.ts` - `bookings` Row/Insert/Update gain `google_event_id: string | null`
- `src/app/(dashboard)/calendar/_actions/bookings.ts` - `createBooking` and `createBookingInternal` capture `createCalendarEvent`'s return value and conditionally persist it via `.update()`
- `tests/calendar-bookings.test.ts` - 2 new tests (12, 13) in the existing `describe('createBooking', ...)` block asserting the update-on-truthy-id and no-update-on-null behaviors

## Decisions Made
- Migration numbered 1254 (plan's literal `<next>` placeholder resolved against the actual worktree state — 1253 was already consumed by 129-03's `google_calendar_provider_enum` deviation fix)
- Column deliberately not reused from `location_data`/`external_source`/`external_id` per the plan's explicit rationale (see key-decisions above) — followed as specified, no deviation

## Deviations from Plan

None - plan executed exactly as written. The plan's `<interfaces>` block's line-number references for `createBooking`/`createBookingInternal` had already shifted (as the plan itself anticipated, flagging Phase 127-03's prior edits to the same file); both functions were located by searching for `createCalendarEvent` as instructed, and the surrounding code matched the plan's quoted "current" shape exactly, so no adaptation was needed beyond applying the specified diff verbatim.

## Issues Encountered
None. `npx tsc --noEmit` and `npm run build` both pass with no errors attributable to these changes (pre-existing unrelated errors in `tests/workflows/*.test.ts` remain, confirmed out of scope per 129-01's precedent). `npx vitest run tests/calendar-bookings.test.ts` is green at 14/14 (12 pre-existing + 2 new).

## User Setup Required

None - no external service configuration required. The migration file exists in the worktree but is intentionally NOT applied to production here; that happens in Plan 129-06's operator checkpoint alongside any other pending migrations from this phase.

## Next Phase Readiness
- SYNC-01 Gap 2 (Google event id discarded) is closed at the storage layer. The propagation logic that would consume this column (cancel/reschedule → Google) is CAL-F02, explicitly out of scope here and not yet built.
- No blockers for continuing Phase 129 with its remaining plan(s) (129-06 applies migrations 1251-1254 to production).

---
*Phase: 129-provider-synchronization-integrity*
*Completed: 2026-07-16*

## Self-Check: PASSED

All key files verified present on disk (`supabase/migrations/1254_bookings_google_event_id.sql`, `tests/calendar-bookings.test.ts`, `src/app/(dashboard)/calendar/_actions/bookings.ts`, this SUMMARY.md). All 3 task commit hashes (`b95214f4`, `435f86d8`, `e614300b`) confirmed present in `git log`.

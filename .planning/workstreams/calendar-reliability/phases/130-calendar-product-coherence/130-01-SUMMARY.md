---
phase: 130-calendar-product-coherence
plan: 01
subsystem: calendar
tags: [supabase, bounded-queries, react-server-actions, next.js]

# Dependency graph
requires:
  - phase: 127-canonical-booking-lifecycle
    provides: "'showed' as a real, actively-set booking status + canonical BookingStatus vocabulary in src/lib/calendar/booking-status.ts"
  - phase: 129-provider-synchronization-integrity
    provides: "google_event_id persistence + lifecycle wiring already present in bookings.ts before this plan's edits"
provides:
  - "getBookingsForList() — 3 independently-bounded (.limit(50)) queries replacing the unbounded getBookings() table scan"
  - "getBookingsForRange({from,to}) — date-bounded read model for the calendar week/month view"
  - "bookingStatusBadgeClass() — pure display-layer status-to-class mapping covering all 4 DB statuses including 'showed'"
  - "Client-side refetch-on-navigate wiring in calendar-view.tsx (bookingsState + refetchRange)"
affects: [calendar-product-coherence, calendar-reliability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "3-way status-bucketed .limit() queries (Promise.all) as the bounded-list idiom for the flat bookings view, instead of offset pagination"
    - "Client Component refetch-on-navigate: a single refetchRange() useCallback fetches both external (Google Calendar) and internal (bookings) data in parallel on cursor/view change, replacing router.refresh() with local state updates"

key-files:
  created:
    - tests/calendar-bookings-list.test.ts
    - tests/calendar-bookings-page.test.ts
  modified:
    - src/app/(dashboard)/calendar/_actions/bookings.ts
    - src/app/(dashboard)/calendar/bookings/page.tsx
    - src/lib/calendar/booking-status.ts
    - src/app/(dashboard)/calendar/calendar/page.tsx
    - src/components/calendar/calendar-view.tsx

key-decisions:
  - "Added bookingStatusBadgeClass() to the EXISTING src/lib/calendar/booking-status.ts (Phase 127's canonical BookingStatus/BOOKING_STATUSES/isBookingStatus module, imported by 6 other files) instead of overwriting it with a second, competing status-type declaration as the plan's literal code block specified"
  - "getBookingsForList uses a 3-way status-bucketed .limit(50) shape (not offset pagination) — matches the plan/research's explicit reasoning that this fits the list's upcoming/past/cancelled UX better than a single paginated feed"

patterns-established:
  - "Pure display-layer status→class/label mapping functions belong next to the canonical status vocabulary module, not re-declared per-consumer"

requirements-completed: [SYNC-03]

# Metrics
duration: 15min
completed: 2026-07-16
---

# Phase 130 Plan 01: Bounded Calendar Read Models + Showed-Status Visibility Summary

**Replaced the single unbounded `getBookings()` table scan with two purpose-built bounded read models (`getBookingsForList` / `getBookingsForRange`), fixed `'showed'` bookings vanishing from the dashboard list, and wired the calendar week/month view to re-fetch its own visible date range on navigation instead of loading full org history once at page load.**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-07-16T06:47:00Z (approx, per STATE.md phase-start marker)
- **Completed:** 2026-07-16T06:54:25Z
- **Tasks:** 3
- **Files modified:** 5 (2 new test files, 5 modified source files)

## Accomplishments
- `getBookings()` (unbounded `select('*')` with no `.limit()`/`.range()` ever applied) is gone entirely — replaced by `getBookingsForList()` (3 independently `.limit(50)`-bounded queries for upcoming/past/cancelled) and `getBookingsForRange({from,to})` (date-bounded, no unbounded mode possible)
- `/calendar/bookings` now renders from `getBookingsForList()`'s server-bucketed sections; a `status='showed'` booking renders in the Past section with a distinct sky-colored badge instead of disappearing from every bucket
- `/calendar/calendar` (week/month view) bounds its initial server load to the visible week and now re-fetches bookings (not just Google Calendar external events) on every cursor/view change via a single `refetchRange()` callback
- Cancelling a booking or creating one from the calendar grid now updates local `bookingsState` immediately via `refetchRange()` instead of a full `router.refresh()` page reload

## Task Commits

Each task was committed atomically:

1. **Task 1: Replace getBookings() with two bounded read models** - `f3401155` (feat)
2. **Task 2: Wire the flat bookings list to getBookingsForList + fix the showed-vanishes display bug** - `678e4454` (feat)
3. **Task 3: Bound the calendar view's initial load and re-fetch bookings on navigation** - `ae02b46f` (feat)

**Plan metadata:** (this commit)

## Files Created/Modified
- `src/app/(dashboard)/calendar/_actions/bookings.ts` - `getBookings()` deleted; `getBookingsForList()` (3-way bounded status-bucketed queries) and `getBookingsForRange({from,to})` (date-bounded) added
- `src/app/(dashboard)/calendar/bookings/page.tsx` - renders from `getBookingsForList()`'s pre-bucketed sections; uses `bookingStatusBadgeClass()` for all 4 DB statuses
- `src/lib/calendar/booking-status.ts` - added `bookingStatusBadgeClass()` reusing the existing canonical `BookingStatus` union (not a second type)
- `src/app/(dashboard)/calendar/calendar/page.tsx` - calls `getBookingsForRange({from: weekStart, to: weekEnd})` instead of unbounded `getBookings()`
- `src/components/calendar/calendar-view.tsx` - added `bookingsState` + `refetchRange()` (fetches Google Calendar events + `getBookingsForRange` in parallel on cursor/view change); `handleCancel()` and `NewBookingDialog.onCreated` now call `refetchRange()` instead of `router.refresh()`; removed the now-dead `useRouter` import/declaration
- `tests/calendar-bookings-list.test.ts` (new) - 4 tests: bounded `.limit(50)` on all 3 sections, `'showed'` included in the past-section filter, bucketed results returned correctly, `getBookingsForRange` applies `.gte`/`.lte` bounds
- `tests/calendar-bookings-page.test.ts` (new) - 2 tests: distinct badge class per DB status, unrecognized-status fallback never throws

## Decisions Made
- **Reused the existing `booking-status.ts` module instead of overwriting it.** The plan's literal Task 2 code block was written as a standalone "create this file" action producing a `DisplayBookingStatus` union — but `src/lib/calendar/booking-status.ts` already existed (established in Phase 127) with `BookingStatus`/`BOOKING_STATUSES`/`isBookingStatus`, imported by 6 other files (`transition.ts`, `flows/engine.ts`, `mcp/tools/bookings.ts`, `update-booking-status.ts`, `xkedule/webhook/route.ts`, and `bookings.ts` itself). The plan's own embedded comment anticipated exactly this ("check for one before adding a second, possibly-drifting status type"). Applied Rule 1/3 (blocking issue — the literal action would have broken 6 importers): added `bookingStatusBadgeClass()` to the existing file, reusing its canonical `BookingStatus` type instead of declaring a parallel `DisplayBookingStatus` union.
- Kept the 3-way status-bucketed `.limit(50)` shape for `getBookingsForList` (not offset/cursor pagination) — matches the plan and research's explicit call that this fits the upcoming/past/cancelled UX better than a single paginated feed, and mirrors the codebase's existing `.limit()` idiom (`contacts/actions.ts`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1/3 - Blocking/Bug] Preserved the existing booking-status.ts module instead of overwriting it**
- **Found during:** Task 2 (Wire the flat bookings list to getBookingsForList + fix the showed-vanishes display bug)
- **Issue:** The plan's literal action block for Task 2 specified creating `src/lib/calendar/booking-status.ts` from scratch with a new `DisplayBookingStatus` type and `BADGE_CLASSES` map. That file already existed (Phase 127) exporting `BookingStatus`, `BOOKING_STATUSES`, and `isBookingStatus`, actively imported by 6 files across the codebase (`src/lib/calendar/transition.ts`, `src/lib/flows/engine.ts`, `src/lib/mcp/tools/bookings.ts`, `src/lib/action-engine/executors/update-booking-status.ts`, `src/app/api/xkedule/webhook/route.ts`, and `bookings.ts` itself via `BOOKING_STATUSES`). Overwriting the file per the plan's literal text would have deleted those exports and broken the build.
- **Fix:** Added `bookingStatusBadgeClass()` as a new export appended to the existing file, using the existing `BookingStatus` type (via `isBookingStatus()` for the fallback check) instead of introducing a second, parallel status type.
- **Files modified:** src/lib/calendar/booking-status.ts
- **Verification:** `npm run build` succeeds with no type errors across all 6 importing files; `npx vitest run tests/calendar-bookings-page.test.ts` passes (2/2), confirming identical badge-class behavior to what the plan specified.
- **Committed in:** 678e4454 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking/bug — file-overwrite collision)
**Impact on plan:** Necessary correctness fix; the plan's own embedded guidance flagged this exact scenario. No scope creep — the resulting public API (`bookingStatusBadgeClass('showed')` etc.) is functionally identical to what the plan specified, just merged into the pre-existing canonical module instead of replacing it.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- SYNC-03's read-model scope for this plan (unbounded query + showed-vanishes) is fully closed: `getBookings()` no longer exists anywhere in the repo (only 2 explanatory comments referencing the old name remain, both in `bookings.ts`), `npm run build` is green, and all 20 tests across the 3 verification files pass.
- Ready for `130-02-PLAN.md` (per the phase's remaining plans covering the other SYNC-03 findings — wrong `event_types` join in `contacts/actions.ts`, organizer-null bug in `scope.ts` — and SYNC-04's round-robin/structured-location decisions per RESEARCH.md).
- No blockers carried forward.

---
*Phase: 130-calendar-product-coherence*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 8 key files confirmed present on disk; all 3 task commits (f3401155, 678e4454, ae02b46f) confirmed present in git log.

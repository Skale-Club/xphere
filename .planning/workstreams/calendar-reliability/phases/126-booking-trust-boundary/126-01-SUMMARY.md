---
phase: 126-booking-trust-boundary
plan: 01
subsystem: calendar
tags: [supabase, server-actions, availability, booking-validation, vitest]

# Dependency graph
requires: []
provides:
  - "src/lib/calendar/booking-validation.ts::resolveAndValidateSlot — shared active-check + server-derived end_at + multi-window/grid-aligned availability + organizer-wide cross-event-type conflict + Google Calendar busy-time validation"
  - "createBooking (public server action) now server-authoritative against real availability + organizer-wide conflicts, not just a single-event-type pre-check"
affects: [126-02-mcp-bookings-tool, calendar-reliability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared 'resolve + validate slot' core importable by any booking-creation entry point (public server action now, MCP tool in 126-02)"
    - "user_availability queried as an array (never .maybeSingle()) to support multiple windows per weekday (migration 1140)"

key-files:
  created:
    - src/lib/calendar/booking-validation.ts
    - tests/booking-validation.test.ts
  modified:
    - "src/app/(dashboard)/calendar/_actions/bookings.ts"
    - src/components/calendar/booking-form.tsx
    - tests/calendar-bookings.test.ts

key-decisions:
  - "resolveAndValidateSlot mirrors slots.ts::generateSlots's minAdvanceCutoff (60 min) and stepMinutes grid logic exactly, so a requested booking can never be accepted that generateSlots would never have offered as a displayed slot"
  - "Conflict check is organizer-wide (all of the host's event_type_ids), not scoped to the single event_type_id being booked — closes the actual CAL-01 gap createBooking had"
  - "createBookingInternal (operator drag-to-create) intentionally does NOT call the new helper — it allows duration overrides and bypasses booker-facing availability by design, unchanged in this plan"
  - "Deferred (explicit, per RESEARCH.md Pitfall 5): getAvailableSlots/getDebugSlots still use .maybeSingle() on user_availability and will throw for orgs with two windows on the same day — out of scope for this plan, which only touches the write-validation path"

requirements-completed: [CAL-01]

# Metrics
duration: 15min
completed: 2026-07-16
---

# Phase 126 Plan 01: Booking Trust Boundary — Shared Slot Validation Summary

**New `resolveAndValidateSlot` helper makes the public `createBooking` server action server-authoritative against real availability windows and organizer-wide conflicts, closing the cross-event-type double-booking and missing-availability-check gaps CAL-01 targets.**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-16T00:32:53Z
- **Completed:** 2026-07-16T00:47:59Z
- **Tasks:** 2
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- `src/lib/calendar/booking-validation.ts` — new shared core validating: event type active, server-derived `end_at` (never trusts client), requested interval inside a configured `user_availability` window (checking ALL windows per weekday, not `.maybeSingle()`), 60-minute minimum advance notice, duration-grid alignment matching `generateSlots`, organizer-wide conflict-freeness across every event type (not just the one being booked), and Google Calendar busy-time overlap (fails open on API error)
- `createBooking` now delegates to this helper instead of its old inline logic, which only checked conflicts scoped to a single `event_type_id` and never validated availability windows, advance notice, or grid alignment at all
- `booking-form.tsx` surfaces a friendlier toast for the new `outside_availability` error code
- 11 new unit tests for the helper (100% behavior coverage per plan spec) + 1 new regression test on `createBooking`'s wiring

## Task Commits

Each task was committed atomically:

1. **Task 1: Create the shared resolveAndValidateSlot helper + its unit tests** - `fca1936d` (feat)
2. **Task 2: Wire createBooking to resolveAndValidateSlot + add a friendlier client-side error message** - `3d8e3305` (feat)

**Plan metadata:** _(pending — recorded after this SUMMARY commit)_

## Files Created/Modified
- `src/lib/calendar/booking-validation.ts` - New shared "resolve + validate slot" core (`resolveAndValidateSlot`)
- `tests/booking-validation.test.ts` - 11 unit tests covering every behavior branch
- `src/app/(dashboard)/calendar/_actions/bookings.ts` - `createBooking` now calls `resolveAndValidateSlot` instead of its old inline event-type/conflict logic
- `src/components/calendar/booking-form.tsx` - New `outside_availability` toast branch
- `tests/calendar-bookings.test.ts` - Mocks `resolveAndValidateSlot` + `@/lib/contacts/server`; Tests 1-3 updated, new Test 3b added

## Decisions Made
- Grid-alignment and minimum-advance-notice checks were folded into the new helper (not just conflict-freeness) because CAL-01's own wording ("its time is valid and available") requires it, and RESEARCH.md Pattern 1 explicitly scoped the helper to reuse `generateSlots`'s semantics, not just its conflict pre-check.
- The multi-window `.maybeSingle()` bug in `getAvailableSlots`/`getDebugSlots` (RESEARCH.md Pitfall 5) was deliberately NOT folded into this plan — it affects the *display* path (which slots a booker sees), not the *write* path this plan hardens. The new helper's own window query is already array-based and unaffected.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Added missing test mock for `@/lib/contacts/server`'s `resolveLiveContactId`**
- **Found during:** Task 2 (running `tests/calendar-bookings.test.ts` after wiring `createBooking`)
- **Issue:** `createBooking` unconditionally calls `resolveLiveContactId(linkedContactId)` on any linked contact. That function calls `createClient()` from `@/lib/supabase/server`, which this test file mocks as a bare `vi.fn()` with no implementation (returns `undefined`). Confirmed via `git stash` that this was a pre-existing failure on the baseline commit (Test 1 and Test 3 already threw `Cannot read properties of undefined (reading 'from')` before any Task 2 edits) — unrelated to this plan's wiring change, but blocking this task's own required verification (`npx vitest run tests/calendar-bookings.test.ts` must exit 0).
- **Fix:** Added `vi.mock('@/lib/contacts/server', () => ({ resolveLiveContactId: vi.fn(async (id) => id) }))`, a pass-through matching the function's documented default behavior (no merge found → return input unchanged).
- **Files modified:** `tests/calendar-bookings.test.ts`
- **Verification:** `npx vitest run tests/calendar-bookings.test.ts tests/booking-validation.test.ts` — all 18 tests pass; `npm run build` exits 0.
- **Committed in:** `3d8e3305` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Test-only fix, no production code touched. Necessary to unblock this plan's own required verification gate; the underlying `resolveLiveContactId` call itself was pre-existing and untouched by this plan.

## Issues Encountered
None beyond the deviation documented above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- `resolveAndValidateSlot` is ready for Plan 126-02 to reuse for the MCP `bookings_create` tool (the other "public or programmatic" booking-creation entry point CAL-01 names), per RESEARCH.md's stated plan.
- No blockers for the remaining phase 126 plans (CAL-02 DB exclusion constraint, CAL-03 cancellation POST fix, CAL-04 RLS tightening).

---
*Phase: 126-booking-trust-boundary*
*Completed: 2026-07-16*

## Self-Check: PASSED

All claimed files exist on disk and both task commit hashes (`fca1936d`, `3d8e3305`) resolve in `git log`.

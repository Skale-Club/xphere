---
phase: 127-canonical-booking-lifecycle
plan: 03
subsystem: calendar
tags: [supabase, vitest, booking-lifecycle, server-actions]

requires:
  - phase: 127-canonical-booking-lifecycle
    provides: "transition.ts::cancelBooking (RPC-backed, org-scoped, idempotent) + booking-status.ts's BOOKING_STATUSES vocabulary (Plan 127-01)"
provides:
  - "src/app/(dashboard)/calendar/_actions/bookings.ts's cancelBooking (dashboard) and cancelBookingByToken both delegate the guarded status write + single event emission to transition.ts::cancelBooking"
  - "createBooking/createBookingInternal write BOOKING_STATUSES[0] instead of a bare 'confirmed' string literal"
affects: [127-04, 127-05, 127-06, 127-07, 127-08]

tech-stack:
  added: []
  patterns:
    - "Native writer delegation pattern: a server action keeps its own auth/org-resolution and side effects (email, revalidatePath) but hands the actual guarded status write + event emission to the canonical transition.ts service"
    - "Public token-verified mutation: token match happens in a read-only SELECT strictly before any call into the canonical transition service, so an invalid token or already-terminal booking never reaches the mutation path at all"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/calendar/_actions/bookings.ts
    - tests/calendar-bookings.test.ts

key-decisions:
  - "Kept the two @/lib/calendar/transition imports as separate import statements (one for emitCalendarEvent, one aliased for cancelBooking) rather than merging them onto one line, matching the plan's literal action text and keeping the acceptance-criteria grep for the original emitCalendarEvent import intact"
  - "Reworded the BOOKING_STATUSES[0] explanatory comment to reference 'the shared status vocabulary' in prose rather than embedding the literal token BOOKING_STATUSES[0] a second time, since the plan's own acceptance criteria (grep -c returns 2) only expected the code usages, not comment mentions — same self-tripping-scanner pattern documented in Plan 127-01's SUMMARY"

requirements-completed: [LIFE-01, LIFE-03]

duration: 20min
completed: 2026-07-16
---

# Phase 127 Plan 03: Wire Native Cancellation Paths to the Canonical Lifecycle Service Summary

**Both native `bookings.ts` cancellation entry points (dashboard button, public cancel-token link) now delegate their guarded status write + single event emission to `transition.ts::cancelBooking`, and both INSERT-time writers source their `'confirmed'` literal from the shared `BOOKING_STATUSES` vocabulary.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-16T03:01:00Z (approx)
- **Completed:** 2026-07-16T03:21:13Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Dashboard `cancelBooking(id)` now resolves `org_id` via `get_current_org_id()` and calls `transition.ts::cancelBooking({ supabase: svc, depth: 0 }, id, orgId)`, replacing the old unguarded inline `.update()` + separate `emitCalendarEvent` block. Closes the double-fire bug: a double-click or a race with another cancel path now hits the canonical service's idempotent no-op guard instead of always emitting a second `meeting.cancelled` event.
- `cancelBookingByToken` keeps its exact security property — the `cancel_token` match still happens in a read-only `SELECT ... WHERE status = 'confirmed'` strictly before any mutation is attempted — but now delegates the actual guarded write + emission to the same canonical service. Any `transition.ts::cancelBooking` failure (including a race where the booking transitioned to `no_show` between the lookup and the call) maps to the existing public-facing `not_found_or_already_cancelled` error, never leaking internal transition-error detail to an unauthenticated caller.
- `createBooking` and `createBookingInternal` both insert `BOOKING_STATUSES[0]` instead of the bare string `'confirmed'`, sourcing the literal from the single shared vocabulary (Plan 127-01) — no behavior change, insert-time `emitCalendarEvent('meeting.scheduled', ...)` logic is untouched (explicitly out of scope per the plan's objective).
- 8 new tests added to `tests/calendar-bookings.test.ts`: 4 for dashboard `cancelBooking` (success, illegal_transition, idempotent no-op, unauthenticated) and 4 for `cancelBookingByToken`'s new SELECT-then-delegate flow (success, invalid token, already cancelled, race-condition error mapping) — bringing the file to 12 passing tests total.

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire dashboard cancelBooking + cancelBookingByToken to the canonical transition.ts::cancelBooking** - `65164261` (feat)
2. **Task 2: createBooking/createBookingInternal use the shared BOOKING_STATUSES vocabulary + final verification** - `abd29405` (feat)

**Plan metadata:** (pending — this commit)

## Files Created/Modified

- `src/app/(dashboard)/calendar/_actions/bookings.ts` - `cancelBooking` and `cancelBookingByToken` both delegate to `transition.ts::cancelBooking`; `createBooking`/`createBookingInternal` insert `BOOKING_STATUSES[0]`
- `tests/calendar-bookings.test.ts` - added dashboard `cancelBooking` describe block (Tests 8-11), updated `cancelBookingByToken` describe block for the SELECT-then-delegate flow (Tests 4-7), mocked `@/lib/calendar/transition`

## Decisions Made

- Kept the two `@/lib/calendar/transition` imports as two separate `import` statements rather than merging them onto one line — matches the plan's literal Task 1 action text and preserves Task 2's acceptance-criteria grep for the original standalone `emitCalendarEvent` import
- Reworded the `BOOKING_STATUSES[0]` explanatory comment to describe the array-index convention in prose instead of re-embedding the literal token, avoiding a self-inflicted grep-count mismatch against the plan's own acceptance criteria (same category of issue Plan 127-01 hit with its status-vocabulary scanner)
- Added a dedicated `bookingsTokenLookup` fixture field to the test file's `buildFakeAdmin` helper (falling back to the pre-existing `bookingsConflict` field when unset) rather than repurposing `bookingsConflict` directly for `cancelBookingByToken`'s new SELECT, keeping the two use cases distinguishable in future test edits

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Test file needed `emitCalendarEvent` mocked alongside `cancelBooking` in the `@/lib/calendar/transition` module mock**
- **Found during:** Task 1 (first test run after adding `vi.mock('@/lib/calendar/transition', () => ({ cancelBooking: vi.fn() }))`)
- **Issue:** Mocking the module with only `cancelBooking` exported broke `createBooking`'s existing (pre-Task-1) call to `emitCalendarEvent` from the same module — Vitest throws "No emitCalendarEvent export is defined on the mock" since the mock factory fully replaces the module rather than partially mocking it.
- **Fix:** Added `emitCalendarEvent: vi.fn(async () => ({ dispatched: 0, dispatch_id: null }))` to the same mock factory.
- **Files modified:** `tests/calendar-bookings.test.ts`
- **Verification:** `npx vitest run tests/calendar-bookings.test.ts` — all 12 tests pass
- **Committed in:** `65164261` (Task 1 commit)

**2. [Rule 1 - Bug] Acceptance-criteria grep mismatch caused by merging the two transition.ts imports onto one line**
- **Found during:** Task 2 (running Task 2's literal acceptance-criteria grep for the original `import { emitCalendarEvent } from '@/lib/calendar/transition'` line)
- **Issue:** In Task 1 I merged the new aliased `cancelBooking as transitionCancelBooking` import onto the same line as the pre-existing `emitCalendarEvent` import for brevity. Task 2's acceptance criteria checks for the literal, unmodified original import line, which no longer existed once merged. The plan's Task 1 action text also literally specifies the aliased import as its own standalone `import` statement, not a merge.
- **Fix:** Split back into two separate `import { ... } from '@/lib/calendar/transition'` statements, matching the plan's literal text exactly.
- **Files modified:** `src/app/(dashboard)/calendar/_actions/bookings.ts`
- **Verification:** `grep -q "import { emitCalendarEvent } from '@/lib/calendar/transition'"` now matches; `npx vitest run tests/calendar-bookings.test.ts` and `npm run build` both pass
- **Committed in:** `abd29405` (Task 2 commit)

**3. [Rule 1 - Bug] `BOOKING_STATUSES[0]` explanatory comment doubled the acceptance-criteria grep count**
- **Found during:** Task 2 (running the acceptance criterion `grep -c "BOOKING_STATUSES\[0\]"` which expects exactly 2)
- **Issue:** The plan's action text asks for a one-line comment above each `status: BOOKING_STATUSES[0],` that itself quotes the literal token `BOOKING_STATUSES[0]`. Since the acceptance criterion counts ALL occurrences of that literal string in the file (comments included), adding the comment as written doubled the count from 2 to 4, failing the plan's own stated acceptance criterion.
- **Fix:** Reworded both comments to explain the same array-index convention in prose ("The first entry in the shared status vocabulary (booking-status.ts) is 'confirmed' — ...") without re-embedding the literal `BOOKING_STATUSES[0]` token.
- **Files modified:** `src/app/(dashboard)/calendar/_actions/bookings.ts`
- **Verification:** `grep -c "BOOKING_STATUSES\[0\]"` now returns 2; `npx vitest run tests/calendar-bookings.test.ts` and `npm run build` both pass
- **Committed in:** `abd29405` (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 blocking test-mock gap, 2 acceptance-criteria/plan-text self-consistency bugs)
**Impact on plan:** All three fixes were necessary to satisfy the plan's own stated verification steps exactly as written. No scope creep — no behavior outside the plan's stated objective was touched.

## Issues Encountered

None beyond the three auto-fixed deviations above.

## User Setup Required

None - no external service configuration required. Migration 1251 (from Plan 127-01) remains intentionally unapplied to production, unaffected by this plan.

## Known Stubs

None. Both native cancellation entry points are fully wired to the canonical transition service with real behavior (no placeholder data, no hardcoded empty states).

## Next Phase Readiness

- Both native `bookings.ts` writers (dashboard cancel, public cancel-token link) are fully on the canonical, idempotent, org-scoped transition path — the double-fire bug from Pitfall 6 is closed for these two paths
- `tests/calendar-bookings.test.ts` is green (12/12) and `npm run build` passes
- Plans 127-04 through 127-07 (MCP, workflow actions, Xkedule inbound, and any remaining writer categories) can proceed against the same canonical `transition.ts` service established in Plan 127-01 and now exercised end-to-end by this plan's native-writer wiring
- Migration 1251 (`transition_booking_status` RPC) is still unapplied to production — Plan 127-08's operator-gated apply step remains the blocker for any of these RPC-backed calls to actually succeed against the live database; this is expected and does not block further planning/execution of Wave 2 plans
- No blockers

---
*Phase: 127-canonical-booking-lifecycle*
*Completed: 2026-07-16*

## Self-Check: PASSED

Both key-files confirmed present on disk (`src/app/(dashboard)/calendar/_actions/bookings.ts`, `tests/calendar-bookings.test.ts`). Both task commits confirmed present in git history (`65164261`, `abd29405`).

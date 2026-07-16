---
phase: 129-provider-synchronization-integrity
plan: 04
subsystem: calendar
tags: [xkedule, webhook, vitest, booking-lifecycle, calendar-events, tenant-safety]

requires:
  - phase: 127-canonical-booking-lifecycle
    provides: "confirmBooking/cancelBooking/markNoShow/markShowed lifecycle service (127-01) + the mapStatus completed→showed and update-error-guard fixes to this same route (127-05)"
provides:
  - "src/app/api/xkedule/webhook/route.ts::KNOWN_XKEDULE_STATUSES — exhaustive guard rejecting any raw Xkedule status outside the 6 documented values before any DB access beyond auth/parse"
  - "src/app/api/xkedule/webhook/route.ts::runXkeduleTransition — dispatches an existing mirrored booking's mapped status to confirmBooking/cancelBooking/markNoShow/markShowed instead of a raw bookings.status write"
  - "tests/xkedule-webhook.test.ts extended with 2 new describe blocks (existing-row lifecycle-routing coverage, unknown-status guard coverage) — 27 total tests, up from 17"
affects: []

tech-stack:
  added: []
  patterns:
    - "Route-level dispatch switch over the shared BookingStatus union, delegating to the Phase 127 lifecycle service by mapped status — mirrors how flows/engine.ts's booking_* action nodes already call the same functions (127-06/127-07)"

key-files:
  created: []
  modified:
    - src/app/api/xkedule/webhook/route.ts
    - tests/xkedule-webhook.test.ts

key-decisions:
  - "Placed the KNOWN_XKEDULE_STATUSES guard immediately after computing `b = payload.booking`, before the idempotency/existing-row lookup and before mapStatus is called — an unrecognized status never triggers any bookings table access"
  - "Kept the insert (brand-new-booking) path unchanged — direct insert with the mapped status + direct emitCalendarEvent, mirroring 127-05's already-correct behavior — only the existing-row branch now routes through the lifecycle service"
  - "Fixed 127-05's own now-obsolete test (unrecognized status falling back to 'confirmed') since this plan's guard makes that assertion incorrect; the case is now covered by a dedicated unknown-status-guard test instead"

requirements-completed: [SYNC-02]

duration: 20min
completed: 2026-07-16
---

# Phase 129 Plan 04: Xkedule Webhook Unknown-Status Guard + Lifecycle-Routed Status Transitions Summary

**An unrecognized Xkedule booking status is now logged and rejected before any DB write (no more silent coercion to `confirmed`), and every status change on an existing mirrored booking is dispatched through Phase 127's `confirmBooking`/`cancelBooking`/`markNoShow`/`markShowed` service instead of a raw `bookings.status` update.**

## Performance

- **Duration:** 20 min
- **Started:** 2026-07-16T02:00:00-04:00 (approx)
- **Completed:** 2026-07-16T02:10:34-04:00
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added `KNOWN_XKEDULE_STATUSES` (the 6 documented Xkedule statuses) and a guard that rejects any other raw status with `{ skipped: 'unknown_status' }` before the existing-row idempotency lookup, event-type lookup, or any other DB read/write — closing the SYNC-02/D-02 "no silent coercion" gap that survived Phase 127-05 (which fixed `mapStatus`'s `completed`→`showed` mapping but left the unrecognized-value fallback silently absorbing into `confirmed`)
- Added `runXkeduleTransition`, a dispatch switch over the mapped `BookingStatus` that calls `confirmBooking`/`cancelBooking`/`markNoShow`/`markShowed` (Phase 127-01's org-scoped, idempotent, RPC-backed lifecycle service) for an EXISTING mirrored booking's status transition — the raw `bookings.status` write on that path is now gone entirely
- Removed `status` from the shared `mutable` update payload so an existing-row `.update()` call can never write status directly; the insert (brand-new booking) path is untouched and still sets `status` directly plus fires `emitCalendarEvent` (there is no prior status to "transition" from on first sync)
- `tests/xkedule-webhook.test.ts` grew from 17 to 27 tests: 4 new tests proving each mapped status (`completed`/`cancelled`/`no_show`/`pending`) dispatches to its correct lifecycle function and no others; 2 new tests proving the unknown-status guard rejects unrecognized values with zero DB writes/lifecycle calls while all 6 documented statuses still pass through; 3 of 127-05's original existing-row tests re-scoped to assert lifecycle dispatch (not `emitCalendarEvent`) and the absence of `status` in the raw update payload; 1 of 127-05's original `mapStatus` tests corrected to drop the now-invalid "unrecognized status falls back to confirmed" case

## Task Commits

Each task was committed atomically (TDD RED-GREEN):

1. **RED (Tasks 1+2 combined): failing tests for lifecycle-routed transitions + unknown-status guard** - `2041de10` (test)
2. **GREEN (Task 1): unknown-status guard + lifecycle-routed existing-row transitions** - `263a3569` (feat)

**Plan metadata:** (pending — this commit)

_Note on task/commit organization: this plan's Task 1 carries `tdd="true"` and its `<behavior>` explicitly instructs writing Task 2's tests first, confirming they fail against the pre-plan (127-05) implementation, then implementing Task 1's action to make them pass — mirroring 127-05's own precedent of combining test-authoring into one RED commit ahead of the fix. Task 2's full action (extend mocks, re-scope obsolete assertions, add new coverage) was therefore executed and committed as the RED phase before Task 1's GREEN implementation, rather than as a separate third commit after Task 1. Both tasks' acceptance criteria are fully satisfied; no task was skipped._

## Files Created/Modified

- `src/app/api/xkedule/webhook/route.ts` - added `KNOWN_XKEDULE_STATUSES` (module-level guard set) and the early-return guard in `POST`; added `runXkeduleTransition` dispatch helper; merged `confirmBooking`/`cancelBooking`/`markNoShow`/`markShowed` into the existing `@/lib/calendar/transition` import; removed `status` from the shared `mutable` object; existing-row branch now calls `runXkeduleTransition` after a successful non-status update instead of writing status inline; insert branch unchanged
- `tests/xkedule-webhook.test.ts` - extended the `@/lib/calendar/transition` mock with the 4 lifecycle functions; added a new "existing-row status transitions through the lifecycle service" describe block (4 tests) and a new "unknown-status guard" describe block (2 tests, one parametrized over all 6 documented statuses); re-scoped 3 of 127-05's existing-row tests and 1 of its `mapStatus` tests to match the new correct behavior; fixed a TS2493 tuple-index type error on `bookingsUpdateMock.mock.calls[0]` by giving that mock an explicit parameter type

## Decisions Made

- Guard placed as early as possible (right after `const b = payload.booking`, before `mapStatus` is even called) so an unrecognized status touches zero tables beyond `api_keys` (auth)
- Insert path deliberately left untouched — there is no "existing status" to transition from on first sync, so a direct insert + direct `emitCalendarEvent` remains correct, matching how native `createBooking` also inserts+emits directly rather than through a lifecycle transition function
- `runXkeduleTransition`'s switch has no `default` case — it is exhaustive over the 4-member `BookingStatus` union and TypeScript's control-flow analysis confirms every path returns, verified by a clean `tsc --noEmit` on this file

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed 127-05's now-obsolete "unrecognized status falls back to confirmed" test case**
- **Found during:** Task 1 GREEN-phase verification (`npx vitest run tests/xkedule-webhook.test.ts`)
- **Issue:** 127-05's `mapStatus` describe block had a parametrized test asserting `some_unrecognized_value` maps to `confirmed`. This plan's entire purpose is to make that specific behavior incorrect (SYNC-02/D-02) — after the guard, that value is now rejected before `mapStatus` is ever called, so the old assertion fails.
- **Fix:** Removed `some_unrecognized_value` from that test's parametrized list (kept `pending`/`awaiting_approval`/`confirmed`, the 3 documented statuses that legitimately fall back to `confirmed`); the unrecognized-value case is now covered by the new dedicated "unknown-status guard" describe block instead.
- **Files modified:** `tests/xkedule-webhook.test.ts`
- **Verification:** `npx vitest run tests/xkedule-webhook.test.ts` — 27/27 passing
- **Committed in:** `263a3569` (Task 1 GREEN commit)

**2. [Rule 3 - Blocking] Fixed a TS2493 tuple-index type error introduced by this plan's own new assertions**
- **Found during:** `npx tsc --noEmit` after Task 1's GREEN implementation
- **Issue:** New assertions read `bookingsUpdateMock.mock.calls[0]?.[0]` to check the raw update payload no longer carries `status`. `bookingsUpdateMock` was declared as `vi.fn(() => ...)` with no parameter, so TypeScript inferred its call-tuple type as `[]` (zero-length), making `[0]` an out-of-bounds index error.
- **Fix:** Gave `bookingsUpdateMock`'s mock implementation an explicit `(_payload: Record<string, unknown>)` parameter — no behavior change (the implementation still ignores the argument's value), only the inferred call-tuple type changes to `[Record<string, unknown>]`.
- **Files modified:** `tests/xkedule-webhook.test.ts`
- **Verification:** `npx tsc --noEmit` reports zero errors in this file; `npm run build` passes
- **Committed in:** `263a3569` (Task 1 GREEN commit)

---

**Total deviations:** 2 auto-fixed (1 bug — obsolete test assertion this plan's own objective makes incorrect, 1 blocking — type error in new test code)
**Impact on plan:** Both fixes were necessary to reach a correct GREEN state for exactly the behavior this plan specifies. No scope creep — both changes are confined to `tests/xkedule-webhook.test.ts`, one of this plan's two declared `files_modified`.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness

- `npx vitest run tests/xkedule-webhook.test.ts` — 27/27 green
- `npx tsc --noEmit` — zero errors in `src/app/api/xkedule/webhook/route.ts` and `tests/xkedule-webhook.test.ts` (2 unrelated pre-existing errors in `tests/workflows/schema-validate.test.ts` and `tests/workflows/yaml-to-flow.test.ts` predate this plan and are out of scope — logged, not fixed)
- `npm run build` — passes (production build + type check)
- `grep -n "KNOWN_XKEDULE_STATUSES\|runXkeduleTransition" src/app/api/xkedule/webhook/route.ts` confirms both additions are present; `grep -n "status,"` confirms the only remaining occurrence is the insert branch's `{ ...mutable, status, ... }` spread
- SYNC-02's Xkedule half is closed: no silent coercion of unrecognized statuses, no raw `bookings.status` write for an existing mirrored booking's status transition
- No blockers

---
*Phase: 129-provider-synchronization-integrity*
*Completed: 2026-07-16*

## Self-Check: PASSED

Both key-files confirmed present on disk (`src/app/api/xkedule/webhook/route.ts`, `tests/xkedule-webhook.test.ts`). Both task commits confirmed present in git history (`2041de10`, `263a3569`).

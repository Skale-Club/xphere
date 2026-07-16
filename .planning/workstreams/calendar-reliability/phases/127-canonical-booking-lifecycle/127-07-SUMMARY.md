---
phase: 127-canonical-booking-lifecycle
plan: 07
subsystem: workflows
tags: [action-engine, calendar, booking-lifecycle, vitest, wait-free-dispatcher]

requires:
  - phase: 127-canonical-booking-lifecycle
    provides: "src/lib/calendar/transition.ts confirmBooking/cancelBooking/markNoShow/markShowed/rescheduleBooking (Plan 127-01) -- the canonical, RPC-backed, org-scoped, idempotent lifecycle service this plan wires the wait-free action-engine dispatcher into"
provides:
  - "src/lib/action-engine/executors/booking-lifecycle-actions.ts -- the wait-free engine's (execute-action.ts) thin adapter around transition.ts, mirroring flows/engine.ts's booking_* handlers (Plan 127-06) but returning JSON strings instead of Record<string, unknown>"
  - "Five booking_* action types (booking_confirm/booking_cancel/booking_reschedule/booking_mark_no_show/booking_mark_complete) registered in execute-action.ts's dispatcher -- previously threw 'Unknown action type' for any workflow with no wait node (the common case) and every MCP/agent-tool-triggered flow"
  - "update_booking_status now dispatches by target status to the canonical service (guarded, org-scoped, event-emitting) instead of an unguarded .update({status}) that allowed any status to any status"
affects: [127-08]

tech-stack:
  added: []
  patterns:
    - "Wait-free engine action handlers as thin delegators returning JSON strings: fetch/guard/write/emit logic lives once in transition.ts; booking-lifecycle-actions.ts only extracts params, calls the canonical function, and translates {ok,error} into throw-or-JSON-string (execute-action.ts's return convention, distinct from flows/engine.ts's Record<string,unknown> convention)"
    - "Special-cased action-type checks before the switch(actionType) block in execute-action.ts for action types not in the DB action_type enum -- booking_* joins update_contact/contact_add_tag/update_booking_status/send_email_template in this category"

key-files:
  created:
    - src/lib/action-engine/executors/booking-lifecycle-actions.ts
    - tests/action-engine-booking.test.ts
  modified:
    - src/lib/action-engine/execute-action.ts
    - src/lib/action-engine/executors/update-booking-status.ts

key-decisions:
  - "Did not deduplicate booking-lifecycle-actions.ts with flows/engine.ts's inline booking_* handlers (Plan 127-06) -- their return-type conventions differ (JSON string vs Record<string, unknown>), and consolidating the two engines is explicitly out of this phase's 'internal unification, no public contract changes' boundary per RESEARCH's Pattern 3"
  - "Deliberately did not add booking_create/booking_get special cases -- booking_create is INSERT-only with no guard/transition to mirror, booking_get is read-only; neither was named as a broken LIFE-03 writer gap"

requirements-completed: [LIFE-01, LIFE-03]

duration: 13min
completed: 2026-07-16
---

# Phase 127 Plan 07: Wire execute-action.ts booking actions to the canonical lifecycle service Summary

**Five `booking_*` action types (confirm/cancel/reschedule/mark_no_show/mark_complete) newly registered in the wait-free `execute-action.ts` dispatcher via a new thin adapter (`booking-lifecycle-actions.ts`), and `update_booking_status` rewritten to dispatch by target status through the same guarded, event-emitting `transition.ts` service instead of an unguarded any-to-any `.update()`.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-16T04:00:00Z (approx)
- **Completed:** 2026-07-16T04:13:12Z
- **Tasks:** 2
- **Files modified:** 4 (2 created, 2 modified)

## Accomplishments

- `src/lib/action-engine/executors/booking-lifecycle-actions.ts`: new adapter exporting `executeBookingConfirmAction`/`executeBookingCancelAction`/`executeBookingMarkNoShowAction`/`executeBookingMarkCompleteAction`/`executeBookingRescheduleAction`, each validating required params, delegating to the matching `transition.ts` function with the caller's `orgId`, and returning a JSON string on success or throwing a prefixed error on failure
- `execute-action.ts` gained five special-cased `booking_*` action-type checks (mirroring the pre-existing `update_booking_status` pattern), each requiring `ctx.organizationId`/`ctx.supabase` before delegating — closes the LIFE-03 gap where any workflow with no `wait` node (the common case), or any MCP/agent-tool-triggered flow (always wait-free regardless of definition), threw `Unknown action type` for these five action types even though the durable engine (`flows/engine.ts`, Plan 127-06) already supported them
- `executeUpdateBookingStatus` no longer performs a raw `.update({status})` that let any listed status transition to any other listed status with zero current-state guard and zero calendar event emission — it now dispatches by target status to `confirmBooking`/`cancelBooking`/`markNoShow`/`markShowed`, inheriting their guard (illegal transitions now throw), idempotency, org-scoping, and event emission
- `executeUpdateBookingStatus`'s status validation now reuses the shared `BOOKING_STATUSES`/`isBookingStatus` from `src/lib/calendar/booking-status.ts` instead of a locally re-declared, now-removed `VALID_STATUSES` array
- `tests/action-engine-booking.test.ts`: 35 new tests — 17 for the adapter's five functions (missing-param guards, success JSON shape, `orgId` propagation, illegal-transition error translation), 10 for `execute-action.ts`'s dispatcher wiring (delegation + ctx-guard for all five action types), 8 for `executeUpdateBookingStatus`'s new dispatch-by-status behavior and illegal-transition rejection

## Task Commits

Each task was committed atomically (RED test commit shared by both tasks, per the same-file TDD precedent from Plan 127-05):

1. **RED: failing tests for both tasks** - `846de42d` (test)
2. **Task 1: booking-lifecycle-actions.ts + execute-action.ts registration (GREEN)** - `ae56ffbb` (feat)
3. **Task 2: update-booking-status.ts routed through canonical service (GREEN)** - `3ce9bd38` (feat)

**Plan metadata:** (pending — this commit)

## Files Created/Modified

- `src/lib/action-engine/executors/booking-lifecycle-actions.ts` - wait-free engine's thin adapter: `executeBookingConfirmAction`/`executeBookingCancelAction`/`executeBookingMarkNoShowAction`/`executeBookingMarkCompleteAction`/`executeBookingRescheduleAction`
- `src/lib/action-engine/execute-action.ts` - imports the five adapter functions; registers five `booking_*` special-cased checks before the `switch (actionType)` block
- `src/lib/action-engine/executors/update-booking-status.ts` - rewritten to dispatch by target status to `confirmBooking`/`cancelBooking`/`markNoShow`/`markShowed`; drops the local `VALID_STATUSES` array for the shared `BOOKING_STATUSES`/`isBookingStatus`
- `tests/action-engine-booking.test.ts` - 35 tests covering the adapter, the dispatcher wiring, and the fixed `update_booking_status` executor

## Decisions Made

- Kept `booking-lifecycle-actions.ts` and `flows/engine.ts`'s inline `booking_*` handlers (Plan 127-06) as two separate thin adapters rather than merging them, since their return conventions differ (JSON string vs `Record<string, unknown>`) and consolidating the two dispatch engines is out of this phase's stated boundary ("internal unification, no public contract changes")
- Did not register `booking_create`/`booking_get` in `execute-action.ts` — neither is a broken LIFE-03 writer gap; `booking_create` has no guard/transition to mirror and `booking_get` is read-only

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- While running a broader regression sweep (`tests/action-engine-booking.test.ts` + `tests/calendar-status-vocabulary.test.ts` + `tests/action-engine.test.ts` together), 8 pre-existing failures surfaced in `tests/action-engine.test.ts`'s `POST /api/vapi/tools — webhook route` block (unrelated to booking lifecycle — Vapi tools webhook route / GHL-fallback / `after()` mocking). Confirmed pre-existing by reproducing in isolation on the untouched file; no 127-* commit has ever touched `tests/action-engine.test.ts`. Per the deviation rules' scope boundary, this was NOT auto-fixed — logged to `.planning/workstreams/calendar-reliability/phases/127-canonical-booking-lifecycle/deferred-items.md` instead.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness

- Both booking-mutating writer categories targeted by this plan (the wait-free dispatcher's five new `booking_*` action types, and the one pre-existing `update_booking_status` action type) now route through the canonical, org-scoped, guarded `transition.ts` service
- Combined with Plan 127-06 (durable engine), every workflow-triggered booking mutation path — wait or wait-free, native or MCP or agent-tool-triggered — now shares the same guard/idempotency/emission semantics
- `npm run build` passes; `tests/action-engine-booking.test.ts` is fully green (35/35)
- Pre-existing, unrelated `tests/action-engine.test.ts` failures (Vapi tools webhook route) are logged in `deferred-items.md` for a future maintenance pass — not a blocker for Plan 127-08
- No blockers for Plan 127-08

---
*Phase: 127-canonical-booking-lifecycle*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 6 key files confirmed present on disk (`src/lib/action-engine/executors/booking-lifecycle-actions.ts`, `tests/action-engine-booking.test.ts`, `src/lib/action-engine/execute-action.ts`, `src/lib/action-engine/executors/update-booking-status.ts`, `127-07-SUMMARY.md`, `deferred-items.md`). All 3 task commits confirmed present in git history (`846de42d`, `ae56ffbb`, `3ce9bd38`).

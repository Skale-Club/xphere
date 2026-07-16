---
phase: 127-canonical-booking-lifecycle
plan: 06
subsystem: workflows
tags: [flows-engine, calendar, booking-lifecycle, vitest, org-scoping]

requires:
  - phase: 127-canonical-booking-lifecycle
    provides: "src/lib/calendar/transition.ts confirmBooking/cancelBooking/markNoShow/markShowed/rescheduleBooking (Plan 127-01) -- the canonical, RPC-backed, org-scoped, idempotent lifecycle service this plan wires the durable workflow engine into"
provides:
  - "All six executeBooking* action-node handlers in src/lib/flows/engine.ts (confirm/cancel/reschedule/mark_no_show/mark_complete/create) delegate to the canonical transition service or emit their matching calendar event"
  - "The live-crash bug (status: 'completed' as 'confirmed', a DB CHECK violation) is gone -- executeBookingMarkComplete now writes 'showed' via markShowed"
  - "Every booking_* action node is now org-scoped (ctx.orgId passed and verified server-side) -- closes the pre-existing no-org-check gap in workflow-triggered booking mutations"
  - "tests/calendar-status-vocabulary.test.ts now scans src/lib/flows/engine.ts"
affects: [127-07, 127-08]

tech-stack:
  added: []
  patterns:
    - "Workflow action-node handlers as thin delegators: fetch/guard/write/emit logic lives once in transition.ts; flows/engine.ts handlers only extract config, call the canonical function, and translate {ok,error} into throw-or-return"
    - "Test technique for verifying a workflow node's output shape without a dedicated engine hook: re-request the shared mocked supabase chain via supabase.from('workflow_run_steps') and read the recorded .update() call whose output is non-empty (the trigger/end nodes also produce empty-output 'succeeded' updates in the same chain)"

key-files:
  created: []
  modified:
    - src/lib/flows/engine.ts
    - tests/workflows/engine.test.ts
    - tests/calendar-status-vocabulary.test.ts

key-decisions:
  - "Fixed a false-positive in the vocabulary scanner introduced by adding engine.ts to FILES_TO_SCAN: the plain-text regex also matches this file's unrelated workflow_runs/workflow_run_steps status literals ('running'/'succeeded'/'failed'/'waiting'), which are not bookings.status values. Added a narrow, documented NON_BOOKING_STATUS_LITERALS allowlist to the scanner rather than restructuring it or scoping FILES_TO_SCAN differently."
  - "Reworded the executeBookingMarkComplete comment to avoid re-embedding the literal invalid status token as prose (matches the same self-inflicted-scanner-trip precedent documented in 127-01's SUMMARY)."

requirements-completed: [LIFE-01, LIFE-02, LIFE-03]

duration: 14min
completed: 2026-07-16
---

# Phase 127 Plan 06: Wire flows/engine.ts booking actions to the canonical lifecycle service Summary

**All six `executeBooking*` handlers in the durable workflow engine (`src/lib/flows/engine.ts`) now delegate to `src/lib/calendar/transition.ts` or emit `meeting.scheduled`, closing the zero-emission gap, adding org-scoping, and eliminating the live-crashing invalid `'completed'` status write.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-16T03:44:00Z (approx, per session start)
- **Completed:** 2026-07-16T03:58:20Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- `executeBookingConfirm`/`executeBookingCancel`/`executeBookingMarkNoShow`/`executeBookingMarkComplete`/`executeBookingReschedule` no longer contain inline fetch+guard+update logic against the `bookings` table — each now calls the matching `confirmBooking`/`cancelBooking`/`markNoShow`/`markShowed`/`rescheduleBooking` function from `src/lib/calendar/transition.ts`, passing `ctx.orgId` explicitly
- `executeBookingMarkComplete` no longer writes the DB-CHECK-violating literal `status: 'completed' as 'confirmed'` — it now writes `'showed'` via `markShowed`, which also emits `meeting.completed` (the LIFE-02 vocabulary reconciliation from Plan 127-01)
- Every one of the five rewritten handlers now emits its matching calendar event on a real (non-idempotent) transition, where previously none of them emitted anything
- Every one of the five rewritten handlers is now org-scoped: a workflow config referencing another org's `booking_id` gets `booking_not_found` from the canonical service's server-side org re-check, instead of silently mutating a foreign-org booking
- Removed the file's own mismatched local `BookingStatus` type (`'confirmed' | 'cancelled' | 'no_show' | 'pending' | 'completed'` — wrong on two counts) entirely; nothing in the file needs it anymore
- `executeBookingCreate` now emits `meeting.scheduled` after a successful insert (fire-and-forget, caught rejection), matching the resilience convention every other booking-creation writer already uses; its insert's status literal now reads from `BOOKING_STATUSES[0]` instead of a bare `'confirmed'` string
- `tests/workflows/engine.test.ts` gained full `booking_*` action-node coverage (24 new tests): missing-`booking_id` pre-checks, ok:true delegation with `ctx.orgId` assertion and output-shape verification, `illegal_transition`/`booking_not_found` error propagation for all five status-transition handlers, plus `booking_create`'s emission and insert-failure paths
- `tests/calendar-status-vocabulary.test.ts` now scans `src/lib/flows/engine.ts`, closing the loop Plan 127-01 deliberately left open

## Task Commits

Each task was committed atomically:

1. **Task 1: Delegate the five status-transition handlers to the canonical service** - `0671010d` (feat)
2. **Task 2: executeBookingCreate emits meeting.scheduled + final verification** - `f3f6ab1c` (feat)

**Plan metadata:** (pending — this commit)

## Files Created/Modified

- `src/lib/flows/engine.ts` - all six `executeBooking*` action-node handlers rewritten to delegate to `@/lib/calendar/transition`; local `BookingStatus` type removed; `executeBookingCreate` emits `meeting.scheduled`
- `tests/workflows/engine.test.ts` - new `describe('booking_* action nodes', ...)` block: mocked `@/lib/calendar/transition`, 24 new tests across all six action types
- `tests/calendar-status-vocabulary.test.ts` - added `src/lib/flows/engine.ts` to `FILES_TO_SCAN`; added a narrow `NON_BOOKING_STATUS_LITERALS` allowlist to fix a false-positive the naive scanner produced against this file's unrelated `workflow_runs`/`workflow_run_steps` status column

## Decisions Made

- Kept the org-boundary check delegated entirely to the canonical service (no redundant org check added in `engine.ts` itself) — the transition functions already verify `org_id` server-side via the RPC (or, for `rescheduleBooking`, via an explicit equality check), and `engine.ts` passing `ctx.orgId` through is what the acceptance criteria and tests verify
- Fixed the vocabulary scanner's false positive with a minimal, documented literal allowlist rather than restructuring `FILES_TO_SCAN` scanning to be table-aware — keeps the one-line-addition promise from Plan 127-01's comment while closing the real gap the naive regex exposed once a file with two different `status` columns entered the scan set

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed a false-positive in the status-vocabulary scanner once `src/lib/flows/engine.ts` was added to `FILES_TO_SCAN`**
- **Found during:** Task 1 (running `tests/calendar-status-vocabulary.test.ts` after appending `src/lib/flows/engine.ts` to `FILES_TO_SCAN` per the plan's own step 8)
- **Issue:** The scanner's regex (`/status:\s*'([a-z_]+)'/g`) has no table/column awareness. `engine.ts` also writes `status: '...'` literals for two entirely different columns — `workflow_runs.status` and `workflow_run_steps.status` (values `'running'`/`'succeeded'`/`'failed'`/`'waiting'`) — which are not `bookings.status` values and were never meant to be checked against `BOOKING_STATUSES`. Adding the file to the scan set (as the plan explicitly instructs) surfaced 18 false-positive offenders and failed the test the plan's own `<done>` criteria requires to be green.
- **Fix:** Added a narrow, documented `NON_BOOKING_STATUS_LITERALS` allowlist (`['running', 'succeeded', 'failed', 'waiting']`) to `tests/calendar-status-vocabulary.test.ts`, filtered out before the offenders check. None of these four values collide with `BOOKING_STATUSES`, so the guard still catches any genuine `bookings.status` regression in any scanned file.
- **Files modified:** `tests/calendar-status-vocabulary.test.ts`
- **Verification:** `npx vitest run tests/calendar-status-vocabulary.test.ts` — all 3 tests pass, including with `src/lib/flows/engine.ts` in the scan set
- **Committed in:** `0671010d` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug, surfaced by the plan's own new verification step)
**Impact on plan:** Necessary for the plan's own stated Task 1 `<done>` criteria ("tests/calendar-status-vocabulary.test.ts now scans src/lib/flows/engine.ts and is green") to actually hold. No scope creep — fix is scoped to the scanner's false-positive handling only.

## Issues Encountered

- The `lastStepOutput` test helper initially picked up the *trigger* node's own `workflow_run_steps` update call (which always has an empty `output: {}`) instead of the booking action node's — `walkFrom` processes the trigger node itself as the first step before reaching the action node. Fixed within Task 1 by filtering the helper for the first `'succeeded'` update call with a *non-empty* output object, since the trigger and end nodes are the only ones in these test flows that produce empty outputs.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None.

## Next Phase Readiness

- All six booking-mutating action nodes in the durable workflow engine now emit their matching calendar event, are org-scoped, and write only valid DB status values
- The literal live-crashing bug (`status: 'completed'`) is gone from the codebase and from the static vocabulary scanner's blind spot
- `npm run build` passes (full type check across app + test files)
- No blockers for Plan 127-07 or 127-08

---
*Phase: 127-canonical-booking-lifecycle*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 3 key-files confirmed present on disk (`src/lib/flows/engine.ts`, `tests/workflows/engine.test.ts`, `tests/calendar-status-vocabulary.test.ts`), plus `127-06-SUMMARY.md` itself. Both task commits confirmed present in git history (`0671010d`, `f3f6ab1c`).

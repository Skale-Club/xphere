---
phase: 127-canonical-booking-lifecycle
plan: 01
subsystem: calendar
tags: [supabase, postgres, plpgsql, rpc, vitest, booking-lifecycle, workflows]

requires:
  - phase: 126-booking-trust-boundary
    provides: booking_validation.ts entry-boundary validation pattern (sibling boundary to this plan's transition boundary)
provides:
  - "transition_booking_status SECURITY DEFINER RPC (migration 1251, not yet applied to production) — atomic guard+write for bookings.status, org-scoped tenant re-check"
  - "src/lib/calendar/booking-status.ts — single source of truth BookingStatus type + BOOKING_STATUSES + isBookingStatus"
  - "src/lib/calendar/transition.ts confirmBooking/cancelBooking/markNoShow/markShowed/rescheduleBooking — canonical, RPC-backed, org-scoped, idempotent lifecycle service"
  - "LIFE-02 vocabulary reconciliation: status 'showed' <-> event 'meeting.completed', documented in one place"
  - "tests/calendar/lifecycle.test.ts, tests/calendar-lifecycle-rpc.test.ts, tests/calendar-status-vocabulary.test.ts — regression guards for guard/idempotency/emission/vocabulary"
affects: [127-02, 127-03, 127-04, 127-05, 127-06, 127-07, 127-08]

tech-stack:
  added: []
  patterns:
    - "plpgsql SECURITY DEFINER RPC for atomic guard+write, modeled on debit_copilot_credits (migration 1208) — read+validate+write in one round trip via FOR UPDATE row lock"
    - "Tenant boundary re-check inside a SECURITY DEFINER function that bypasses RLS: booking_not_found is returned identically for both a missing row and an org mismatch, so a cross-org probe cannot distinguish the two"
    - "Idempotent-vs-illegal state guard: re-requesting the current status is a silent no-op (no re-emit); requesting any other status not in the allowed-from list raises, never a silent no-op that still emits"
    - "Real-DB tests run entirely inside one Postgres transaction (BEGIN -> apply migration SQL verbatim -> fixtures -> exercise -> ROLLBACK), soft-skipping without SUPABASE_DB_URL/DATABASE_URL — tests/calendar-overlap-constraint.test.ts precedent, reused here for tests/calendar-lifecycle-rpc.test.ts"

key-files:
  created:
    - supabase/migrations/1251_booking_lifecycle_transition.sql
    - src/lib/calendar/booking-status.ts
    - tests/calendar/lifecycle.test.ts
    - tests/calendar-lifecycle-rpc.test.ts
    - tests/calendar-status-vocabulary.test.ts
  modified:
    - src/types/database.ts
    - src/lib/calendar/transition.ts
    - src/app/api/cron/calendar-tick/route.ts

key-decisions:
  - "Kept 'showed' as the only DB attendance/completion value; markShowed writes status 'showed' and emits the pre-existing event name 'meeting.completed' rather than adding a redundant DB status — revives the dead skleanings-post-service-review seed workflow with zero seed changes"
  - "rescheduleBooking does not use the new RPC since it does not change status — it keeps a SELECT + guarded UPDATE...WHERE status='confirmed' pattern (adding an explicit orgId check), mirroring cancelBookingByToken's existing safe precedent"
  - "booking_not_found is raised for both a missing booking_id and an org_id mismatch (identical error), so the RPC's tenant boundary re-check cannot be probed to distinguish 'wrong org' from 'does not exist'"

requirements-completed: [LIFE-01, LIFE-02]

duration: 55min
completed: 2026-07-16
---

# Phase 127 Plan 01: Canonical Booking Lifecycle Transition Service Summary

**RPC-backed (migration 1251), org-scoped, idempotent booking lifecycle service (`confirmBooking`/`cancelBooking`/`markNoShow`/`markShowed`/`rescheduleBooking` in `transition.ts`) replacing a racy two-round-trip guard with a single atomic `transition_booking_status` Postgres function, plus the `showed`↔`meeting.completed` vocabulary reconciliation.**

## Performance

- **Duration:** 55 min
- **Started:** 2026-07-16T02:02:00Z (approx, per session start)
- **Completed:** 2026-07-16T02:56:47Z
- **Tasks:** 3
- **Files modified:** 8 (5 created, 3 modified)

## Accomplishments

- Added `transition_booking_status` — a `plpgsql SECURITY DEFINER` RPC (migration 1251, modeled on `debit_copilot_credits`) that does guard+write atomically in one round trip via `FOR UPDATE`, and re-checks the caller-supplied `org_id` against the booking's real `org_id` server-side (this function bypasses RLS, so the tenant boundary cannot be assumed from the caller's session)
- Added `src/lib/calendar/booking-status.ts` — the single shared `BookingStatus` type + `BOOKING_STATUSES` list derived from the generated DB type, replacing the local (and in `transition.ts`'s case, already-correct) declaration
- Rewrote all four existing guarded functions in `transition.ts` to call the new RPC (closing the SELECT-then-UPDATE race and adding the org check) and added a fifth, `markShowed`, which writes `status: 'showed'` and emits `meeting.completed` — resolving the LIFE-02 vocabulary split without adding a redundant DB status
- Removed the dead `'completed'` literal (and its now-unnecessary `as never` cast) from `cron/calendar-tick/route.ts`'s `meeting.ended` scanner — that literal could never match any row since `'completed'` has never been a valid DB value
- 43 new/passing tests across four suites: 27 unit tests for every guard/idempotency/emission/org-mismatch path (`tests/calendar/lifecycle.test.ts`), 6 real-DB transactional tests proving the RPC's atomicity and error semantics against production (rolled back, never committed) (`tests/calendar-lifecycle-rpc.test.ts`), 3 static vocabulary-consistency tests (`tests/calendar-status-vocabulary.test.ts`), plus the pre-existing 7-test `transition-dispatch.test.ts` regression suite, all green

## Task Commits

Each task was committed atomically:

1. **Task 1: Migration 1251 + database.ts Functions entry + booking-status.ts** - `c2b8f04e` (feat)
2. **Task 2: Rewrite transition.ts's guarded functions + tests/calendar/lifecycle.test.ts** - `d5cedba0` (feat)
3. **Task 3: Real-DB RPC test + status-vocabulary test + cron cleanup** - `cf5e6bb5` (test)

**Plan metadata:** (pending — this commit)

_Note: Task 3 also amended one comment in `transition.ts` (a documentation string that accidentally embedded the literal pattern `status: 'completed'`, tripping the new vocabulary scanner on its own explanatory text) — folded into the Task 3 commit since it was caught by that task's own new test._

## Files Created/Modified

- `supabase/migrations/1251_booking_lifecycle_transition.sql` - `transition_booking_status` SECURITY DEFINER RPC; NOT yet applied to production (Plan 127-08 handles the operator-gated apply)
- `src/types/database.ts` - registered `transition_booking_status` in the `Functions` block
- `src/lib/calendar/booking-status.ts` - `BookingStatus` type, `BOOKING_STATUSES` list, `isBookingStatus` guard
- `src/lib/calendar/transition.ts` - `confirmBooking`/`cancelBooking`/`markNoShow`/`markShowed`/`rescheduleBooking` rewritten to be RPC-backed and org-scoped; `emitCalendarEvent`/`recordDispatch`/`findMatchingWorkflows` untouched
- `src/app/api/cron/calendar-tick/route.ts` - `meeting.ended` scanner's status filter dropped the dead `'completed'` literal and the `as never` cast
- `tests/calendar/lifecycle.test.ts` - unit coverage (mocked Supabase) for every transition's guard/idempotency/emission behavior
- `tests/calendar-lifecycle-rpc.test.ts` - real-DB (transactional, rolled back) coverage of the RPC's atomicity and error semantics
- `tests/calendar-status-vocabulary.test.ts` - static scan asserting every literal `status: '...'` write in known writer files is a valid `BookingStatus`

## Decisions Made

- Kept `'showed'` as the only DB attendance/completion value; `markShowed` emits the pre-existing event name `meeting.completed` rather than introducing a new DB status — the smaller, lower-risk resolution per the phase research's Open Question #1, and it makes the previously-dead `skleanings-post-service-review.yaml` seed workflow live again with zero seed-file changes
- `rescheduleBooking` deliberately does not route through `transition_booking_status` (it does not change `status`); it keeps a SELECT + guarded `UPDATE ... WHERE status='confirmed'` pattern, now with an explicit `orgId` equality check added
- The RPC returns the identical `booking_not_found` error for both a missing `booking_id` and an org-mismatched `booking_id`, so a cross-org id cannot be distinguished from a nonexistent one by an external caller

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Reworded a `transition.ts` comment that tripped the new status-vocabulary scanner on its own text**
- **Found during:** Task 3 (writing `tests/calendar-status-vocabulary.test.ts` and running it against all `FILES_TO_SCAN`, which includes `transition.ts`)
- **Issue:** The `markShowed` documentation comment (written in Task 2) explained the pre-Phase-127 bug by quoting the literal invalid write, `` `status: 'completed' as 'confirmed'` ``. The new regex-based vocabulary scanner (`/status:\s*'([a-z_]+)'/g`) matches inside comments too (it has no AST awareness), so it flagged this quoted example as an offending literal write in the very file meant to be the canonical, correct one.
- **Fix:** Reworded the comment to describe the bug in prose ("an invalid literal status value (\"completed\" — never a valid DB status)") without embedding the `status: '...'` token pattern.
- **Files modified:** `src/lib/calendar/transition.ts`
- **Verification:** `npx vitest run tests/calendar-status-vocabulary.test.ts` — all 3 tests pass
- **Committed in:** `cf5e6bb5` (Task 3 commit)

---

**Total deviations:** 1 auto-fixed (1 bug, self-caught by this same plan's own new test)
**Impact on plan:** Cosmetic-only fix to a comment; no behavior change. No scope creep.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required. Migration 1251 is intentionally NOT applied to production by this plan (per the phase's Plan 127-08 operator-gated apply step) — `npx supabase db push` / MCP `apply_migration` were correctly never invoked.

## Known Stubs

None. This plan's guarded functions have zero external callers yet by design — Wave 2 (Plans 127-03 through 127-07) is what wires real writers to this service. That is the plan's stated scope boundary, not a stub: `src/lib/calendar/transition.ts`'s objective explicitly states "Nothing in this plan changes any writer's behavior yet."

## Next Phase Readiness

- The canonical transition service is fully built, tested (43 tests across 4 suites, all green), and type-checked (`npm run build` passes)
- Migration 1251 is code-complete but unapplied — Plans 127-02 through 127-07 can be planned/executed against it since Supabase RPC calls will simply fail gracefully (or the relevant writer code paths aren't live yet) until the operator-gated apply in Plan 127-08
- Wave 2 plans (127-03..127-07) can now delete every duplicated inline `.update()` call across the four writer categories (native, MCP, workflow actions, Xkedule inbound) and replace each with a call into this service
- No blockers

---
*Phase: 127-canonical-booking-lifecycle*
*Completed: 2026-07-16*

## Self-Check: PASSED

All 8 key-files confirmed present on disk (`supabase/migrations/1251_booking_lifecycle_transition.sql`, `src/lib/calendar/booking-status.ts`, `tests/calendar/lifecycle.test.ts`, `tests/calendar-lifecycle-rpc.test.ts`, `tests/calendar-status-vocabulary.test.ts`, `src/types/database.ts`, `src/lib/calendar/transition.ts`, `src/app/api/cron/calendar-tick/route.ts`). All 3 task commits confirmed present in git history (`c2b8f04e`, `d5cedba0`, `cf5e6bb5`).

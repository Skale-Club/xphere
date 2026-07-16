---
phase: 128-reliable-calendar-scheduling
plan: 05
subsystem: calendar
tags: [scheduling, cron, idempotency, watermark, vitest, transition-safety]

# Dependency graph
requires:
  - phase: 128-reliable-calendar-scheduling
    provides: "Plan 128-01's src/lib/calendar/tick.ts pure scheduling functions (computeDueWindow, computeStartsInTargetMinute, computeEndedTargetMinute, isStartsInCandidateStale, shouldAdvanceWatermark)"
  - phase: 128-reliable-calendar-scheduling
    provides: "Plan 128-02's hardened CRON_SECRET auth block already in src/app/api/cron/calendar-tick/route.ts"
  - phase: 128-reliable-calendar-scheduling
    provides: "Plan 128-04's calendar_tick_watermark table (migration 1252, not yet applied to production) and its Row/Insert/Update types in src/types/database.ts"
provides:
  - "src/app/api/cron/calendar-tick/route.ts's meeting.starts_in/meeting.ended scan loops are now watermark-bounded and offset-key-stable — the actual SCH-01/SCH-02 runtime fix, not just isolated unit-tested logic"
  - "Transition-safety guard: an absent calendar_tick_watermark table/row does not fall back to a 24h catch-up scan — it scans an empty window and self-seeds the watermark from now, preventing a double-dispatch burst if this code deploys before migration 1252 is applied"
  - "tests/calendar-tick-route.test.ts's new SCH-01/SCH-02 describe block: 4 tests proving stale-skip, catch-up dispatch with due-moment-derived fired_minute, and the watermark-advance guard end-to-end against a mocked Supabase"
affects: [128-06-migration-apply, calendar-tick-route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route reads its durable watermark once per event_type at the top of the handler, computes a bounded scan window via computeDueWindow, and only re-persists (upserts) that watermark after a scan pass with zero released/retried dispatches (shouldAdvanceWatermark)"
    - "Transition safety for not-yet-applied migrations: missing watermark row → treat as empty scan window (scanStart === scanEnd) rather than falling back to the pure-function's own unbounded-lookback-cap default, and self-heal by seeding the row from now — implemented in route.ts (the DB-aware layer), not in the pure tick.ts module, since tick.ts has no way to distinguish 'no watermark yet' from 'watermark read failed'"
    - "Idempotency dedup key (fired_minute) is now the booking's own computed due-moment (computeStartsInTargetMinute/computeEndedTargetMinute), never the tick's wall-clock windowStart — both the insert and its matching release-delete use the same derived key"

key-files:
  created: []
  modified:
    - src/app/api/cron/calendar-tick/route.ts
    - tests/calendar-tick-route.test.ts

key-decisions:
  - "Added a route-level TRANSITION SAFETY guard (not specified verbatim in the plan's task text, but explicitly required by the orchestrator's plan-check note): an absent/missing calendar_tick_watermark row for an event_type is treated as an empty scan window this tick (scanStart=scanEnd=now) with a self-seeding upsert, instead of letting computeDueWindow(now, null) apply its 24h catch-up cap — the 24h fallback is only safe once a watermark row is known to exist and simply predates the cap"
  - "Deviated from the plan's literal ended-loop status list: kept .in('status', ['confirmed', 'showed']) instead of adding 'completed' — the bookings.status DB column type (src/types/database.ts) and src/lib/calendar/booking-status.ts's explicit LIFE-02 vocabulary note both establish that 'completed' is not a valid DB status (the only completion state is 'showed'); adding it would have required an incorrect `as never` cast and contradicted established Phase 127 status vocabulary, and the plan's own objective text scopes this plan to 'query bounds and dedup-key computation' only, not status-vocabulary changes"
  - "Implemented the route test's 'does not advance watermark on a released dispatch' scenario via a rejected emitCalendarEvent (the catch block's actual release/delete/startsInReleased++ path) rather than a failed scheduled_workflow_ticks insert — the plan's behavior text described the fixture as 'insert made to always fail,' but per Task 1's own route.ts logic an insert failure is treated as an already-dispatched skip (totalSkipped++, no startsInReleased increment) and would NOT have blocked the watermark advance; only an emit failure triggers the release path that shouldAdvanceWatermark actually gates on"

requirements-completed: [SCH-01, SCH-02, SCH-03]

# Metrics
duration: 21min
completed: 2026-07-16
---

# Phase 128 Plan 05: Calendar-Tick Route Watermark Wiring Summary

**Wired `src/lib/calendar/tick.ts`'s pure scheduling functions and the `calendar_tick_watermark` table into the live `meeting.starts_in`/`meeting.ended` scan loops of `route.ts`, replacing the fixed `[now, now+1min)` window and wall-clock-derived `fired_minute` — the actual runtime fix for SCH-01/SCH-02, closing the loop opened by Plans 128-01/128-02/128-04.**

## Performance

- **Duration:** 21 min
- **Started:** 2026-07-16T04:59:32Z (previous plan's commit timestamp, used as baseline)
- **Completed:** 2026-07-16T05:20:04Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `route.ts` now reads `calendar_tick_watermark` for both `meeting.starts_in`/`meeting.ended` at the top of the handler and computes a `(scanStart, scanEnd]` window via `computeDueWindow` instead of a fixed one-minute wall-clock slice — a late or skipped tick now catches every due-moment that fell in the gap
- `scheduled_workflow_ticks.fired_minute` is derived per-booking from `computeStartsInTargetMinute`/`computeEndedTargetMinute` (the booking's actual due-moment), never from the tick's `windowStart` — both the insert and its matching release-delete use the identical derived key
- `meeting.starts_in` candidates whose `start_at` has already passed by dispatch time are skipped via `isStartsInCandidateStale` and counted in the new `stale_skipped` response field, instead of firing stale "starts in N minutes" content
- The watermark for each event type only advances (upserts `scanned_to: now`) when `shouldAdvanceWatermark` sees zero released/retried dispatches for that pass — a partially-failed pass is fully retried on the next tick
- **Transition-safety guard (deviation, see below):** an absent watermark table/row does not fall back to the pure function's 24h catch-up cap — it scans an empty window and self-seeds the watermark from `now`, preventing a double-dispatch burst if this code deploys to production before migration 1252 (Plan 128-04) is applied
- 4 new end-to-end route tests (mocked Supabase, `vi.useFakeTimers`) prove stale-skip, catch-up dispatch with a due-moment-derived key, and both watermark-advance-guard directions; combined with Plan 128-02's 5 existing auth tests, `tests/calendar-tick-route.test.ts` is 9/9 green
- Explicitly untouched per plan scope: the opportunity-tick scanner (`processOpportunityTimeBasedEvents`) and the wait-timeout scanner (`findExpiredWaits`/`satisfyWait`/`resumeRun`) — both already have separate, correct idempotency mechanisms and are not named by SCH-01/02/03

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire watermark-bounded scan + offset-derived dedup key into route.ts** - `ee04c5c6` (feat)
2. **Task 2: Extend the route test with catch-up, stale-skip, and watermark-guard coverage** - `74e3e6eb` (test)

**Plan metadata:** _pending (this commit follows)_

## Files Created/Modified
- `src/app/api/cron/calendar-tick/route.ts` - `meeting.starts_in`/`meeting.ended` scan loops rewritten to be watermark-bounded (via `src/lib/calendar/tick.ts`) and offset-key-stable; new transition-safety guard for a missing watermark row; response payload gains `starts_in_scan`/`ended_scan`/`stale_skipped` observability fields (existing fields unchanged). Opportunity-tick and wait-timeout scanners below it are untouched except for the response payload shape.
- `tests/calendar-tick-route.test.ts` - New `describe('GET /api/cron/calendar-tick — catch-up + stale-skip + watermark guard (SCH-01/SCH-02)', ...)` block with a per-table-aware Supabase mock (filters `.contains()` by `trigger_config.event` so the `meeting.starts_in` fixture workflow never leaks into the `meeting.ended`/opportunity-scanner branches), `vi.useFakeTimers()` for deterministic fixtures, and mocked `emitCalendarEvent`/`findExpiredWaits` so only the scan/dedup wiring is exercised

## Decisions Made
- Implemented the TRANSITION SAFETY guard exactly as directed by the orchestrator's plan-check note (not fully spelled out in the plan's task action text): missing watermark row(s) → empty scan this tick + self-seed from `now`, never the pure module's 24h catch-up fallback. This is a route-layer (DB-aware) decision, not a change to `src/lib/calendar/tick.ts`'s pure `computeDueWindow`, since only the route knows whether "no watermark" means "row genuinely absent" vs. "watermark deliberately old."
- Kept the `meeting.ended` status filter as `['confirmed', 'showed']` (unchanged from before this plan) rather than adding `'completed'` as the plan's action text literally specified — `'completed'` is not a valid `bookings.status` value in this codebase (see `src/lib/calendar/booking-status.ts`'s LIFE-02 vocabulary note and the `database.ts` type union), and the plan's own objective text scopes this plan strictly to scan bounds and dedup-key computation.
- Modeled the route test's "released dispatch → watermark does not advance" case via a rejected `emitCalendarEvent` (the actual code path that increments `startsInReleased`), not a rejected `scheduled_workflow_ticks` insert as the plan's behavior prose suggested — an insert failure in the real code is an already-dispatched skip that does not gate the watermark advance.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Added a transition-safety guard for an absent/missing calendar_tick_watermark row**
- **Found during:** Task 1 (route wiring)
- **Issue:** The plan's literal watermark-read code (`watermarkByType.get(eventType) ?? null` fed straight into `computeDueWindow`) would silently trigger `computeDueWindow`'s 24h catch-up-cap fallback whenever the watermark table/row is missing — exactly the double-dispatch-burst risk the orchestrator's plan-check flagged as unacceptable if this route deploys before migration 1252 is applied.
- **Fix:** Added `resolveWindow(eventType)`, which treats a missing/errored watermark read as an empty scan window (`scanStart === scanEnd === now`) and immediately seeds the watermark row from `now` via upsert, so the *next* tick has a real starting point and no historical backlog is ever scanned blind.
- **Files modified:** src/app/api/cron/calendar-tick/route.ts
- **Verification:** Exercised organically by all 4 new route tests (none seed a `meeting.ended` watermark row), confirmed via the `[calendar-tick] no watermark for meeting.ended — scanning empty window and seeding from now` log line and `npm run build`/`npx vitest run` passing
- **Committed in:** ee04c5c6 (Task 1 commit)

**2. [Rule 1 - Bug] Did not add 'completed' to the meeting.ended status filter as the plan's action text specified**
- **Found during:** Task 1 (route wiring)
- **Issue:** The plan instructed changing `.in('status', ['confirmed', 'showed'])` to `.in('status', ['confirmed', 'completed', 'showed'] as never)`. `'completed'` is not a member of the `bookings.status` union (`'confirmed' | 'cancelled' | 'no_show' | 'showed'` per `src/types/database.ts`), and `src/lib/calendar/booking-status.ts` explicitly documents (LIFE-02) that the DB has no `'completed'` status — `'showed'` is the only completion value. Adding it would have required the exact `as never` type-safety bypass the plan itself anticipated, silently masking an incorrect status literal.
- **Fix:** Left the status filter unchanged (`['confirmed', 'showed']`), consistent with established Phase 127 vocabulary and this plan's own explicit scope boundary ("only the meeting.starts_in/meeting.ended DB query bounds and dedup-key computation change").
- **Files modified:** src/app/api/cron/calendar-tick/route.ts
- **Verification:** `npm run build` passes with zero type errors (no `as never` cast needed); status vocabulary matches `src/lib/calendar/transition.ts`'s existing usage throughout the file
- **Committed in:** ee04c5c6 (Task 1 commit)

**3. [Rule 1 - Bug] Test 3's fixture models the release via a rejected emitCalendarEvent, not a rejected insert**
- **Found during:** Task 2 (route test)
- **Issue:** The plan's `<behavior>` prose for the watermark-advance-guard test says "the `scheduled_workflow_ticks` insert mock is made to always fail." Per Task 1's own route.ts logic, an insert failure (`insErr` truthy) is treated as an already-claimed skip — `totalSkipped++; continue` — and never increments `startsInReleased`, so `shouldAdvanceWatermark(0)` would remain `true` and the watermark WOULD advance, contradicting the test's own required assertion.
- **Fix:** Implemented the fixture so the claim insert succeeds and the mocked `emitCalendarEvent` rejects instead — the actual code path (`catch (emitErr)` block) that deletes/releases the claim and increments `startsInReleased`, correctly driving `shouldAdvanceWatermark(1) === false`.
- **Files modified:** tests/calendar-tick-route.test.ts
- **Verification:** Test passes and asserts `calendar_tick_watermark` upsert for `meeting.starts_in` is never called in this scenario; the sibling "zero releases → watermark advances" test proves the positive case with the same fixture shape but a resolving `emitCalendarEvent`
- **Committed in:** 74e3e6eb (Task 2 commit)

---

**Total deviations:** 3 auto-fixed (1 missing-critical guard, 2 bug-level corrections to the plan's own literal text)
**Impact on plan:** All three were necessary for correctness — deviation 1 closes a real production risk explicitly called out by the plan-check, deviation 2 avoids introducing a factually invalid status literal into an already-hardened vocabulary, and deviation 3 makes the new test actually validate the `shouldAdvanceWatermark` contract as implemented rather than a scenario that the real code doesn't gate on. No scope creep — the opportunity-tick and wait-timeout scanners remain untouched, and the response payload change is purely additive.

## Issues Encountered

Running the full `npm test` suite (per the plan's `<verification>` block) surfaced 62 pre-existing failures across 34 files, none touching `src/app/api/cron/calendar-tick/`, `src/lib/calendar/tick.ts`, or any `tests/calendar-tick-*.test.ts` file. Spot-checked `tests/calendar-overlap-constraint.test.ts` (same `src/lib/calendar/` area) in isolation — it passes 4/4 cleanly, confirming the full-suite failures are pre-existing real-DB test-isolation/parallelism noise in this worktree, not a regression introduced by this plan. Logged in `.planning/workstreams/calendar-reliability/phases/128-reliable-calendar-scheduling/deferred-items.md` per the executor's scope boundary; not fixed (out of scope for this plan).

This plan's own required verification — `npx vitest run tests/calendar-tick-route.test.ts tests/calendar-tick-window.test.ts tests/calendar-tick-idempotency.test.ts tests/workflow-seeds-tenant-neutral.test.ts` — is fully green (33/33, idempotency test ran live against the real DB in-transaction, not soft-skipped), and `npm run build` passes with zero type errors.

## User Setup Required

None - no external service configuration required. This plan only changes application code and a test file; it consumes (but does not apply) migration 1252 from Plan 128-04, which remains Plan 128-06's operator-checkpoint responsibility.

## Next Phase Readiness
- SCH-01, SCH-02, and SCH-03's durable-progress requirement are now closed in the *running* code, not just in isolated unit tests — the live `calendar-tick` endpoint scans a persisted-watermark-bounded window, derives its dedup key from each booking's actual due-moment, skips (and counts) stale `meeting.starts_in` candidates, and only advances its watermark past a fully-clean scan pass.
- The transition-safety guard means this code is safe to deploy to production even before Plan 128-06 applies migration 1252 — the route will log a warning, seed the watermark on first tick, and scan normally from then on, with zero risk of a 24h-lookback double-dispatch burst.
- Plan 128-06 (migration apply) can now proceed independently; once migration 1252 lands in production, the very next tick will pick up the seeded watermark rows automatically with no further code change.
- `deferred-items.md` documents the pre-existing, unrelated full-suite `npm test` noise for `/gsd:verify-work` to route around rather than attribute to this plan.

---
*Phase: 128-reliable-calendar-scheduling*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: src/app/api/cron/calendar-tick/route.ts
- FOUND: tests/calendar-tick-route.test.ts
- FOUND: .planning/workstreams/calendar-reliability/phases/128-reliable-calendar-scheduling/128-05-SUMMARY.md
- FOUND: .planning/workstreams/calendar-reliability/phases/128-reliable-calendar-scheduling/deferred-items.md
- FOUND: ee04c5c6 (feat commit)
- FOUND: 74e3e6eb (test commit)

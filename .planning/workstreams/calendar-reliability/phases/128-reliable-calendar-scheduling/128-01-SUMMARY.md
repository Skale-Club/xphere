---
phase: 128-reliable-calendar-scheduling
plan: 01
subsystem: calendar
tags: [scheduling, cron, idempotency, watermark, vitest, tdd]

# Dependency graph
requires:
  - phase: 127-canonical-booking-lifecycle
    provides: emitCalendarEvent as the canonical dispatch path (src/lib/calendar/transition.ts) that the calendar-tick route already uses and will continue to use
provides:
  - "src/lib/calendar/tick.ts — pure, DB-agnostic scheduling math: computeDueWindow, isDue, computeStartsInTargetMinute, computeEndedTargetMinute, isStartsInCandidateStale, shouldAdvanceWatermark, truncateToMinute, MAX_CATCHUP_LOOKBACK_MINUTES"
  - "tests/calendar-tick-window.test.ts — 16-test unit suite proving SCH-01 (delay-tolerant window + stale-skip) and SCH-02 (stable offset-derived dedup key + watermark-advance guard) behaviors in isolation from Supabase"
affects: [128-05-route-wiring, calendar-tick-route, scheduled-workflow-ticks]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure functions in src/lib/**, thin Supabase-calling route in src/app/api/** (mirrors src/lib/obs/alerts.ts / tests/obs-alerts.test.ts)"
    - "Watermark-bounded scan window (scanStart exclusive, scanEnd inclusive) capped by a hard lookback constant, not an unbounded historical scan"
    - "Idempotency/dedup keys derived from the semantic due-moment (booking start_at/end_at + offset), not from wall-clock tick time"

key-files:
  created:
    - src/lib/calendar/tick.ts
    - tests/calendar-tick-window.test.ts
  modified: []

key-decisions:
  - "Implemented exactly the <interfaces> block's exported names/signatures verbatim (no renaming) so Plan 128-05 can import directly without adaptation"
  - "isDue treats the lower bound as exclusive and the upper bound as inclusive, matching (watermark, now] semantics — prevents reprocessing the boundary target across consecutive ticks while still catching the current tick's exact due-moment"
  - "No REFACTOR commit — the GREEN implementation already matched the plan's exact prescribed shape with no cleanup needed"

patterns-established:
  - "New calendar scheduling logic goes in src/lib/calendar/tick.ts as pure functions; route.ts (Plan 128-05) becomes a thin caller"

requirements-completed: [SCH-01, SCH-02]

# Metrics
duration: 5min
completed: 2026-07-16
---

# Phase 128 Plan 01: Pure Calendar Tick Scheduling Math Summary

**Extracted the watermark-window, offset-derived-dedup-key, stale-candidate, and watermark-advance-guard logic into a new pure module `src/lib/calendar/tick.ts`, proven by a 16-test Vitest suite with zero Supabase mocking.**

## Performance

- **Duration:** 5 min
- **Started:** 2026-07-16T04:25:35Z (previous plan's commit timestamp, used as baseline)
- **Completed:** 2026-07-16T04:30:36Z
- **Tasks:** 2 (TDD: RED + GREEN)
- **Files modified:** 2 (both newly created)

## Accomplishments
- `computeDueWindow(now, watermark, maxLookbackMinutes?)` — watermark-bounded scan window, capped at `MAX_CATCHUP_LOOKBACK_MINUTES` (24h) so a missing/very-old watermark cannot force an unbounded historical scan
- `isDue(targetMinute, window)` — exclusive lower bound / inclusive upper bound semantics `(scanStart, scanEnd]`
- `computeStartsInTargetMinute`/`computeEndedTargetMinute` — dedup keys derived from the booking's own start_at/end_at + offset (the due-moment), proven stable/idempotent across repeated calls regardless of wall-clock dispatch time
- `isStartsInCandidateStale(startAt, now)` — flags a `meeting.starts_in` candidate whose start_at has already passed by dispatch time (start_at === now also counts as stale)
- `shouldAdvanceWatermark(releasedCount)` — pure decision: watermark only advances when zero dispatches were released (retried) during the pass
- All 16 unit tests pass; `npm run build` succeeds with zero type errors

## Task Commits

Each task was committed atomically (TDD RED → GREEN, no REFACTOR needed):

1. **Task 1: Write the failing unit test suite** - `df00f359` (test)
2. **Task 2: Implement src/lib/calendar/tick.ts** - `324a49b6` (feat)

_Note: This was a `tdd="true"` task pair — no separate plan-metadata commit yet; that follows below._

## Files Created/Modified
- `tests/calendar-tick-window.test.ts` - 16-test suite (6 describe blocks) covering computeDueWindow, isDue, computeStartsInTargetMinute, computeEndedTargetMinute, isStartsInCandidateStale, shouldAdvanceWatermark — all fixed ISO dates, `.toISOString()` equality, no `vi.mock`
- `src/lib/calendar/tick.ts` - Pure, DB-agnostic scheduling module implementing the exact `<interfaces>` contract from the plan (no Supabase import), ready for Plan 128-05 to wire into `src/app/api/cron/calendar-tick/route.ts`

## Decisions Made
- Followed the plan's `<interfaces>` block verbatim for all exported names/signatures — no deviation, since Plan 128-05 depends on importing these exact symbols
- `isDue`'s exclusive-start/inclusive-end boundary semantics implemented exactly as specified in the plan's behavior list (not left to interpretation), since this is the core SCH-01 correctness property

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. This plan is pure internal logic with no environment/DB/API surface.

## Next Phase Readiness
- `src/lib/calendar/tick.ts` is ready for Plan 128-05 to import and wire into `src/app/api/cron/calendar-tick/route.ts`, replacing the route's current inline wall-clock-anchored window/dedup logic
- The 16-test suite has zero DB dependency and will always run in CI without gating on `DATABASE_URL`/`SUPABASE_DB_URL`
- No blockers for subsequent Phase 128 plans

---
*Phase: 128-reliable-calendar-scheduling*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: src/lib/calendar/tick.ts
- FOUND: tests/calendar-tick-window.test.ts
- FOUND: .planning/workstreams/calendar-reliability/phases/128-reliable-calendar-scheduling/128-01-SUMMARY.md
- FOUND: df00f359 (test commit)
- FOUND: 324a49b6 (feat commit)

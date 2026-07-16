---
phase: 128-reliable-calendar-scheduling
plan: 04
subsystem: calendar
tags: [scheduling, cron, idempotency, watermark, postgres, migration, vitest, tdd]

# Dependency graph
requires:
  - phase: 128-01
    provides: computeStartsInTargetMinute/computeEndedTargetMinute pure functions in src/lib/calendar/tick.ts that this plan's test exercises directly as the offset-derived dedup key
provides:
  - "supabase/migrations/1252_calendar_tick_watermark.sql — not-yet-applied migration adding calendar_tick_watermark (durable scan-progress cursor, one row per event_type, RLS enabled with no policy), plus a COMMENT ON COLUMN documenting the SCH-02 semantic change to scheduled_workflow_ticks.fired_minute"
  - "tests/calendar-tick-idempotency.test.ts — real-DB (transaction+rollback, never committed) proof that the offset-derived dedup key makes exactly-once dispatch hold under retry/catch-up, contrasted against the old wall-clock-derived key shape which does not"
  - "calendar_tick_watermark table type in src/types/database.ts"
affects: [128-05-route-wiring, 128-06-migration-apply, calendar-tick-route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-DB test applies its own not-yet-applied migration SQL verbatim inside a single BEGIN...ROLLBACK transaction, with SAVEPOINTs around statements expected to fail (mirrors tests/calendar-overlap-constraint.test.ts) — proves migration correctness before the migration is ever applied to production"
    - "Watermark table (calendar_tick_watermark) mirrors the automation_schedules (migration 033) RLS-enabled-no-policy, service-role-only pattern"

key-files:
  created:
    - tests/calendar-tick-idempotency.test.ts
    - supabase/migrations/1252_calendar_tick_watermark.sql
  modified:
    - src/types/database.ts

key-decisions:
  - "Used migration number 1252, not the plan's working-example 1251 — Phase 127 already claimed 1251_booking_lifecycle_transition.sql on this branch (confirmed via `ls supabase/migrations/ | sort | tail`), matching both the plan's own explicit numbering-coordination instruction and the orchestrator's pre-flight override"
  - "Test creates one throwaway event_type + workflow + booking as base fixtures (matching tests/calendar-overlap-constraint.test.ts's fixture conventions) plus a second throwaway booking scoped only to the contrast test (test 4), explicitly deleted after use so it doesn't leak into later assertions within the same rolled-back transaction"
  - "Did not include the vi.mock('server-only', ...) stub tests/calendar-overlap-constraint.test.ts uses — unnecessary here since src/lib/calendar/tick.ts has zero imports (pure module), so there is nothing to stub"

patterns-established:
  - "Migration + real-DB idempotency proof ships as one plan, ahead of route wiring — the migration file and its test both exist and pass before any production application or app-code change consumes the new table"

requirements-completed: [SCH-01, SCH-02, SCH-03]

# Metrics
duration: 8min
completed: 2026-07-16
---

# Phase 128 Plan 04: Calendar Tick Watermark Migration + Idempotency Proof Summary

**New `calendar_tick_watermark` table (migration 1252, not yet applied to production) plus a real-DB transactional test proving `scheduled_workflow_ticks`' composite primary key only achieves exactly-once dispatch when the dedup key is derived from the booking's offset-computed due-moment — not from wall-clock tick time.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-16T04:48:29Z (previous plan's commit timestamp, used as baseline)
- **Completed:** 2026-07-16T04:56:06Z
- **Tasks:** 2 (TDD-style: RED test task, then migration + types task)
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `tests/calendar-tick-idempotency.test.ts` — 5-test real-DB suite (transaction+rollback, never committed, soft-skips without `SUPABASE_DB_URL`/`DATABASE_URL`) proving:
  1. `computeStartsInTargetMinute` is stable across repeated calls with the identical `(startAt, offset)` pair
  2. A first claim on `scheduled_workflow_ticks` using the offset-derived key succeeds
  3. A second claim recomputing the identical offset-derived key (simulating a retried/overlapping tick) is rejected by the existing composite primary key (migration 087)
  4. **Contrast case:** two different wall-clock-derived `fired_minute` values for the same `(workflow, booking, event_type)` both succeed — proving the OLD key shape could not have prevented the exact double-dispatch this migration/fix exists to close
  5. `calendar_tick_watermark` seeds correctly (one row each for `meeting.starts_in`/`meeting.ended`, non-null `scanned_to`)
  6. Upserting `calendar_tick_watermark` via `ON CONFLICT ... DO UPDATE` durably advances `scanned_to` — proves the persisted-progress mechanism SCH-03 requires
- `supabase/migrations/1252_calendar_tick_watermark.sql` — new table, `updated_at` trigger, RLS enabled with no policy (service-role only, matches `automation_schedules` precedent), seeded rows for both known event types, plus a `COMMENT ON COLUMN` documenting the SCH-02 semantic change to `scheduled_workflow_ticks.fired_minute` (no schema change to that table)
- `src/types/database.ts` — `calendar_tick_watermark` table type added adjacent to `scheduled_workflow_ticks`
- All 5 tests pass against the real (production) Supabase connection, fully rolled back; `npm run build` passes with zero type errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the failing real-DB watermark + dedup-key test** - `99d57842` (test)
2. **Task 2: Write the calendar_tick_watermark migration + update database.ts types** - `72e3fd47` (feat)

_Note: This was a `tdd="true"` task pair. Per the plan's own `<done>` note, "RED" for Task 1 means the test file didn't exist yet — the test is self-contained and applies its own migration DDL in-transaction, so it passes green immediately once written; Task 2 then extracts that identical DDL into the actual migration file, which does not change the test's pass/fail status._

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `tests/calendar-tick-idempotency.test.ts` - Real-DB transactional test (BEGIN/SAVEPOINT/ROLLBACK, never committed) proving watermark persistence and offset-derived dedup-key collision behavior, contrasted against the old wall-clock-derived key shape
- `supabase/migrations/1252_calendar_tick_watermark.sql` - New `calendar_tick_watermark` table + trigger + RLS + seed rows + documentary `COMMENT ON COLUMN`/`COMMENT ON TABLE`, not yet applied to production
- `src/types/database.ts` - Added `calendar_tick_watermark` table type block (Row/Insert/Update/Relationships)

## Decisions Made
- **Migration number 1252, not 1251:** the plan's frontmatter/prose used `1251` as a working example but explicitly instructed re-verifying the actual next-free number at execution time. `ls supabase/migrations/ | sort | tail` confirmed Phase 127 already landed `1251_booking_lifecycle_transition.sql` on this branch, so this plan's migration is `1252_calendar_tick_watermark.sql`. Every reference (filename, test comments, SUMMARY) uses 1252 consistently.
- Followed `tests/calendar-overlap-constraint.test.ts`'s exact structure (connection setup, SAVEPOINT-based `expectInsertRejected` helper, fixture conventions, `ROLLBACK` in `afterAll`) rather than inventing a new real-DB test pattern.

## Deviations from Plan

None - plan executed exactly as written, with the migration-numbering substitution (1251→1252) explicitly anticipated and instructed by both the plan itself (frontmatter numbering note, Task 2's action text) and the orchestrator's pre-flight override.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. The migration is intentionally NOT applied to production by this plan (Plan 128-06 handles that via an operator checkpoint).

## Next Phase Readiness
- `supabase/migrations/1252_calendar_tick_watermark.sql` is reviewable and ready for Plan 128-06's operator-checkpoint application to production
- Plan 128-05 can now wire `calendar_tick_watermark` and the offset-derived `fired_minute` key derivation into `src/app/api/cron/calendar-tick/route.ts`, using `src/lib/calendar/tick.ts`'s pure functions (Plan 128-01) exactly as this plan's test exercises them
- No blockers for subsequent Phase 128 plans

---
*Phase: 128-reliable-calendar-scheduling*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: tests/calendar-tick-idempotency.test.ts
- FOUND: supabase/migrations/1252_calendar_tick_watermark.sql
- FOUND: .planning/workstreams/calendar-reliability/phases/128-reliable-calendar-scheduling/128-04-SUMMARY.md
- FOUND: 99d57842 (test commit)
- FOUND: 72e3fd47 (feat commit)

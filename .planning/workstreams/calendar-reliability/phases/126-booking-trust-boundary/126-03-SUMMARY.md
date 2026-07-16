---
phase: 126-booking-trust-boundary
plan: 03
subsystem: database
tags: [postgres, supabase, exclusion-constraint, btree_gist, calendar, bookings, vitest]

# Dependency graph
requires:
  - phase: 126-01
    provides: resolveAndValidateSlot shared slot-validation core (application-level CAL-01 guard this migration backstops at the DB level)
provides:
  - "supabase/migrations/1249_bookings_organizer_overlap_guard.sql — not yet applied to production"
  - "bookings.organizer_user_id column (denormalized organizer, trigger-populated) — typed in database.ts"
  - "Real-DB test proving CHECK(start_at<end_at) + cross-event-type EXCLUDE constraint behavior"
affects: [126-06]

# Tech tracking
tech-stack:
  added: [btree_gist (Postgres extension)]
  patterns:
    - "GiST EXCLUDE constraint for organizer-scoped time-range overlap, partial via WHERE (status='confirmed' AND external_source IS NULL)"
    - "In-transaction migration test: BEGIN, apply migration SQL, exercise with SAVEPOINTs, ROLLBACK — never commits schema/data changes to a shared/production DB"

key-files:
  created:
    - supabase/migrations/1249_bookings_organizer_overlap_guard.sql
    - tests/calendar-overlap-constraint.test.ts
  modified:
    - src/types/database.ts

key-decisions:
  - "Real-DB test applies migration 1249's SQL inside a single BEGIN...ROLLBACK transaction (with SAVEPOINTs around expected-failure inserts) instead of assuming the migration is already applied to whatever DB SUPABASE_DB_URL points at — .env.local in this worktree targets production, and the migration must not land there until Plan 126-06's operator checkpoint"
  - "Migration file numbered 1249 (not the worktree's next-free 1248) to match the number Plan 126-04 was authored against for 1250 — the gap is intentional, filenames don't need to be contiguous since neither migration is applied yet"

requirements-completed: [CAL-02]

duration: 35min
completed: 2026-07-16
---

# Phase 126 Plan 03: Booking Organizer Overlap Guard Summary

**Migration 1249 adds a Postgres GiST exclusion constraint (`bookings_no_organizer_overlap`) plus a `CHECK(start_at<end_at)` guard, closing the cross-event-type double-booking gap the existing per-event-type unique index couldn't catch — proven by a real-DB test that applies the migration SQL inside a rolled-back transaction so production stays untouched until Plan 126-06.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-16T00:30:00Z (approx.)
- **Completed:** 2026-07-16T01:05:25Z
- **Tasks:** 2
- **Files modified:** 3 (1 created migration, 1 created test, 1 modified types file)

## Accomplishments
- New migration `1249_bookings_organizer_overlap_guard.sql`: denormalized `bookings.organizer_user_id` (backfilled from `event_types.user_id`, kept in sync by `trg_bookings_set_organizer`), a `bookings_valid_interval` CHECK constraint, and a `bookings_no_organizer_overlap` GiST EXCLUDE constraint scoped to `status='confirmed' AND external_source IS NULL`
- Real-DB integration test (`tests/calendar-overlap-constraint.test.ts`) proving all four required behaviors: malformed-interval rejection, cross-event-type organizer overlap rejection (the actual CAL-02 gap), back-to-back allowance (half-open `'[)'` range), and Xkedule mirror exemption
- `src/types/database.ts` updated with the new `organizer_user_id` column (Row/Insert/Update) and its FK relationship
- Verified via direct query after the test run that zero schema changes and zero test rows persisted to the production database

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the real-DB integration test for the overlap guard** - `0e5a4f19` (test)
2. **Task 2: Write migration 1249 + update database.ts types** - `b64f7eee` (feat)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `supabase/migrations/1249_bookings_organizer_overlap_guard.sql` - New migration: `organizer_user_id` column + backfill + trigger, `bookings_valid_interval` CHECK, `bookings_no_organizer_overlap` EXCLUDE USING gist. Not yet applied to production.
- `tests/calendar-overlap-constraint.test.ts` - Real-DB `pg.Client` test covering all 4 required behaviors; runs the migration SQL inside a transaction it always rolls back
- `src/types/database.ts` - Adds `organizer_user_id: string | null` to the `bookings` table's Row/Insert/Update types plus the `bookings_organizer_user_id_fkey` relationship entry

## Decisions Made
- The test suite applies migration 1249's SQL in-transaction rather than assuming external apply, per explicit execution-context instruction (`.env.local` here points at production, and the migration is intentionally deferred to Plan 126-06). This required SAVEPOINT/ROLLBACK TO SAVEPOINT handling around each statement expected to fail, since a bare failed query would otherwise abort the whole outer transaction (including the migration DDL applied earlier in `beforeAll`).
- Kept the migration file's exact SQL content as specified in the plan verbatim (including the pre-flight audit query documented in its header comment for the Plan 126-06 operator step).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Real-DB test wraps migration application in a transaction instead of assuming external apply**
- **Found during:** Task 1
- **Issue:** The plan's literal `<action>` text (and the RESEARCH.md test map) describes a test that assumes migration 1249 is already applied to whatever DB `SUPABASE_DB_URL`/`DATABASE_URL` points at when the suite runs. In this worktree, `.env.local` points at the **production** Supabase project, and the migration must not be applied there until Plan 126-06's operator-gated checkpoint. Running the test as literally described would either (a) fail every assertion because the constraint doesn't exist yet, or (b) require applying the migration to production out of band, violating the plan's own "not yet applied to production" objective.
- **Fix:** The entire suite now runs inside one `BEGIN` transaction: applies migration 1249's SQL verbatim, creates fixtures, exercises the constraint (using `SAVEPOINT`/`ROLLBACK TO SAVEPOINT` around the two inserts expected to fail so the outer transaction stays usable), and always issues `ROLLBACK` in `afterAll` — nothing is ever committed.
- **Files modified:** tests/calendar-overlap-constraint.test.ts
- **Verification:** `npx vitest run tests/calendar-overlap-constraint.test.ts` — all 4 tests pass against the live production connection string; a follow-up direct query after the run confirmed zero leftover `event_types` test rows, the `organizer_user_id` column absent, and neither new constraint present on `public.bookings` (i.e., a clean rollback).
- **Committed in:** 0e5a4f19 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Necessary to satisfy the plan's own "not yet applied to production" constraint while still proving the migration's real-DB behavior with an unmodified `.env.local`. No scope creep — the migration file's SQL content is unchanged from the plan's specification.

## Issues Encountered
None.

## User Setup Required

None - no external service configuration required. The migration itself requires an operator-run pre-flight audit and `apply_migration` step in Plan 126-06 before it takes effect in production.

## Next Phase Readiness
- `supabase/migrations/1249_bookings_organizer_overlap_guard.sql` is ready for the Plan 126-06 operator checkpoint (pre-flight audit + `apply_migration` via Supabase MCP)
- `tests/calendar-overlap-constraint.test.ts` will need no changes once the migration is actually applied to production — it re-applies the same SQL in-transaction regardless of whether the real migration already landed (idempotent `IF NOT EXISTS`/`DROP ... IF EXISTS` guards throughout), so it stays green either way
- No blockers for Plan 126-04 (RLS least privilege, also wave 1, independent) or Plan 126-06 (applies both 1249 and 1250)

---
*Phase: 126-booking-trust-boundary*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: supabase/migrations/1249_bookings_organizer_overlap_guard.sql
- FOUND: tests/calendar-overlap-constraint.test.ts
- FOUND: .planning/workstreams/calendar-reliability/phases/126-booking-trust-boundary/126-03-SUMMARY.md
- FOUND commit: 0e5a4f19 (test)
- FOUND commit: b64f7eee (feat)

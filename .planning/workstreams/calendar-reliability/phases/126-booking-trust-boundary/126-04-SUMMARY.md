---
phase: 126-booking-trust-boundary
plan: 04
subsystem: database
tags: [supabase, rls, postgres, calendar, vitest, security]

# Dependency graph
requires:
  - phase: 126-booking-trust-boundary (plan 03)
    provides: migration 1249 (organizer overlap guard) — established the in-transaction real-DB test pattern this plan reuses for RLS
provides:
  - "supabase/migrations/1250_calendar_rls_least_privilege.sql — drops the 3 anon-broad RLS policies on bookings/user_availability/event_types (not yet applied to production)"
  - "tests/calendar-rls.test.ts — real-DB, transactional, prod-safe proof that the post-migration RLS state blocks anon writes/reads while preserving authenticated org-scoped access"
affects: [126-06-apply-migrations, calendar-booking-flows, calendar-rls]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "In-transaction RLS simulation for prod-safe testing: BEGIN -> apply not-yet-applied migration DDL verbatim -> SET LOCAL ROLE anon/authenticated + request.jwt.claims (Supabase's documented RLS test pattern) -> assert -> ROLLBACK, never touching live data"

key-files:
  created:
    - tests/calendar-rls.test.ts
    - supabase/migrations/1250_calendar_rls_least_privilege.sql
  modified: []

key-decisions:
  - "Task 1's test uses a pg.Client single-transaction simulation (mirroring tests/calendar-overlap-constraint.test.ts) instead of the literal supabase-js anon/authenticated client pattern from tests/rls-isolation.test.ts, because .env.local points at production and migration 1250 is not applied there yet — a literal live anon-client INSERT would have actually written an attacker-controlled row into the production bookings table right now."
  - "Fixture selection restricts to an org_members row for a user who belongs to exactly one org, so get_current_org_id()'s user_active_org-first resolution can't silently point at a different org than the one fixtures were seeded into."

patterns-established:
  - "Real-DB RLS assertions inside a rolled-back transaction using SET LOCAL ROLE + request.jwt.claims — reusable for any future policy test where the target DB is production and the policy under test isn't live yet."

requirements-completed: [CAL-04]

# Metrics
duration: 20min
completed: 2026-07-16
---

# Phase 126 Plan 04: Calendar RLS Least Privilege Summary

**Migration 1250 drops the three anon-broad `bookings`/`user_availability`/`event_types` RLS policies, proven safe by a production-safe, transaction-scoped real-DB test that simulates the post-migration policy state without ever mutating live data.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-16T01:24:21Z
- **Tasks:** 2
- **Files modified:** 2 (both new)

## Accomplishments
- Closed the CAL-04 cross-tenant exposure: today's live `bookings_public_insert` (`WITH CHECK (true)`), `user_availability_public_select` (`USING (true)`), and `event_types_public_select` (`active = true OR org...`) policies let anyone holding the public anon key insert arbitrary bookings or enumerate every org's availability/event types.
- Wrote `tests/calendar-rls.test.ts`, a real-Postgres test proving: anon cannot INSERT into `bookings`; anon SELECTs on `user_availability`/`event_types` return empty; authenticated org members retain full read access to their own org's rows on all three tables (regression proof that the surviving `FOR ALL` org-scoped policies are untouched).
- Wrote `supabase/migrations/1250_calendar_rls_least_privilege.sql` with the exact three `DROP POLICY IF EXISTS` statements — not yet applied to production (Plan 126-06 applies it).
- `npm run build` passes with no new type errors.

## Task Commits

Each task was committed atomically:

1. **Task 1: Write the real-DB RLS negative test** - `17b3d442` (test)
2. **Task 2: Write migration 1250 — drop the three anon-broad policies** - `c68f7fc9` (feat)

**Plan metadata:** _(this commit)_

## Files Created/Modified
- `tests/calendar-rls.test.ts` - Real-DB, transaction-scoped RLS proof for CAL-04 (4 tests, soft-skips without `SUPABASE_DB_URL`/`DATABASE_URL`)
- `supabase/migrations/1250_calendar_rls_least_privilege.sql` - Drops `bookings_public_insert`, `user_availability_public_select`, `event_types_public_select`; not yet applied to production

## Decisions Made

**Test mechanism diverges from the plan's literal `tests/rls-isolation.test.ts` supabase-js pattern.** The plan's `<action>` described signing in a real anon Supabase client and calling `.insert()`/`.select()` directly against the project in `.env.local`. That `.env.local` points at production, and migration 1250 is explicitly not applied there until Plan 126-06. Running the literal pattern right now would have exercised *today's* live policies — meaning the anon INSERT test would actually succeed (today's `bookings_public_insert` still allows it), writing an attacker-shaped row into the real `bookings` table, and the anon SELECT tests would return real cross-org data instead of empty results. That's the exact prod-mutation the orchestrator's `<important_notes>` explicitly prohibited ("anon-key negative tests must not mutate prod state" / "transactional (BEGIN…ROLLBACK) ... per tests/contact-identity-trigger.test.ts").

Resolution: reused this same worktree's own established precedent — `tests/calendar-overlap-constraint.test.ts` (Plan 126-03, CAL-02) — which already solved an identical problem (proving a not-yet-applied migration's effect against a production database with zero persisted footprint) via a single `BEGIN` → apply the migration's DDL verbatim → exercise → `ROLLBACK` transaction. For RLS specifically, "exercise as anon/authenticated" is done with `SET LOCAL ROLE anon|authenticated` plus `set_config('request.jwt.claims', ..., true)`, which is Supabase's own documented mechanism for testing RLS policies from a raw Postgres session (this is exactly what PostgREST does internally for supabase-js clients). SAVEPOINTs wrap each per-role probe so a rejected write doesn't abort the outer transaction. The suite proves the *identical* behavior the plan asked for — anon blocked, authenticated unaffected — just without any window where it could touch real production rows.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Real-DB test mechanism changed from live supabase-js clients to an in-transaction pg.Client simulation**
- **Found during:** Task 1 (writing `tests/calendar-rls.test.ts`)
- **Issue:** The plan's literal action (mirror `tests/rls-isolation.test.ts`'s live anon/authenticated supabase-js client pattern) would, against the current unmigrated production database, actually succeed at inserting an attacker-controlled row into `bookings` and reading real cross-org `user_availability`/`event_types` data — violating the orchestrator's explicit "must not mutate prod state" / "transactional (BEGIN…ROLLBACK)" constraint, and risking a real data-integrity incident during plan execution.
- **Fix:** Rewrote the test to run entirely inside one Postgres transaction opened with `pg.Client` (matching the `tests/calendar-overlap-constraint.test.ts` precedent from Plan 126-03): apply migration 1250's `DROP POLICY` statements verbatim, seed fixtures from an existing single-org member (no synthetic `auth.users` rows), exercise each policy via `SET LOCAL ROLE anon|authenticated` + `request.jwt.claims` inside per-test `SAVEPOINT`s, then `ROLLBACK` the whole transaction in `afterAll` — guaranteeing zero persisted writes regardless of pass/fail.
- **Files modified:** `tests/calendar-rls.test.ts`
- **Verification:** `npx vitest run tests/calendar-rls.test.ts` — 4/4 passing, `git status --short` clean after the run (no stray rows, confirmed via the test's own admin-context check plus a full `git status` pass)
- **Committed in:** `17b3d442` (Task 1 commit)

**2. [Rule 1 - Bug] Fixture user selection could resolve to the wrong org under `get_current_org_id()`**
- **Found during:** Task 1, first test run — test 4 (authenticated org member regression) failed with `expected [] to have a length of 1`
- **Issue:** The initial fixture query picked the first `org_members` row by `created_at`, without accounting for `get_current_org_id()`'s resolution order (`user_active_org` override first, `org_members` fallback second). If that user belonged to more than one org, or had an active-org override pointing elsewhere, the authenticated probe would resolve to a different org than the one fixtures were seeded into, and the "sees its own org's rows" assertions would fail even though RLS itself was working correctly.
- **Fix:** Restricted fixture selection to an `org_members` row for a user who belongs to exactly one org (`(SELECT COUNT(*) FROM org_members om2 WHERE om2.user_id = om.user_id) = 1`), which makes `get_current_org_id()`'s resolution deterministic regardless of `user_active_org` state.
- **Files modified:** `tests/calendar-rls.test.ts`
- **Verification:** Re-ran `npx vitest run tests/calendar-rls.test.ts` — all 4 tests green
- **Committed in:** `17b3d442` (Task 1 commit, fixed before the initial commit — no separate fix commit needed)

---

**Total deviations:** 2 auto-fixed (1 missing-critical/safety, 1 bug)
**Impact on plan:** Both changes were necessary to make the test safe to run against a live production database and to make its assertions correct; the *behavior being proven* (anon blocked, authenticated org members unaffected) is unchanged from the plan's intent. No scope creep — migration 1250's SQL content is byte-identical to the plan's `<action>` block.

## Issues Encountered
None beyond the two deviations documented above.

## User Setup Required

None - migration 1250 is intentionally NOT applied to production by this plan (Plan 126-06 applies it, per an operator checkpoint). No env/config changes required.

## Next Phase Readiness

- Migration 1250 is reviewed, committed, and ready for Plan 126-06 to apply it to production alongside 1249.
- `tests/calendar-rls.test.ts` will need re-running with a live (non-transactional) sanity check after 126-06 applies the migration, to confirm production's actual PostgREST-layer behavior matches this transaction-scoped simulation — no code change expected, just a confirmation step.
- CAL-01, CAL-02, CAL-03 (the other three requirements in this phase) are handled by sibling plans in `126-booking-trust-boundary`; no blockers from this plan.

---
*Phase: 126-booking-trust-boundary*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: tests/calendar-rls.test.ts
- FOUND: supabase/migrations/1250_calendar_rls_least_privilege.sql
- FOUND commit: 17b3d442 (test)
- FOUND commit: c68f7fc9 (feat)

---
phase: 129-provider-synchronization-integrity
plan: 03
subsystem: database
tags: [rls, postgres, multi-tenancy, google-calendar, integrations, vitest, supabase]

# Dependency graph
requires:
  - phase: 126-booking-trust-boundary
    provides: tests/calendar-rls.test.ts's SAVEPOINT-based real-DB RLS testing pattern (SET LOCAL ROLE + request.jwt.claims, transaction-wrapped, soft-skip)
provides:
  - "tests/integrations-rls.test.ts — real-DB regression proof that integrations table org-ownership (SYNC-01) is RLS-enforced for google_calendar rows"
  - "supabase/migrations/1253_google_calendar_provider_enum.sql — the missing 'google_calendar' integration_provider enum value, now live in production"
affects: [130-ui-coherence, future-google-calendar-oauth-work]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-DB RLS regression tests wrap the entire suite in one BEGIN...ROLLBACK transaction with SAVEPOINT-scoped role switches (SET LOCAL ROLE + request.jwt.claims), matching tests/calendar-rls.test.ts — safe against this worktree's .env.local pointing at production"

key-files:
  created:
    - tests/integrations-rls.test.ts
    - supabase/migrations/1253_google_calendar_provider_enum.sql
  modified: []

key-decisions:
  - "Added migration 1253 (ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'google_calendar') as a Rule 1/3 deviation — production's enum never actually had this value despite src/types/database.ts claiming it did, which silently broke the Google Calendar OAuth connect flow for every org (zero google_calendar rows existed in production before this fix). This blocked Task 1's plan-specified fixture INSERTs and is a real, independent production defect fixed in-flight."

patterns-established:
  - "When a plan's `<interfaces>` block asserts something is true in the live DB based on a generated types file, verify against the actual DATABASE_URL/SUPABASE_DB_URL connection before trusting it — src/types/database.ts can drift from the real schema given this project's known migration-ledger desync."

requirements-completed: [SYNC-01]

# Metrics
duration: 15min
completed: 2026-07-16
---

# Phase 129 Plan 03: Integrations RLS Regression Proof Summary

**Real-DB, transaction-wrapped RLS regression test proving `integrations` org-ownership already works for `google_calendar` rows — and, in fixing a blocker to write it, discovered and fixed a live production bug where the `google_calendar` enum value never actually existed, silently breaking Google Calendar OAuth for every org.**

## Performance

- **Duration:** 15 min
- **Started:** ~2026-07-16T05:42:00Z
- **Completed:** 2026-07-16T05:56:59Z
- **Tasks:** 1
- **Files modified:** 2 (both created)

## Accomplishments
- `tests/integrations-rls.test.ts` proves 3 SYNC-01 truths against the real production database (transaction-wrapped, never committed): org A cannot read org B's `google_calendar` integrations row, anon cannot read any row, org A cannot forge-insert claiming org B's `organization_id`.
- Discovered and fixed a genuine, independent production bug: `integration_provider`'s enum never had `'google_calendar'` added on the live database, despite `src/types/database.ts`'s generated type listing it — every attempted Google Calendar OAuth connection (`src/app/api/google/calendar-callback/route.ts:73`) has been silently failing with a Postgres enum-cast error. Confirmed via direct query (`SELECT provider::text, count(*) FROM integrations GROUP BY provider::text`) showing zero `google_calendar` rows existed anywhere in production.
- Applied `supabase/migrations/1253_google_calendar_provider_enum.sql` (idempotent `ALTER TYPE ... ADD VALUE IF NOT EXISTS`) directly to production, verified the enum now includes `'google_calendar'`, and recorded it in `supabase_migrations.schema_migrations` (version `1253`) to keep the ledger consistent for future MCP/CLI operations.

## Task Commits

Each task was committed atomically:

1. **Task 1: Real-DB RLS regression test proving integrations org-ownership for google_calendar** - `20e87e23` (test, includes the Rule 1/3 migration fix required to unblock it)

**Plan metadata:** (this commit, following)

## Files Created/Modified
- `tests/integrations-rls.test.ts` - Real-DB, transaction-wrapped (SAVEPOINT + final ROLLBACK) RLS regression suite; 3 tests, soft-skips without `SUPABASE_DB_URL`/`DATABASE_URL`
- `supabase/migrations/1253_google_calendar_provider_enum.sql` - Adds the missing `'google_calendar'` value to `public.integration_provider`, applied and verified live in production

## Decisions Made
- Fixed the missing enum value in production rather than working around it (e.g., testing against a different provider literal) because the plan's task explicitly specifies `provider = 'google_calendar'` in its fixture INSERTs, and the gap was a genuine blocking production bug directly in scope of SYNC-01 (Google Calendar org ownership) — not an unrelated pre-existing issue to defer.
- Applied the migration outside the test's own rollback transaction (autocommitted via a separate connection) since `ALTER TYPE ... ADD VALUE` values cannot be used within the same transaction that creates them in Postgre before commit; the test's transaction runs afterward against the now-committed schema, exactly mirroring how a real migration precedes any test suite that depends on it.
- Manually inserted the migration's version into `supabase_migrations.schema_migrations` (per this project's documented ledger-desync convention — MCP/`db push` history has been out of sync repeatedly per project memory) so the applied state is discoverable by future tooling.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug / Rule 3 - Blocking] Production `integration_provider` enum was missing `'google_calendar'`, breaking Google Calendar OAuth connect for every org**
- **Found during:** Task 1 (writing the fixture `INSERT`s the plan specifies verbatim)
- **Issue:** `src/types/database.ts`'s generated `integration_provider` union type lists `'google_calendar'`, and 129-RESEARCH.md's interfaces block asserted (with HIGH confidence, citing that same generated type) that this value "is a valid `integration_provider` enum value in the live database." Querying the actual production database directly (`SELECT enumlabel FROM pg_enum ...`) showed this was false — the enum only had `gohighlevel, twilio, calcom, custom_webhook, openai, anthropic, openrouter, vapi, manychat, google_contacts, telegram, zernio, resend, xkedule`. No migration file in the repo ever added `'google_calendar'`. Cross-checking `SELECT provider::text, count(*) FROM integrations GROUP BY provider::text` confirmed zero `google_calendar` rows exist in production — consistent with every attempted OAuth connection failing with `invalid input value for enum integration_provider: "google_calendar"` at `src/app/api/google/calendar-callback/route.ts:73`'s upsert.
- **Fix:** Added `supabase/migrations/1253_google_calendar_provider_enum.sql` with an idempotent `ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'google_calendar'`, applied directly to production via a dedicated autocommitting connection (outside the test's own transaction, since a value added by `ALTER TYPE ... ADD VALUE` cannot be used within the same transaction that creates it), then verified via `pg_enum` that the value is present and manually recorded `version = '1253'` in `supabase_migrations.schema_migrations` to keep the ledger consistent with this project's documented desync-mitigation convention (project memory: "aplicar migrações via MCP apply_migration, nunca db push").
- **Files modified:** `supabase/migrations/1253_google_calendar_provider_enum.sql` (new)
- **Verification:** `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON e.enumtypid = t.oid WHERE t.typname = 'integration_provider'` now includes `'google_calendar'`; `tests/integrations-rls.test.ts`'s 3 tests all pass against the real DB (previously failed with the enum-cast Postgres error at fixture setup, `error: invalid input value for enum integration_provider: "google_calendar"`); post-test query confirms zero residual `google_calendar` rows in production (the test's own transaction rolled back cleanly).
- **Committed in:** `20e87e23` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug/blocking, dual-tagged since it is both a genuine production defect and a hard blocker for this task's literal fixture data)
**Impact on plan:** The plan's own premise ("129-RESEARCH.md corrects a premise... no migration is needed") turned out to be correct for the *RLS/org-ownership* half of SYNC-01, but the research's supporting evidence for `'google_calendar'` being a valid live enum value was itself wrong (it trusted the generated TypeScript type rather than querying the live database). This plan still required exactly one migration — not for org-ownership (which was indeed already correct), but to make the `google_calendar` provider literal usable at all. This is a meaningful, in-scope correction, not scope creep: without it, Google Calendar integration has been non-functional in production, and this plan's own acceptance criteria could not otherwise be met.

## Issues Encountered
None beyond the deviation documented above — the RLS policies themselves (`integrations_select/insert/update/delete`, migration 002) worked exactly as researched once the enum blocker was cleared; zero code or policy changes were needed for the org-ownership regression proof itself.

## User Setup Required
None - no external service configuration required. (The production Google Calendar OAuth connect flow will now function for orgs that attempt it, as a side effect of the enum fix — no separate operator action is needed to activate this.)

## Next Phase Readiness
- SYNC-01's org-ownership clause now has a real, CI-checkable regression proof (`tests/integrations-rls.test.ts`) — a future policy regression on `integrations` will fail this suite instead of silently reopening cross-tenant Google Calendar credential access.
- The previously-latent production defect (Google Calendar connect flow silently failing for every org) is now fixed and live; no operator action needed, but worth surfacing that Google Calendar connections should now start succeeding where they previously could not.
- SYNC-01's remaining two gaps identified by 129-RESEARCH.md (Gap 1: `conflict_calendar_ids` not honored by `fetchBusyTimes` — addressed by Plan 129-01 per STATE.md; Gap 2: `google_event_id` not persisted) and SYNC-02 (Xkedule/GHL lifecycle conformance) are out of this plan's scope and tracked by sibling plans 129-02/04/05/06.

---
*Phase: 129-provider-synchronization-integrity*
*Completed: 2026-07-16*

## Self-Check: PASSED

- FOUND: tests/integrations-rls.test.ts
- FOUND: supabase/migrations/1253_google_calendar_provider_enum.sql
- FOUND: commit 20e87e23

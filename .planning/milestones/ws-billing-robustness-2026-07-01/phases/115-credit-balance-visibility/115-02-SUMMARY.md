---
phase: 115-credit-balance-visibility
plan: 02
subsystem: database
tags: [supabase, realtime, postgres, migration, billing]

# Dependency graph
requires:
  - phase: 115-credit-balance-visibility (Plan 01)
    provides: getCopilotBalance() shape and credits visibility logic that this Realtime publication makes live-updatable
provides:
  - copilot_credit_balances added to the supabase_realtime publication (idempotent migration 1226)
  - Precedent confirmation of the CLI-auth/migration-history desync gap (Management API apply path) for future migrations in this environment
affects: [115-credit-balance-visibility (Plan 03 - CreditsIndicator component depends on this for CRB-02 live updates)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Idempotent ALTER PUBLICATION via DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$ (3rd use of this pattern, after migrations 024 and 1206)"

key-files:
  created:
    - supabase/migrations/1226_copilot_credits_realtime.sql
  modified: []

key-decisions:
  - "Applied migration via Supabase Management API instead of `npx supabase db push`, due to a pre-existing CLI auth/migration-history desync (same gap that affected Phase 114's migrations 1224/1225) — not a new issue introduced by this plan"

patterns-established:
  - "Third precedent for idempotent Realtime publication migrations (024, 1206, 1226) — safe to copy verbatim for future tables needing postgres_changes support"

requirements-completed: [CRB-02]

# Metrics
duration: 15min
completed: 2026-07-01
---

# Phase 115 Plan 02: Realtime Publication for Copilot Credit Balances Summary

**Idempotent `ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_credit_balances` migration, applied to the remote Supabase project via the Management API, enabling live balance updates for the TopBar CreditsIndicator (Plan 03).**

## Performance

- **Duration:** ~15 min (including a blocked/checkpoint interval waiting for the coordinator's Management API apply)
- **Started:** 2026-07-01
- **Completed:** 2026-07-01
- **Tasks:** 1 completed
- **Files modified:** 1 created

## Accomplishments
- Created `supabase/migrations/1226_copilot_credits_realtime.sql`, copying the exact idempotent `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$` wrapper from migrations `024_chat_realtime_publication.sql` and `1206_call_logs_realtime.sql`, targeting `public.copilot_credit_balances`
- Confirmed migration number 1226 was free (highest existing file was `1225_metering_reason.sql`; re-verified via `ls` at execution time per RESEARCH.md Open Question 3)
- Migration applied and verified live on the remote database (project `mwklvkmggmsintqcqfvu`): `select tablename from pg_publication_tables where pubname='supabase_realtime' and tablename='copilot_credit_balances'` returns the row
- Confirmed `src/types/database.ts` requires no regeneration — this migration only alters publication membership, no new columns/tables/RPCs (verified via `grep -n "copilot_credit_balances" src/types/database.ts`, unchanged)

## Task Commits

1. **Task 1: Create and apply the Realtime publication migration** - `445d6aa6` (feat)

**Plan metadata:** (this commit, following this SUMMARY)

## Files Created/Modified
- `supabase/migrations/1226_copilot_credits_realtime.sql` - Idempotent `ALTER PUBLICATION supabase_realtime ADD TABLE public.copilot_credit_balances`, enabling `postgres_changes` subscriptions on this table

## Decisions Made
- Applied the migration via the Supabase Management API rather than `npx supabase db push`, because `db push` failed with a migration-history desync error (remote migration versions not found in local migrations directory) — not the previously-seen 403, but a related pre-existing environment gap. Root cause (per coordinator): migrations 1224 and 1225 (Phase 114) were also applied via the Management API because the CLI had no authenticated session for this project ref; Supabase recorded those under synthetic timestamp-style versions instead of the literal filenames, desyncing `supabase migration list`. This is a known, pre-existing operational gap unrelated to this plan's scope — flagged for the user to address separately (e.g. `supabase login` + `supabase migration repair`), not fixed here.

## Deviations from Plan

None beyond the documented auth/CLI environment gap, which the plan itself anticipated and instructed to escalate rather than work around. No workarounds (manual SQL via alternate client, `migration repair`, `db pull`) were attempted locally, per the plan's explicit instruction — the orchestrating session applied the migration via its own Management API access and confirmed it live.

## Issues Encountered
- `npx supabase db push` failed with "Remote migration versions not found in local migrations directory" (a migration-history desync, distinct from the previously-documented 403). Stopped immediately and returned a structured checkpoint per the plan's explicit instruction, rather than attempting `migration repair`/`db pull`/direct psql. The orchestrating coordinator applied migration 1226 via the Supabase Management API and confirmed it live in `pg_publication_tables`; execution then resumed to commit and document.

## User Setup Required

None for this plan's own scope — the migration is applied and live. However, the underlying CLI auth/migration-history desync (affecting local `npx supabase db push` for this project) remains unresolved as a standing environment gap; the user should run `supabase login` with correct credentials for project `mwklvkmggmsintqcqfvu` and then `supabase migration repair --status reverted 20260615153927 20260625201926 20260701122750 20260701122808` when convenient, to restore normal CLI push capability for future migrations. Not a blocker for this phase.

## Next Phase Readiness
- Plan 03 (`CreditsIndicator` component) can now safely rely on `postgres_changes` events firing for `copilot_credit_balances` UPDATE events — the Realtime publication prerequisite (CRB-02) is live and verified.
- No blockers for Plan 03.

---
*Phase: 115-credit-balance-visibility*
*Completed: 2026-07-01*

## Self-Check: PASSED

- FOUND: `supabase/migrations/1226_copilot_credits_realtime.sql`
- FOUND: `.planning/workstreams/billing-robustness/phases/115-credit-balance-visibility/115-02-SUMMARY.md`
- FOUND: commit `445d6aa6`

---
phase: 126-booking-trust-boundary
plan: 06
status: complete
completed: 2026-07-15
requirements: [CAL-02, CAL-04]
---

# Plan 126-06 Summary: Apply Migrations 1249/1250 to Production

## What Happened

Operator checkpoint executed by the orchestrator via Supabase MCP `apply_migration` against project `mwklvkmggmsintqcqfvu` (production CRM), per the project constraint (never `supabase db push`).

1. **Pre-flight audit (CAL-02):** the overlap audit query from migration 1249's header ran against production **before** apply — returned **0 rows** (no pre-existing overlapping confirmed native bookings). Go decision taken autonomously per operator's standing instruction for this run.
2. **Applied `1249_bookings_organizer_overlap_guard`:** `btree_gist` extension, `bookings.organizer_user_id` (backfilled — 0 NULLs after apply), `trg_bookings_set_organizer` trigger, `bookings_valid_interval` CHECK, `bookings_no_organizer_overlap` EXCLUDE USING gist (half-open ranges, confirmed+native scope).
3. **Applied `1250_calendar_rls_least_privilege`:** dropped `bookings_public_insert`, `user_availability_public_select`, `event_types_public_select`.
4. **Post-apply verification (SQL):** both constraints present in `pg_constraint`; trigger present; the three anon policies return zero rows from `pg_policies`; `organizer_user_id` backfill complete.
5. **Real-DB test suites against production schema:** `npx vitest run tests/calendar-overlap-constraint.test.ts tests/calendar-rls.test.ts` — **8/8 passed** (not soft-skipped).

## Notes

- MCP `apply_migration` records a timestamp-versioned entry in the remote migration ledger (known desync vs. numeric file names — accepted project-wide since migration 1225+).
- The migration files remain in `supabase/migrations/` as the reviewable source of truth.

## Self-Check: PASSED

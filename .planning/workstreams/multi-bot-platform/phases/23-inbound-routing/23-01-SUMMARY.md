---
phase: 23-inbound-routing
plan: 01
subsystem: manychat-routing
tags: [migration, types, tdd, red-tests, manychat, routing]
dependency_graph:
  requires: []
  provides:
    - supabase/migrations/027_manychat_rules.sql
    - manychat_rules TypeScript types
    - manychat_events.Update widening
    - Wave 0 RED test stubs (ROUTING-01..04)
  affects:
    - Wave 2 plans (23-02 resolve-rule, dispatch-event modules)
    - Wave 3 plan (23-03 server actions)
    - Wave 4 plan (23-04 webhook integration)
tech_stack:
  added: []
  patterns:
    - deferred FK backfill via ALTER TABLE in subsequent migration
    - Wave 0 RED test stubs with vi.resetModules() + dynamic import per test
    - Service-role Update widening with SQL-layer enforcement comment
key_files:
  created:
    - supabase/migrations/027_manychat_rules.sql
    - tests/manychat/rule-actions.test.ts
    - tests/manychat/resolve-rule.test.ts
    - tests/manychat/dispatch-event.test.ts
  modified:
    - src/types/database.ts
decisions:
  - manychat_rules uses ON DELETE RESTRICT for tool_config_id (rules block tool deletion — surfaced as UI warning in Phase 26)
  - manychat_events.matched_rule_id and action_log_id use ON DELETE SET NULL (preserves audit history)
  - priority is ASC order (lower number = first match wins)
  - manychat_events.Update widened at TypeScript layer only; SQL-layer RLS enforces append-only for authenticated client
metrics:
  duration: 12m
  completed: 2026-05-06T16:23Z
  tasks_completed: 3
  tasks_total: 3
  files_created: 4
  files_modified: 1
---

# Phase 23 Plan 01: Inbound Routing Foundation Summary

**One-liner:** manychat_rules migration with deferred FK backfill, widened TypeScript types, and 3 RED Wave 0 test stubs covering all 4 ROUTING requirements.

## What Was Built

### Task 1 — Migration 027_manychat_rules.sql

Created `supabase/migrations/027_manychat_rules.sql` which does two things:

1. **Creates `manychat_rules` table** with columns: `id`, `org_id`, `channel_id`, `event_type`, `condition` (JSONB, default `{}`), `tool_config_id`, `is_active`, `priority`, `created_at`, `updated_at`. Includes:
   - RLS enabled with `org_isolation` policy using `get_current_org_id()`
   - `trg_manychat_rules_updated_at` trigger reusing existing `update_updated_at()` function
   - Composite index `idx_manychat_rules_match` on `(org_id, channel_id, event_type, is_active, priority)` — matches the dispatcher hot-path WHERE/ORDER BY

2. **Backfills deferred FKs on `manychat_events`** that Phase 22 (migration 026) could not add because `manychat_rules` and `action_logs` didn't exist at that time:
   - `manychat_events_matched_rule_id_fkey` → `manychat_rules(id)` ON DELETE SET NULL
   - `manychat_events_action_log_id_fkey` → `action_logs(id)` ON DELETE SET NULL

### Task 2 — database.ts widening

Two edits to `src/types/database.ts`:

1. **Added `manychat_rules:` table block** immediately before `manychat_events:` (alphabetical order, also ensures FK referencing manychat_rules from manychat_events is defined after the target). Covers full Row/Insert/Update/Relationships with FK entries for `org_id`, `channel_id`, `tool_config_id`.

2. **Widened `manychat_events.Update`** from `Record<string, never>` to:
   ```typescript
   Update: {
     status?: 'matched' | 'unmatched' | 'error'
     action_log_id?: string | null
     matched_rule_id?: string | null
   }
   ```
   Added explanatory comment that this widening exists for the service-role dispatcher only; RLS enforces append-only at the SQL layer for authenticated clients.

3. **Added two new Relationships** to `manychat_events` for the newly-backfilled FKs.

`npm run build` exits 0 — TypeScript compiles cleanly.

### Task 3 — Wave 0 RED Test Stubs

Three new test files in `tests/manychat/`:

| File | Requirements | Tests |
|---|---|---|
| `rule-actions.test.ts` | ROUTING-01, ROUTING-02 | 8 tests: createManychatRule insert shape, org_id not set, auth error; updateManychatRule partial patch, .eq() call, auth error; deleteManychatRule .eq() call, auth error |
| `resolve-rule.test.ts` | ROUTING-03 | 7 tests: null on empty rules, empty condition matches all, priority order, no match, is_active filter, nested containment, nested mismatch |
| `dispatch-event.test.ts` | ROUTING-03, ROUTING-04 | 6 tests: early return on no match, executeAction call shape, error on null tool, error on executeAction throw, action_log_id linking with status=matched, synthetic vapi_call_id prefix |

All 3 files fail with `ERR_MODULE_NOT_FOUND` — correct RED state. Wave 2 will create the target modules and flip these GREEN.

## RED State Confirmation

```
Test Files  3 failed (3)
      Tests  15 failed (15)
  Error: Cannot find package '@/app/(dashboard)/integrations/manychat/rule-actions'
  Error: Cannot find package '@/lib/manychat/resolve-rule'
  Error: Cannot find package '@/lib/manychat/dispatch-event'
```

These are module-not-found errors, not assertion errors. This is the correct Wave 0 RED state.

## Build Status

`npm run build` exits 0. TypeScript compile clean.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. This plan creates schema/types/test infrastructure only — no UI data rendering or stub values.

## Self-Check: PASSED

- FOUND: supabase/migrations/027_manychat_rules.sql
- FOUND: src/types/database.ts (modified)
- FOUND: tests/manychat/rule-actions.test.ts
- FOUND: tests/manychat/resolve-rule.test.ts
- FOUND: tests/manychat/dispatch-event.test.ts
- FOUND: commit ad95bc1 (migration)
- FOUND: commit c7d9637 (database.ts)
- FOUND: commit 2cb60cf (test stubs)
- npm run build: EXIT 0
- vitest run 3 test files: 3 failed (ERR_MODULE_NOT_FOUND — correct RED)

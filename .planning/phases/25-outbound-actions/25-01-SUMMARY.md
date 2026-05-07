---
phase: 25-outbound-actions
plan: 01
subsystem: testing, database, api
tags: [manychat, vitest, supabase, tdd, postgresql, action-engine, migrations]

# Dependency graph
requires:
  - phase: 22-manychat-foundation
    provides: manychat_channels table, encrypted credential storage, webhook ingestion
  - phase: action-engine
    provides: executeAction dispatcher, integrations table, action_type enum
provides:
  - Wave 0 RED tests for 4 ManyChat outbound executors (set-field, add-tag, trigger-flow, send-message)
  - RED test for shared manychat client wrapper (client.ts)
  - RED test for dispatcher routing across 4 new action_type cases
  - Bridge invariant tests (channel-actions.test.ts extensions)
  - Dispatch-event canary test for manychat_add_tag routing
  - Migration 028 — 4 new action_type enum values + FK column + backfill
  - database.ts type widening (action_type + manychat_channel_id)
  - createManychatChannel bridge sync (dual insert + compensating delete)
affects: [25-outbound-actions-plan-02, action-engine, integrations, tool_configs]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wave 0 TDD: RED tests written before production code exists"
    - "Bridge sync: createManychatChannel writes both manychat_channels + integrations atomically at application layer"
    - "Compensating delete: on bridge insert failure, channel row is deleted to maintain consistency"
    - "Reuse encrypted blob: bridge insert copies encrypted_api_key without re-encryption (preserves IV)"
    - "Organization_id resolution via org_members query in server actions"

key-files:
  created:
    - tests/manychat/client.test.ts
    - tests/manychat/set-field.test.ts
    - tests/manychat/add-tag.test.ts
    - tests/manychat/trigger-flow.test.ts
    - tests/manychat/send-message.test.ts
    - tests/manychat/execute-action-manychat.test.ts
    - supabase/migrations/028_manychat_outbound.sql
  modified:
    - tests/manychat/channel-actions.test.ts
    - tests/manychat/dispatch-event.test.ts
    - src/types/database.ts
    - src/lib/action-engine/execute-action.ts
    - src/app/(dashboard)/integrations/manychat/actions.ts
    - src/app/(dashboard)/tools/[toolConfigId]/page.tsx

key-decisions:
  - "Bridge sync uses org_members query to resolve organization_id — consistent with integrations/actions.ts pattern (not RPC)"
  - "Temporary stub in execute-action.ts throws 'ManyChat executor not yet wired' — Plan 02 replaces these with real calls"
  - "ACTION_TYPE_LABELS in tools/[toolConfigId]/page.tsx extended with 4 new ManyChat labels to satisfy Record<ActionType, string>"

patterns-established:
  - "Wave 0 TDD: all test files fail RED today because executor modules don't exist yet"
  - "Bridge invariant testing: buildBridgeMockSupabase helper extends the manychat_channels mock to cover integrations + org_members tables"

requirements-completed:
  - OUTBOUND-01
  - OUTBOUND-02
  - OUTBOUND-03
  - OUTBOUND-04

# Metrics
duration: 47min
completed: 2026-05-07
---

# Phase 25 Plan 01: Outbound Actions Foundation Summary

**Wave 0 RED tests for 4 ManyChat outbound executors + migration 028 (4 enum values + bridge FK + backfill) + createManychatChannel dual-insert with compensating delete**

## Performance

- **Duration:** 47 min
- **Started:** 2026-05-07T11:04:52Z
- **Completed:** 2026-05-07T11:51:00Z
- **Tasks:** 7
- **Files modified:** 11

## Accomplishments

- 6 new test files written (Wave 0 RED) — all fail with "Cannot find module" proving the contract surfaces are pinned before executors exist
- Migration 028 ships 4 standalone ALTER TYPE statements, FK column with ON DELETE CASCADE, partial unique index for one bridge row per org, and idempotent WHERE NOT EXISTS backfill
- createManychatChannel now writes both manychat_channels and integrations in sequence — reuses the encrypted blob without re-encryption and compensates with a delete if the bridge insert fails
- database.ts widened: 4 new action_type values across 3 surface points (Row/Insert/Update) + Enums + manychat_channel_id column on integrations Row/Insert/Update
- npm run build exits 0 — exhaustiveness check satisfied by a TODO(25-02) stub block in execute-action.ts

## Task Commits

1. **Task 1: Wave 0 RED tests for client.ts** - `886a3f1` (test)
2. **Task 2: Wave 0 RED tests for 4 executors** - `aba1c45` (test)
3. **Task 3: Wave 0 RED test for dispatcher routing** - `fd49328` (test)
4. **Task 4: Extend channel-actions + dispatch-event tests** - `99f2f8b` (test)
5. **Task 5: Migration 028** - `b385265` (chore)
6. **Task 6: Database types + executor stub** - `186d509` (feat)
7. **Task 7: createManychatChannel bridge sync** - `4ef8d56` (feat)

## Files Created/Modified

- `tests/manychat/client.test.ts` - RED tests for shared fetch wrapper (Bearer auth, AbortSignal, JSON body, 4xx throw)
- `tests/manychat/set-field.test.ts` - RED tests for setManychatField (OUTBOUND-01) — endpoint, missing params, field_value:0 accepted
- `tests/manychat/add-tag.test.ts` - RED tests for addManychatTag (OUTBOUND-02)
- `tests/manychat/trigger-flow.test.ts` - RED tests for triggerManychatFlow (OUTBOUND-03) — flow_ns JSDoc pitfall note
- `tests/manychat/send-message.test.ts` - RED tests for sendManychatMessage (OUTBOUND-04) — text→v2 convenience test
- `tests/manychat/execute-action-manychat.test.ts` - RED tests for dispatcher routing across all 4 new action_type cases + exhaustiveness check
- `tests/manychat/channel-actions.test.ts` - Extended with buildBridgeMockSupabase helper + 4 OUTBOUND-bridge tests (BR-1..BR-4); also updated buildMockSupabaseClient to support the new .select('id').single() chain on channel insert
- `tests/manychat/dispatch-event.test.ts` - Extended with manychat_add_tag canary in ROUTING-03 describe block
- `supabase/migrations/028_manychat_outbound.sql` - 4 standalone ALTER TYPE ADD VALUE, FK column, partial unique index, WHERE NOT EXISTS backfill, defensive FK index
- `src/types/database.ts` - integrations Row/Insert/Update + manychat_channel_id; tool_configs Row/Insert/Update action_type; Enums action_type (all widened)
- `src/lib/action-engine/execute-action.ts` - Temporary stub block for 4 new cases (TODO(25-02) marker required by Plan 02 task 4)
- `src/app/(dashboard)/integrations/manychat/actions.ts` - createManychatChannel refactored to .select('id').single() + bridge insert + compensating delete; deleteManychatChannel gets ON DELETE CASCADE comment
- `src/app/(dashboard)/tools/[toolConfigId]/page.tsx` - ACTION_TYPE_LABELS extended with 4 new ManyChat entries (Rule 2 auto-fix)

## Decisions Made

- **org_members for organization_id resolution:** TypeScript's integrations Insert type requires `organization_id: string` (not optional). Used `org_members.select('organization_id').eq('user_id', user.id)` to resolve it — consistent with integrations/actions.ts existing pattern. The RLS WITH CHECK still enforces correctness at the DB layer.
- **ACTION_TYPE_LABELS extended:** `src/app/(dashboard)/tools/[toolConfigId]/page.tsx` uses `Record<ToolConfigRow['action_type'], string>` which requires all enum values. Added 4 ManyChat labels as part of the type widening (auto-fix Rule 2).
- **buildMockSupabaseClient refactored:** The existing CHANNEL-01 tests used the old insert pattern (no `.select('id').single()`). The mock helper was updated to chain properly. All 5 original CHANNEL-* tests still pass.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical] Extended ACTION_TYPE_LABELS in tools/[toolConfigId]/page.tsx**
- **Found during:** Task 6 (database types + stub)
- **Issue:** `Record<ToolConfigRow['action_type'], string>` is now a 10-value union; the existing 6-entry object literal caused a TypeScript compile error missing the 4 new ManyChat entries
- **Fix:** Added `manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message` to ACTION_TYPE_LABELS with human-readable labels
- **Files modified:** `src/app/(dashboard)/tools/[toolConfigId]/page.tsx`
- **Verification:** `npm run build` exits 0
- **Committed in:** `186d509` (Task 6 commit)

**2. [Rule 2 - Missing Critical] Updated buildMockSupabaseClient to support new insert chain**
- **Found during:** Task 7 (bridge sync implementation)
- **Issue:** createManychatChannel now uses `.insert({...}).select('id').single()` but the original test helper returned a plain resolved promise from `insert`, causing "select is not a function" errors on the CHANNEL-01 tests
- **Fix:** Updated `buildMockSupabaseClient` to return a proper chain object with `.select().single()` + added org_members + integrations table handlers
- **Files modified:** `tests/manychat/channel-actions.test.ts`
- **Verification:** All 20 channel-actions tests pass including 4 new OUTBOUND-bridge tests
- **Committed in:** `4ef8d56` (Task 7 commit)

**3. [Rule 1 - Bug] Used org_members query instead of RPC for organization_id**
- **Found during:** Task 7 (bridge sync implementation)
- **Issue:** Initial implementation used `supabase.rpc('get_current_org_id')` but the mock supabase client in tests doesn't have `rpc` — caused test failures with "supabase.rpc is not a function"
- **Fix:** Switched to `supabase.from('org_members').select('organization_id').eq('user_id', user.id).single()` — same pattern as `integrations/actions.ts`, and the test mock handles `from()` calls
- **Files modified:** `src/app/(dashboard)/integrations/manychat/actions.ts`
- **Verification:** All 20 channel-actions tests pass; npm run build exits 0
- **Committed in:** `4ef8d56` (Task 7 commit)

---

**Total deviations:** 3 auto-fixed (2 missing critical, 1 bug)
**Impact on plan:** All auto-fixes necessary for correctness and build passing. No scope creep.

## Issues Encountered

None beyond the deviations documented above.

## User Setup Required

`npx supabase db push` is required before live UAT in Plan 03. This applies migration 028 (and any pending migrations 018-020 noted in MEMORY.md). Unit tests pass without the pushed DB (they mock supabase), but live integration testing requires the schema to be current.

## Known Stubs

- `src/lib/action-engine/execute-action.ts` — 4 case arms for `manychat_set_field`, `manychat_add_tag`, `manychat_trigger_flow`, `manychat_send_message` throw `'ManyChat executor not yet wired: ${actionType}'`. Plan 02 Task 4 replaces these with real executor calls. The TODO(25-02) comment marks the exact location.

## Next Phase Readiness

- Plan 02 can now create the 4 executor files (`src/lib/manychat/client.ts`, `set-field.ts`, `add-tag.ts`, `trigger-flow.ts`, `send-message.ts`) and the dispatcher switch arms — the Wave 0 tests will flip from RED to GREEN
- The bridge infrastructure is in place — `tool_configs.integration_id → integrations` joins will resolve correctly once DB is pushed
- `npm run build` is green — no type debt carried forward

---
*Phase: 25-outbound-actions*
*Completed: 2026-05-07*

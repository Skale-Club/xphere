---
phase: 137-product-cards-order-status
plan: 03
subsystem: commerce
tags: [medusa, action-dispatcher, order-status, anti-idor]

# Dependency graph
requires:
  - phase: 137-02
    provides: getOrderStatus(params, creds, ctx) executor (pinned cus only, R9 closed, §4.2 render)
provides:
  - real medusa_get_order_status dispatch in execute-action.ts (the last commerce stub turned real)
  - ACTION_DESCRIPTIONS.medusa_get_order_status (DATA-not-instructions framing)
  - workflows/spec.ts medusa_get_order_status NODE (display_id-only params_schema)
affects: [137-05-widget-renderer]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "The exhaustive execute-action.ts switch's 'not yet built' stub group (introduced 132-04, last member removed 137-03) is now fully empty -- all nine medusa_* action types dispatch to real executors"

key-files:
  created: []
  modified:
    - src/lib/action-engine/execute-action.ts
    - src/lib/agent-runtime/run-agent.ts
    - src/lib/workflows/spec.ts
    - tests/medusa-dispatch.test.ts
    - tests/medusa-wiring.test.ts
    - tests/medusa-spec.test.ts

key-decisions:
  - "The pre-existing medusa-dispatch.test.ts assertion 'execute-action.ts stubs only medusa_get_order_status' asserted on text this plan deliberately removes (the stub string). Updated it in place (same test, new assertions: no stub text remains, real dispatch call present) rather than leaving a permanently-red test -- tracked as a deviation below since the plan's <action> block didn't explicitly call out this pre-existing test needing a rewrite."

requirements-completed: [UIX-02]

# Metrics
duration: 12min
completed: 2026-07-17
---

# Phase 137 Plan 03: Order Status Dispatch Wiring Summary

**medusa_get_order_status is now a real dispatch to getOrderStatus (the last of nine medusa_* action types to leave stub status), registered in ACTION_DESCRIPTIONS and workflows/spec.ts with a display_id-only params_schema — the exhaustive execute-action.ts switch compiles with zero placeholder cases remaining.**

## Performance

- **Duration:** 12 min
- **Started:** 2026-07-17T17:33:00Z
- **Completed:** 2026-07-17T17:39:20Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- `execute-action.ts`'s `medusa_get_order_status` case replaces the "not available yet" stub with a real dispatch mirroring the read-tools never-throw config-guard pattern: no org/supabase → friendly string, no medusa creds → friendly string, otherwise `getOrderStatus(params, medusaCreds, ctx)`.
- The exhaustive `default: { const _exhaustive: never = actionType; ... }` switch compiles unchanged — `npm run build` passes with zero `never` regressions.
- `ACTION_DESCRIPTIONS.medusa_get_order_status` frames the result as order DATA (never instructions), documents that only logged-in customers get results, and states the sole optional parameter is `display_id`.
- `workflows/spec.ts` gains a `medusa_get_order_status` NODE (`kind: 'action'`, `integration_required: ['medusa']`) whose `params_schema` exposes ONLY an optional `display_id: number` — no `customer_id`/`email`/`order_id`, matching the anti-IDOR contract (display_id alone is useless without the pinned `commerce.cus`).
- `medusa_get_order_status` is NOT added to `SIDE_EFFECTING_ACTIONS` or `COMMERCE_WRITE_ACTIONS` — it remains a pure read whose only budget is R9 (enforced inside the 137-02 executor).
- Tests extended: `tests/medusa-dispatch.test.ts` (getOrderStatus mock + routing assertion + no-creds friendly-string assertion), `tests/medusa-wiring.test.ts` (ACTION_DESCRIPTIONS key presence), `tests/medusa-spec.test.ts` (new `UIX-02` describe block: node shape, anti-IDOR params, provider-gated visibility).

## Task Commits

Each task was committed atomically:

1. **Task 1: real medusa_get_order_status dispatch in execute-action.ts** - `699fedf0` (feat)
2. **Task 2: ACTION_DESCRIPTIONS entry + spec.ts NODE + wiring/spec tests** - `e52f4988` (feat)

**Plan metadata:** (recorded with this SUMMARY commit)

## Files Created/Modified
- `src/lib/action-engine/execute-action.ts` - imports `getOrderStatus`; replaces the last medusa stub with a real dispatch under the same never-throw config-guard contract as the other medusa cases
- `src/lib/agent-runtime/run-agent.ts` - `ACTION_DESCRIPTIONS.medusa_get_order_status` entry
- `src/lib/workflows/spec.ts` - `medusa_get_order_status` NodeSpec at the end of the commerce (Medusa) NODES block
- `tests/medusa-dispatch.test.ts` - getOrderStatus mock, routing test, no-creds test, and a rewritten "no stubs remain" assertion (see Decisions)
- `tests/medusa-wiring.test.ts` - ACTION_DESCRIPTIONS key presence assertion
- `tests/medusa-spec.test.ts` - new `UIX-02` describe block covering node shape, anti-IDOR params, and provider-gated visibility

## Decisions Made
- Kept the pre-existing dispatch test named around the "stub" concept but rewrote its body/name to assert the post-137-03 reality (no stub text anywhere, real `getOrderStatus(params, medusaCreds, ctx)` call present) — see Deviations below.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated the stale stub-assertion test broken by this plan's own Task 1**
- **Found during:** Task 1 (real dispatch wiring)
- **Issue:** `tests/medusa-dispatch.test.ts` had a pre-existing test (`'execute-action.ts stubs only medusa_get_order_status...'`) asserting the literal stub text `'That commerce action is not available yet.'` was present in `execute-action.ts`. Task 1's own acceptance criteria required that exact string to be GONE (`grep -n "not available yet"` returns NOTHING), so leaving the old test as-is would leave it permanently red.
- **Fix:** Renamed/rewrote the test to assert the post-wiring reality: the `case 'medusa_get_order_status':` line still exists, the stub text is absent, and `getOrderStatus(params, medusaCreds, ctx)` is present, alongside the existing real-dispatch assertions for the other medusa executors.
- **Files modified:** tests/medusa-dispatch.test.ts
- **Verification:** `CI=true npx vitest run tests/medusa-dispatch.test.ts` — 19/19 passing.
- **Committed in:** 699fedf0 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug — a test whose assertions Task 1 necessarily invalidated).
**Impact on plan:** No scope creep; the fix was required for the plan's own acceptance criteria (stub text removed) to hold without leaving a broken test behind.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All nine `medusa_*` action types now dispatch to real executors — `execute-action.ts`'s "not yet built" stub group (introduced 132-04) is empty.
- UIX-02 is now fully satisfied end-to-end: `getOrderStatus` (137-02) is reachable by the LLM via `ACTION_DESCRIPTIONS` + the `workflows/spec.ts` NODE, wired through `execute-action.ts` (137-03).
- 137-05 (widget product-cards renderer) is independent of this plan (disjoint files) and can proceed on the same working tree.
- The live signed round trip against a running Stuscle backend remains E2E-deferred per 137-VALIDATION.md (unchanged from 137-02).

---
*Phase: 137-product-cards-order-status*
*Completed: 2026-07-17*

## Self-Check: PASSED

All created/modified files verified present on disk; both task commit hashes (699fedf0, e52f4988) verified present in git log.

---
phase: 135-wishlist-tools
plan: 02
subsystem: commerce
tags: [dispatcher, action-descriptions, workflow-spec, idempotency, medusa, wishlist]

# Dependency graph
requires:
  - phase: 135-wishlist-tools (135-01)
    provides: medusaAgentFetch signed transport, resolveWishlistOwner anti-IDOR resolution, addWishlistItem/removeWishlistItem/listWishlist never-throw executors
provides:
  - execute-action.ts real dispatch for medusa_wishlist_add/remove/list (never-throw friendly-string guard, getMedusaCredentialsForOrg lookup)
  - ACTION_DESCRIPTIONS entries for the 3 wishlist tools (prompt-injection-safe DATA framing)
  - workflows/spec.ts NodeSpec entries for the 3 wishlist tools (integration_required medusa, no owner params)
  - SIDE_EFFECTING_ACTIONS registration for medusa_wishlist_add/medusa_wishlist_remove (list excluded, COMMERCE_WRITE_ACTIONS untouched)
affects: [137-order-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Real-dispatch case-block wiring: mirror the cart-write block's never-throw guard (ctx?.organizationId/ctx?.supabase check -> getMedusaCredentialsForOrg -> per-action-type branch) for every subsequent medusa write/read tool group"
    - "SIDE_EFFECTING_ACTIONS vs COMMERCE_WRITE_ACTIONS split: idempotency wrapping and the cart-only per-turn/per-conversation write caps are two independent registries -- a write can need idempotency without joining the cart caps"

key-files:
  created: []
  modified:
    - src/lib/action-engine/execute-action.ts
    - src/lib/agent-runtime/idempotency.ts
    - src/lib/agent-runtime/run-agent.ts
    - src/lib/workflows/spec.ts
    - tests/medusa-dispatch.test.ts
    - tests/medusa-wiring.test.ts
    - tests/medusa-spec.test.ts

key-decisions:
  - "medusa_get_order_status is the ONLY remaining case in the 'not available yet' stub group after this plan -- reserved for Phase 137, comment updated to reflect the narrowed scope."
  - "The idempotency.ts comment documenting the wishlist-read exclusion deliberately avoids the literal substring 'medusa_wishlist_list' so the plan's own grep-based acceptance criterion (which asserts that exact string is ABSENT from the file) stays true even in prose."

patterns-established:
  - "Third generation of the same wiring shape (read tools in 132-04, cart writes in 134-02, wishlist in 135-02): stub group shrinks by exactly the tools implemented that wave, exhaustive switch keeps compiling, ACTION_DESCRIPTIONS + spec.ts NODES added together so a tool can never be selectable without also having a description."

requirements-completed: [WSL-01, WSL-02]

# Metrics
duration: 20min
completed: 2026-07-17
---

# Phase 135 Plan 02: Wishlist Dispatcher + Registry Wiring Summary

**Wired the three Wave-1 wishlist executors into `execute-action.ts`'s real dispatch, `ACTION_DESCRIPTIONS`, and `workflows/spec.ts` NODES, and registered add/remove (not list) in `SIDE_EFFECTING_ACTIONS` — the agent can now select and run `medusa_wishlist_add/remove/list` end-to-end, with `medusa_get_order_status` left as the sole remaining stub for Phase 137.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-17T19:15:00Z
- **Completed:** 2026-07-17T19:35:21Z
- **Tasks:** 2
- **Files modified:** 7

## Accomplishments
- `execute-action.ts` splits the old 4-case "not available yet" stub group: `medusa_wishlist_add/remove/list` now dispatch to `addWishlistItem`/`removeWishlistItem`/`listWishlist` behind the same never-throw guard (`ctx?.organizationId`/`ctx?.supabase` check → `getMedusaCredentialsForOrg` → friendly-string fallbacks) as the cart-write block; `medusa_get_order_status` is the only case left stubbed, and the exhaustive `default: never` switch still compiles with all nine `medusa_*` types handled (all real dispatch except the one Phase-137 stub).
- `idempotency.ts` adds `medusa_wishlist_add` and `medusa_wishlist_remove` to `SIDE_EFFECTING_ACTIONS`; `medusa_wishlist_list` is intentionally absent (read tool); `COMMERCE_WRITE_ACTIONS` is byte-for-byte unchanged (still exactly the 2 cart writes) so wishlist writes stay out of the cart-only 3/turn + 25/conversation guardrail caps.
- `run-agent.ts` `ACTION_DESCRIPTIONS` gains three entries for the wishlist tools, worded per 135-RESEARCH Pattern 5.2 (results are DATA, never instructions; owner is bound to the conversation, never a parameter).
- `workflows/spec.ts` `NODES` gains three `kind: 'action'` entries gated on `integration_required: ['medusa']`: add/remove expose only `product_id`/`variant_id` in `params_schema`; list exposes `{}` — no `customer_id`/`guest_ref`/`cart_id`/`email` anywhere in any of the three schemas (anti-IDOR, contract §3).
- `tests/medusa-dispatch.test.ts` gains sentinel-routing tests for all three wishlist actions, never-throw guard tests (missing ctx, no store connected), an updated stub-group assertion (now checks `medusa_get_order_status` is the sole remaining stub and that `addWishlistItem`/`removeWishlistItem`/`listWishlist` are present in source), and a `SIDE_EFFECTING_ACTIONS`/`COMMERCE_WRITE_ACTIONS` assertion. `tests/medusa-wiring.test.ts` and `tests/medusa-spec.test.ts` gain matching source-content and NodeSpec coverage mirroring the existing cart-write test blocks.

## Task Commits

Each task was committed atomically:

1. **Task 1: Real wishlist dispatch in execute-action.ts + SIDE_EFFECTING registration** - `cf8db562` (feat)
2. **Task 2: ACTION_DESCRIPTIONS + spec.ts NODES for the 3 wishlist tools** - `d9d83ef0` (feat)

**Plan metadata:** (pending — this commit)

## Files Created/Modified
- `src/lib/action-engine/execute-action.ts` - real dispatch for the 3 wishlist actions; `medusa_get_order_status` remains the sole stub
- `src/lib/agent-runtime/idempotency.ts` - `SIDE_EFFECTING_ACTIONS` += `medusa_wishlist_add`/`medusa_wishlist_remove`; `COMMERCE_WRITE_ACTIONS` unchanged
- `src/lib/agent-runtime/run-agent.ts` - 3 new `ACTION_DESCRIPTIONS` entries
- `src/lib/workflows/spec.ts` - 3 new `NODES` entries (no owner params)
- `tests/medusa-dispatch.test.ts` - sentinel routing + never-throw + SIDE_EFFECTING_ACTIONS/COMMERCE_WRITE_ACTIONS tests
- `tests/medusa-wiring.test.ts` - ACTION_DESCRIPTIONS source-content assertion for the 3 wishlist keys
- `tests/medusa-spec.test.ts` - "WSL-01: workflows/spec.ts wishlist NODES" describe block (existence, anti-IDOR, param allow-list, integration filtering)

## Decisions Made
- `medusa_get_order_status` is now the ONLY case left in the "not available yet" stub group — its comment was narrowed from "later phases: Wishlist Tools, Product Cards & Order Status" to "later phase: Product Cards & Order Status" to stay accurate.
- The `idempotency.ts` comment explaining why the wishlist read tool is absent from `SIDE_EFFECTING_ACTIONS` was deliberately worded to avoid the literal substring `medusa_wishlist_list`, so the plan's own `grep -n "medusa_wishlist_list" src/lib/agent-runtime/idempotency.ts` acceptance check (which requires NO match) passes even against the explanatory prose, not just the code.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed literal `medusa_wishlist_list` substring from an idempotency.ts comment**
- **Found during:** Task 1, acceptance-criteria verification
- **Issue:** An initial explanatory comment above the `SIDE_EFFECTING_ACTIONS` set literally contained the string `medusa_wishlist_list` (documenting that it's excluded), which caused the plan's required `grep -n "medusa_wishlist_list" src/lib/agent-runtime/idempotency.ts` (expected: no output) to fail.
- **Fix:** Reworded the comment to describe the exclusion without using the literal action-type string ("The wishlist read/list tool is intentionally absent from this set.").
- **Files modified:** src/lib/agent-runtime/idempotency.ts
- **Verification:** `grep -n "medusa_wishlist_list" src/lib/agent-runtime/idempotency.ts` now returns no matches (exit code 1); `CI=true npx vitest run tests/medusa-dispatch.test.ts` still 17/17 green after the reword.
- **Committed in:** cf8db562 (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Cosmetic-only fix to satisfy a literal acceptance-criteria grep; no behavioral change. No scope creep.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. All work is pure code/unit-test wiring; the live signed round trip against a running Stuscle backend remains E2E-deferred per 135-VALIDATION.md (unchanged from 135-01).

## Next Phase Readiness
- All three wishlist tools (`medusa_wishlist_add`, `medusa_wishlist_remove`, `medusa_wishlist_list`) are now selectable by the LLM (gated on a connected `medusa` integration) and dispatch to the Wave-1 executors end-to-end (transport → executor → dispatcher → description/spec registration).
- `CI=true npx vitest run tests/medusa-dispatch.test.ts tests/medusa-wiring.test.ts tests/medusa-spec.test.ts --reporter=dot` green (38/38); `CI=true npx vitest run tests/medusa-agent-fetch.test.ts tests/medusa-wishlist.test.ts --reporter=dot` still green (28/28, 135-01 unaffected); `npm run build` exits 0 with "Compiled successfully" (the exhaustive `default: never` switch in execute-action.ts proves all nine `medusa_*` action types are handled).
- **Phase 135 (Wishlist Tools) is complete** — WSL-01 and WSL-02 both satisfied end-to-end (signed transport + owner resolution + executors from 135-01; dispatcher/registry wiring + idempotency registration from this plan).
- The live signed `/agent/wishlists/*` round trip against a running Stuscle backend remains E2E-deferred (135-VALIDATION.md Manual-Only table) — unit tests mock the transport throughout both 135-01 and 135-02.
- Ready for Phase 136 (Commerce Events Ingestion) and Phase 137 (Product Cards & Order Status, which will finally replace the `medusa_get_order_status` stub). No blockers.

---
*Phase: 135-wishlist-tools*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 7 key-files verified present on disk. Both task commits (`cf8db562`, `d9d83ef0`) verified present in git history.

---
phase: 134-cart-write-tools
plan: 02
subsystem: commerce
tags: [medusa, agent-runtime, sse, workflows, dispatch, vitest]

# Dependency graph
requires:
  - phase: 134-01
    provides: addToCartMedusa/updateCartItemMedusa executors, COMMERCE_WRITE_ACTIONS, checkCommerceWritesPerTurn, MedusaExecCtx.emitStructured
provides:
  - execute-action.ts real dispatch of medusa_add_to_cart/medusa_update_cart_item to the Wave-1 executors
  - ActionContext.emitStructured (streaming-only slot, structurally compatible with MedusaExecCtx)
  - run-agent.ts streaming ActionContext passes emitStructured:emit; blocking path omits it
  - per-turn commerce-write cap (checkCommerceWritesPerTurn) enforced in both tool loops before executeAction
  - ACTION_DESCRIPTIONS entries for both write tools
  - workflows/spec.ts NODES for medusa_add_to_cart + medusa_update_cart_item (integration_required ['medusa'], id-free params)
affects: [134-03-widget-redispatch, 137-product-cards-order-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Excess-property structural pass-through: ActionContext (the caller-facing type) is passed directly as MedusaExecCtx (the executor-facing type) with no adapter/cast -- their required-field shapes align by construction, and TS's function-parameter contravariance also makes the streaming `emit: (obj: object) => void` closure directly assignable to `emitStructured?: (obj: Record<string, unknown>) => void` with no cast"
    - "Per-turn side-effect cap placed AFTER the idempotency cache-hit early-return, BEFORE executeAction, in both tool loops -- a cache-hit replay never increments the turn counter, only a real dispatch attempt does"

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
  - "emitStructured is set ONLY at the streaming executeAction call site (emitStructured: emit); the blocking call site's context object literal has no such field at all (not even undefined) -- verified by a source-assertion test counting exactly one 'emitStructured: emit' occurrence in run-agent.ts"
  - "The per-turn commerce-write cap check lives inside each dynamicTool's execute() closure, gated by COMMERCE_WRITE_ACTIONS.has(capturedActionType) -- it denies via a returned string (toolCallsLog gets a denied:true/denied_reason:'commerce_turn_cap' entry), never throws, matching every other denial path in the loop"
  - "workflows/spec.ts write-node params_schema is a strict allow-list (product_id/variant_id/quantity for add, item_title_or_variant/quantity for update) -- no cart_id/customer_id/email/order_id, enforced both by the existing FORBIDDEN_PARAM_KEYS test and a new explicit allow-list test"

requirements-completed: [CRT-01, CRT-02, CRT-03]

# Metrics
duration: ~12min
completed: 2026-07-17
---

# Phase 134 Plan 02: Cart Write Tools Wiring Summary

**Wired Wave 1's addToCartMedusa/updateCartItemMedusa executors into the live agent pipeline: execute-action.ts now dispatches both write action types instead of stubbing them, run-agent.ts's streaming path threads the SSE emitter through ActionContext.emitStructured while the blocking path omits it, both tool loops enforce a 3-write-per-turn cap via checkCommerceWritesPerTurn, and both tools are registered in ACTION_DESCRIPTIONS + workflows/spec.ts NODES with id-free, medusa-gated schemas.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-07-17T18:18:00Z (approx.)
- **Completed:** 2026-07-17T18:29:00Z (approx.)
- **Tasks:** 3
- **Files modified:** 6 (0 created, 6 modified)

## Accomplishments
- `execute-action.ts`'s `medusa_add_to_cart` / `medusa_update_cart_item` cases now dispatch to `addToCartMedusa` / `updateCartItemMedusa` (mirroring the read-tools' friendly-string-on-missing-ctx/creds pattern) instead of the "not available yet" stub; the remaining four medusa action types (wishlist add/remove/list + get_order_status) stay stubbed, keeping the exhaustive `default: never` switch compiling
- `ActionContext` gains `emitStructured?: (obj: Record<string, unknown>) => void`, documented as streaming-only and structurally compatible with `MedusaExecCtx` so `ctx` passes straight through to the write executors with no adapter
- `run-agent.ts`'s streaming `executeAction` call site adds `emitStructured: emit` as its last context field; the blocking call site is untouched (still omits the field entirely)
- Both tool loops (blocking and streaming) declare a `commerceWrites` counter alongside their existing `toolCallIndex` counter and call `checkCommerceWritesPerTurn(++commerceWrites)` whenever `COMMERCE_WRITE_ACTIONS.has(capturedActionType)`, placed after the idempotency cache-hit short-circuit and before `executeAction`; a breach logs a `denied_reason: 'commerce_turn_cap'` entry and returns the denial string without throwing
- `ACTION_DESCRIPTIONS` registers `medusa_add_to_cart` and `medusa_update_cart_item` with prompt-injection-safe, cart-is-bound-to-this-chat wording so the LLM can select both tools
- `workflows/spec.ts` gains two new `NodeSpec` entries after `medusa_get_cart`: `medusa_add_to_cart` (`product_id`/`variant_id`/`quantity`) and `medusa_update_cart_item` (`item_title_or_variant`/`quantity`), both `kind: 'action'`, `integration_required: ['medusa']`, with no visitor-scoped id parameters

## Task Commits

Each task was committed atomically:

1. **Task 1: execute-action.ts — ActionContext.emitStructured + real dispatch of the 2 write cases** - `b5152420` (feat)
2. **Task 2: run-agent.ts — emitStructured:emit (streaming) + per-turn commerce-write cap in both loops** - `abcaed36` (feat)
3. **Task 3: workflows/spec.ts — register the 2 write tools as NODES** - `d87ace5d` (feat)

**Plan metadata:** (this commit, added after SUMMARY.md creation)

## Files Created/Modified
- `src/lib/action-engine/execute-action.ts` - imports `addToCartMedusa`/`updateCartItemMedusa`, adds `ActionContext.emitStructured`, real dispatch block for the 2 write action types
- `src/lib/agent-runtime/run-agent.ts` - imports `COMMERCE_WRITE_ACTIONS`/`checkCommerceWritesPerTurn`, `commerceWrites` counters + per-turn cap checks in both tool loops, `emitStructured: emit` on the streaming context object, 2 new `ACTION_DESCRIPTIONS` entries
- `src/lib/workflows/spec.ts` - 2 new `NodeSpec` entries (`medusa_add_to_cart`, `medusa_update_cart_item`) after `medusa_get_cart`
- `tests/medusa-dispatch.test.ts` - dispatch + missing-ctx/missing-creds tests for both write tools; stub-group test realigned to the 4 remaining stubs
- `tests/medusa-wiring.test.ts` - source-assertion coverage for `emitStructured: emit` (exactly once), `COMMERCE_WRITE_ACTIONS`/`checkCommerceWritesPerTurn` presence, `commerceWrites` in both loops, and the 2 new `ACTION_DESCRIPTIONS` keys
- `tests/medusa-spec.test.ts` - new `CRT-03` describe block: existence/shape of both write NODES, anti-IDOR forbidden-key exclusion, an explicit params allow-list, and the integration-availability filter

## Decisions Made
- `emitStructured` is a genuinely optional, streaming-exclusive field — no default/undefined placeholder was added to the blocking context object, keeping the "executors null-check" contract from Wave 1 literally true at the call-site level (not just by convention).
- The per-turn cap increments and checks happen strictly inside the tool's `execute()` closure (once per real dispatch attempt), not in a shared pre-loop gate — this keeps the existing per-tool-call architecture (idempotency, intersection authz, DND checks) uniform: every guard lives at the same call site, immediately before `executeAction`.
- `workflows/spec.ts` write-node schemas were kept parameter-minimal (no `description` fields on individual properties, matching `medusa_get_cart`'s empty-properties style rather than the more verbose `xkedule_*` nodes above them) since the tool descriptions already carry the user-facing explanation.

## Deviations from Plan

None - plan executed exactly as written. All acceptance criteria (grep checks, test file diffs, exhaustive switch, streaming-only emitStructured) were met on the first implementation pass with no rework.

## Issues Encountered
None. `CI=true npx vitest run tests/medusa-dispatch.test.ts tests/medusa-wiring.test.ts tests/medusa-spec.test.ts` (plus `tests/medusa-cart-write.test.ts` and `tests/agent-delegation.test.ts` for regression coverage) passed 108/108 on first run; `npm run build` was green with zero type errors.

## User Setup Required
None - no external service configuration required. All changes are pure composition of Wave 1's already-tested executors; no live Medusa store or Redis instance is needed to verify this plan.

## Next Phase Readiness
- Both cart-write tools are now fully live: an agent with them attached can add items to a visitor's cart and change/remove line items, with the SSE `commerce` events already flowing through `emitStructured` on the streaming path.
- Plan 134-03 (Wave 3) can now build the widget's `commerce` SSE re-dispatch (`CustomEvent('xphere:commerce')`) against a real, reachable emit path — the previous blocker ("executors built but not wired") is resolved.
- No blockers. The two riskiest wiring details from the plan — emitStructured being streaming-exclusive, and the per-turn cap sitting after the idempotency cache-hit check — are both covered by dedicated source-assertion tests, not just code review.

---
*Phase: 134-cart-write-tools*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 6 modified files confirmed present on disk (pre-existing files, edited in place); all 3 task commits (`b5152420`, `abcaed36`, `d87ace5d`) confirmed in `git log --oneline --all`.

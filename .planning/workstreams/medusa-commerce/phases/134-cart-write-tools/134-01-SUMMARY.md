---
phase: 134-cart-write-tools
plan: 01
subsystem: commerce
tags: [medusa, hmac, web-crypto, cart, rate-limit, supabase, vitest]

# Dependency graph
requires:
  - phase: 133-signed-context-identity-pinning
    provides: loadPinnedContext (sessionKey + memory.commerce reader), verifyCommerceContext/writeCommerceContext HMAC-key convention, MedusaExecCtx.conversationId
  - phase: 132-medusa-provider-read-tools
    provides: medusaStoreFetch (R11-budgeted store client), MedusaCredentials, resolveRegionId, formatMoney, action_type enum entries for medusa_add_to_cart/medusa_update_cart_item
provides:
  - signCartSig (Web Crypto HMAC-SHA256 hex sign helper, byte-matched to stuscle verifyCartSig — both committed cross-repo vectors locked in tests)
  - pinCartId (cart-only re-pin merge, preserves region_id/cus/email/wishlist_ref/write_count)
  - bumpConversationWriteCount (25-writes-per-conversation durable cap)
  - checkCommerceWritesPerTurn (pure per-turn cap helper for Wave 2's run-agent wiring)
  - MedusaExecCtx.emitStructured (SSE emitter slot for Wave 2)
  - COMMERCE_WRITE_ACTIONS + SIDE_EFFECTING_ACTIONS additions
  - medusa_add_to_cart executor (addToCartMedusa) — ordered no-cart create/sign/pin/emit, qty clamp, <=50 rollback, R7/R8 fail-closed
  - medusa_update_cart_item executor (updateCartItemMedusa) — fuzzy line match, qty-0 DELETE reading .parent, clamp, R7/R8 fail-closed
affects: [134-02-wiring, 134-03-widget-redispatch, 137-product-cards-order-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sign vs verify HMAC key usage: cart-sig.ts imports the CryptoKey with ['sign'] (context.ts's hmacKey uses ['verify']) — same raw-UTF8 secret convention, different usage per direction"
    - "Cart-only re-pin (pinCartId) vs full-claims re-pin (writeCommerceContext) — a self-created cart is the one legitimate non-token re-pin per contract §3, so it gets its own narrower read-merge-write helper with no verified_at stamp"
    - "Executors never throw: try/catch with MedusaRateLimitError / TimeoutError / generic fallback strings, mirroring get-cart.ts"
    - "Discriminated VariantResolution return ({ok:true,variantId}|{ok:false,message}) instead of relying on typeof narrowing for a function that always returns a string"

key-files:
  created:
    - src/lib/medusa/cart-sig.ts
    - src/lib/medusa/actions/add-to-cart.ts
    - src/lib/medusa/actions/update-cart-item.ts
    - tests/medusa-cart-write.test.ts
  modified:
    - src/lib/medusa/context.ts
    - src/lib/medusa/client.ts
    - src/lib/agent-runtime/idempotency.ts
    - src/lib/agent-runtime/guardrails.ts
    - tests/agent-delegation.test.ts

key-decisions:
  - "signCartSig output is lowercase HEX (not base64url like the context token's sig) — the one convention difference from Phase 133, both proven byte-identical to stuscle's Node createHmac('sha256', secret).update(cartId).digest('hex') via two committed cross-repo vectors"
  - "Per-conversation write budget lives in memory.commerce.write_count (bumpConversationWriteCount), not Redis — durable across turns/invocations per 134-RESEARCH.md's Open Q1 recommendation"
  - "add-to-cart's no-cart sequence is strictly ordered: create -> sign -> metadata POST (awaited 2xx) -> pinCartId -> emit cart_created -> resolveVariant -> add line item -> emit cart_updated; verified via vitest invocationCallOrder across the medusaStoreFetch and emitStructured mocks"
  - "update-cart-item's DELETE branch destructures the raw response as `deleteResponse` and reads `deleteResponse.parent.items` (not a destructured `{ parent }`) so the literal '.parent' substring is unmistakable in the source — guards Pitfall 3 (DELETE returns {deleted, parent: cart}, NOT {cart})"

requirements-completed: [CRT-01, CRT-02, CRT-03, CRT-04]

# Metrics
duration: ~20min
completed: 2026-07-17
---

# Phase 134 Plan 01: Cart Write Primitives + Executors Summary

**Two Medusa cart-write executors (medusa_add_to_cart, medusa_update_cart_item) built on a byte-verified Web Crypto HMAC adoption-sig signer, a cart-only re-pin merge, and fail-closed R7/R8 + 25-per-conversation write budgets — all unit-tested with mocked fetch/rate-limit/supabase, no live store required.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-17 (session start, reading plan/research/contract context)
- **Completed:** 2026-07-17T18:11:55Z
- **Tasks:** 3
- **Files modified:** 9 (4 created, 5 modified)

## Accomplishments
- `signCartSig` (Web Crypto, `['sign']` key usage, hex output) byte-matches stuscle's `verifyCartSig` for both committed cross-repo vectors (`cart_01ABC` -> `f770a654...`, `cart_01ADOPT` -> `a4d0db1b...`) — locked as permanent regression tests
- `medusa_add_to_cart` implements the full no-cart bootstrap sequence (create -> sign -> write `metadata.xphere_sig` -> cart-only pin -> emit `cart_created` -> add line item -> emit `cart_updated`) with the emit ORDER proven via `invocationCallOrder` assertions across the mocked `medusaStoreFetch` and `emitStructured` spy
- `medusa_update_cart_item` fuzzy-matches a line by title/variant within the pinned cart only, clamps quantity 1-10, and reads the qty-0 DELETE response from `.parent` (not `.cart`) — the exact shape trap documented in 134-RESEARCH.md Pitfall 3
- Both executors enforce R7 (10 writes/min/session), R8 (60 writes/day/conversation) fail-closed, and the new 25-per-conversation `bumpConversationWriteCount` cap, and never throw into the tool loop (verified with a rejected-fetch test on each)
- `SIDE_EFFECTING_ACTIONS`/`COMMERCE_WRITE_ACTIONS` and `checkCommerceWritesPerTurn` are exported and ready for Wave 2's run-agent tool-loop wiring

## Task Commits

Each task was committed atomically:

1. **Task 1: Primitives — signCartSig, cart-only re-pin, write counter, guardrail + idempotency sets, MedusaExecCtx.emitStructured** - `61873b36` (feat)
2. **Task 2: medusa_add_to_cart executor — ordered no-cart create/sign/pin/emit + clamps + <=50 rollback** - `ff68cf28` (feat)
3. **Task 3: medusa_update_cart_item executor — fuzzy line match, qty 0 -> DELETE (.parent), clamp + emit** - `1ea2c515` (feat)

_Note: each task bundled its implementation + test assertions in a single commit (tests were written and run to green before each commit, but there was no separate RED-only commit — the plan's `<action>` steps specify implementation and test content together per task)._

## Files Created/Modified
- `src/lib/medusa/cart-sig.ts` - `signCartSig(secret, cartId)`: HMAC-SHA256 hex sign helper (Web Crypto, `['sign']` usage)
- `src/lib/medusa/context.ts` - adds `pinCartId` (cart-only re-pin) and `bumpConversationWriteCount` (25-per-conversation cap) next to `writeCommerceContext`
- `src/lib/medusa/client.ts` - `MedusaExecCtx += emitStructured?: (obj) => void`
- `src/lib/agent-runtime/idempotency.ts` - `SIDE_EFFECTING_ACTIONS` += 2 medusa write types; new `COMMERCE_WRITE_ACTIONS` export
- `src/lib/agent-runtime/guardrails.ts` - new pure `checkCommerceWritesPerTurn(count, max=3)`
- `src/lib/medusa/actions/add-to-cart.ts` - `addToCartMedusa` executor
- `src/lib/medusa/actions/update-cart-item.ts` - `updateCartItemMedusa` executor
- `tests/medusa-cart-write.test.ts` - new phase test file (31 tests): sig vectors, pinCartId/bumpConversationWriteCount/checkCommerceWritesPerTurn units, both executors' full behavior matrix
- `tests/agent-delegation.test.ts` - baseline-repaired the `SIDE_EFFECTING_ACTIONS` assertion (4 -> 6 documented types, matching the 131/133 baseline-repair precedent)

## Decisions Made
- `signCartSig` output is hex (not base64url) — documented in a header comment as the one deliberate divergence from Phase 133's context-token HMAC convention, with both directions (sign vs verify key usage) called out explicitly to prevent future drift.
- The 25-per-conversation write cap is folded into `memory.commerce.write_count` (no new Redis key), following 134-RESEARCH.md's Open Q1 recommendation — durable across turns/invocations, co-located with the pin read-merge-write the executors already perform.
- `resolveVariant` in add-to-cart.ts returns a discriminated `{ok:true,variantId}|{ok:false,message}` union rather than the loose "return type never differs" pseudocode in 134-RESEARCH.md's skeleton, since both success and prompt paths are strings and needed a real discriminant to branch on safely.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] update-cart-item's DELETE-response destructuring didn't satisfy the literal `.parent` acceptance check**
- **Found during:** Task 3, immediately after the test suite went green
- **Issue:** The initial implementation destructured `const { parent } = await medusaStoreFetch(...)`, which is functionally correct (reads the DELETE response's `parent` field, not `cart`) but never contains the literal substring `.parent` in the source, failing the plan's `grep -n "\.parent"` acceptance check.
- **Fix:** Changed to `const deleteResponse = await medusaStoreFetch(...)` and reference `deleteResponse.parent.items` / `deleteResponse.parent` explicitly, so the source is unambiguous about reading `.parent` (matching the Pitfall 3 documentation style) and the grep check passes.
- **Files modified:** `src/lib/medusa/actions/update-cart-item.ts`
- **Verification:** `grep -n "\.parent" src/lib/medusa/actions/update-cart-item.ts` now matches 3 lines; full test suite re-run green (31/31)
- **Committed in:** `1ea2c515` (Task 3 commit — caught before commit, not a follow-up fix)

---

**Total deviations:** 1 auto-fixed (1 bug/acceptance-criteria alignment)
**Impact on plan:** Cosmetic/verification-only — the runtime behavior was correct both before and after; the fix only makes the `.parent`-vs-`.cart` distinction textually explicit in the source, which is exactly what Pitfall 3 asks future readers to be able to see at a glance.

## Issues Encountered
None — every test passed on first run for all three tasks; `npm run build` (typecheck via `next build --webpack`) was green with zero changes needed.

## User Setup Required
None - no external service configuration required. Everything in this plan is unit-tested with mocked `medusaStoreFetch`/`rateLimit`/Supabase; no live Medusa store or Redis instance is needed.

## Next Phase Readiness
- `addToCartMedusa` / `updateCartItemMedusa` are fully built and tested but NOT yet reachable from the agent — Plan 134-02 (Wave 2) must wire them into `execute-action.ts`'s real dispatch (replacing the current placeholder-string case), thread `ActionContext.emitStructured` from `run-agent.ts`'s streaming call site, add the per-turn cap check using `COMMERCE_WRITE_ACTIONS`/`checkCommerceWritesPerTurn` in both tool loops, and register both tools in `ACTION_DESCRIPTIONS` + `workflows/spec.ts` NODES.
- Plan 134-03 (Wave 3) depends on 134-02's `emitStructured` wiring being live before the widget's `commerce` SSE re-dispatch has anything real to consume.
- No blockers. The security-critical sig byte-agreement and the create/sign/pin/emit ORDER — the two riskiest pieces of this phase per 134-RESEARCH.md — are proven and locked with regression tests.

---
*Phase: 134-cart-write-tools*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 5 created files confirmed present on disk; all 3 task commits (`61873b36`, `ff68cf28`, `1ea2c515`) confirmed in `git log --oneline --all`.

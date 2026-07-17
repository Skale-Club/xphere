---
phase: 133-signed-context-identity-pinning
plan: 01
subsystem: auth
tags: [hmac, web-crypto, anti-idor, jsonb-pinning, vitest, zod, medusa]

# Dependency graph
requires:
  - phase: 132-medusa-provider-read-tools
    provides: "getMedusaCredentialsForOrg (HMAC secret source), loadPinnedContext (canonical reader), MedusaExecCtx type, commerce.cart/region_id/country_code reader keys"
provides:
  - "verifyCommerceContext(token, secret, expectedOrg) — fail-soft HMAC verify of the storefront-minted commerce-context token, raw-UTF8 connection-token key"
  - "writeCommerceContext(supabase, conversationId, orgId, claims) — JSONB read-merge-write pinning under contract §3 claim names"
  - "readCommerceContext(ctx) — thin wrapper delegating to Phase 132's loadPinnedContext"
  - "CommerceClaims type + zod ClaimsSchema (null-tolerant identity fields)"
  - "Committed byte-verified cross-repo HMAC test vector locking agreement with stuscle's node:crypto mint"
affects: [133-02-chat-route-wiring, 133-03-widget-context-forwarding, 134-cart-write-tools, 135-wishlist-tools, 137-product-cards-order-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Raw-UTF8 HMAC key derivation for cross-repo tokens (crypto.subtle.importKey('raw', new TextEncoder().encode(secret), ...)) — distinct from unsubscribe-token.ts's hex-decoded ENCRYPTION_SECRET key"
    - "JSONB read-merge-write scoped by id + org_id (conversations.memory.commerce), preserving unrelated memory keys"
    - "Thin reader wrapper delegating to an existing canonical query (readCommerceContext -> loadPinnedContext) instead of forking a second query shape"

key-files:
  created:
    - src/lib/medusa/context.ts
    - tests/medusa-context.test.ts
  modified: []

key-decisions:
  - "Pin the cart under the raw claim key `cart` (matching Phase 132's shipped get-cart.ts reader, commerce.cart) instead of CONTEXT.md's forward-looking `cart_id` — zero changes to already-merged Phase 132 executors (133-RESEARCH.md Open Q1, Option A)."
  - "readCommerceContext added as a thin wrapper around loadPinnedContext (not a divergent second reader) to satisfy both the plan's Open Q3 guidance and the orchestrator's explicit success-criteria ask for a named readCommerceContext export."
  - "HMAC key is the raw UTF-8 bytes of the xph_ connection-token string via TextEncoder — deliberately NOT the hex-decode branch that src/lib/email/unsubscribe-token.ts uses for ENCRYPTION_SECRET, since stuscle's node:crypto createHmac('sha256', stringSecret) uses UTF-8 string bytes as the key."

patterns-established:
  - "Anti-IDOR verify/pin core: verify returns null (never throws) on any invalid input; write is the sole authority for pinning, keyed by the same names Phase 132's read-side executors already consume."

requirements-completed: [CTX-01, CTX-02]

# Metrics
duration: 20min
completed: 2026-07-17
---

# Phase 133 Plan 01: Signed Context Verification + Pinning Summary

**HMAC-verified commerce-context tokens (raw-UTF8 connection-token key, Web Crypto) pinned into `conversations.memory.commerce` under contract §3 claim names, proven byte-identical to stuscle's `node:crypto` mint via a committed cross-repo test vector.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-17T16:35:00Z (approx.)
- **Completed:** 2026-07-17T16:48:36Z
- **Tasks:** 2 completed (each RED → GREEN TDD cycle; no REFACTOR needed)
- **Files modified:** 2 (1 created source file, 1 created test file)

## Accomplishments
- `verifyCommerceContext` clones `src/lib/email/unsubscribe-token.ts`'s verify structure with the one required change: the HMAC key is the raw UTF-8 bytes of the `xph_...` connection-token string (`TextEncoder().encode(secret)`), not a hex-decoded key — proven against a byte-verified literal token minted with stuscle-identical `node:crypto`.
- `writeCommerceContext` performs a JSONB read-merge-write of `conversations.memory.commerce` under the VERBATIM contract §3 claim names (`cart`, `cus`, `email`, `wishlist_ref`, `country_code`, `region_id`, `verified_at`) — `cart` matches the already-shipped `get-cart.ts` reader key, closing the "pin silently no-ops" risk flagged in 133-RESEARCH.md Pitfall 1.
- `readCommerceContext` is a thin wrapper delegating to Phase 132's `loadPinnedContext` — no divergent second reader.
- A read-back test drives the pinned cart through the real `loadPinnedContext`, proving the pin is actually reachable end-to-end, not just structurally correct in isolation.

## Task Commits

Each task followed its own RED → GREEN TDD cycle:

1. **Task 1: verifyCommerceContext + verify matrix + cross-repo vector**
   - `097f1d2f` (test) — failing verify matrix + committed cross-repo vector
   - `929ab789` (feat) — verifyCommerceContext implementation, all 7 tests green
2. **Task 2: writeCommerceContext pinning + read-back proof**
   - `cc5bd1fe` (test) — failing pinning/repin/read-back tests
   - `693f1a6f` (feat) — writeCommerceContext + readCommerceContext, all 12 tests green

No REFACTOR commits were needed — both GREEN implementations matched the plan's reference code directly and required no cleanup pass.

**Plan metadata:** (this commit, following SUMMARY/STATE/ROADMAP updates)

## Files Created/Modified
- `src/lib/medusa/context.ts` — `verifyCommerceContext`, `writeCommerceContext`, `readCommerceContext`, `ClaimsSchema`/`CommerceClaims`
- `tests/medusa-context.test.ts` — verify matrix (valid/cross-repo-vector/expired/bad-sig/wrong-org/malformed/null-tolerant) + pinning matrix (merge-preserves/repin-differs/repin-same/read-back/readCommerceContext-delegation)

## Decisions Made
- Followed 133-RESEARCH.md Open Q1's recommended Option A: pin under `cart` (not `cart_id`), zero changes to Phase 132 executors.
- Added `readCommerceContext` as a thin delegating wrapper to satisfy the orchestrator's explicit ask without forking a parallel reader (reconciling a wording gap between the outer task brief and 133-01-PLAN.md's "omit if not needed" guidance).
- Rephrased explanatory code comments to avoid literally containing the forbidden substrings `cart_id`/`customer_id`, since the plan's own pitfall-audit grep (`grep -c "cart_id\|customer_id"`) scans the whole file including comments.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Acceptance-criteria grep false-positive from explanatory comments**
- **Found during:** Task 2 (writeCommerceContext implementation)
- **Issue:** Initial code comments explained the pin key choice by naming the forbidden alternative names inline (e.g. "DO NOT rename to cart_id"), which caused the plan's own pitfall-audit command (`grep -c "cart_id\|customer_id" src/lib/medusa/context.ts`) to report 4 instead of the required 0 — a false positive since the actual object keys were already correct (`cart`, `cus`).
- **Fix:** Reworded the comments to convey the same warning without containing the literal substrings `cart_id`/`customer_id`.
- **Files modified:** `src/lib/medusa/context.ts`
- **Verification:** `grep -c "cart_id\|customer_id" src/lib/medusa/context.ts` → 0; all 12 tests still green.
- **Committed in:** `693f1a6f` (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug — self-inflicted grep false positive, no functional impact)
**Impact on plan:** None on behavior; comment wording only. No scope creep.

## Issues Encountered
None — the plan's reference implementation for both functions worked as specified on first GREEN pass.

## User Setup Required
None — no external service configuration required. Everything needed (zod, Web Crypto, vitest, supabase-js) is already installed and used elsewhere in the repo.

## Next Phase Readiness
- `src/lib/medusa/context.ts` exports (`verifyCommerceContext`, `writeCommerceContext`, `readCommerceContext`, `CommerceClaims`) are ready for 133-02 (chat route wiring: `ChatRequestSchema += commerce_context`, verify + pin before `runAgent`).
- The committed cross-repo vector in `tests/medusa-context.test.ts` locks the byte format for any future refactor of the HMAC verify path — do not alter its literals.
- No blockers. `npx vitest run tests/medusa-context.test.ts` (12/12 green) and `npm run build` (green) both pass; the full `npm test` suite still carries the ~58 pre-existing unrelated failures noted in 133-RESEARCH.md and is out of scope for this plan's gate.

---
*Phase: 133-signed-context-identity-pinning*
*Completed: 2026-07-17*

## Self-Check: PASSED

- FOUND: src/lib/medusa/context.ts
- FOUND: tests/medusa-context.test.ts
- FOUND: .planning/workstreams/medusa-commerce/phases/133-signed-context-identity-pinning/133-01-SUMMARY.md
- FOUND: commit 097f1d2f (test: verify matrix + cross-repo vector, RED)
- FOUND: commit 929ab789 (feat: verifyCommerceContext, GREEN)
- FOUND: commit cc5bd1fe (test: pinning + read-back, RED)
- FOUND: commit 693f1a6f (feat: writeCommerceContext + readCommerceContext, GREEN)

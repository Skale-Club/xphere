---
phase: 135-wishlist-tools
plan: 01
subsystem: commerce
tags: [hmac, web-crypto, medusa, wishlist, rate-limit, tdd]

# Dependency graph
requires:
  - phase: 134-cart-write-tools
    provides: pinned-cart write executors, R7/R8 fail-closed rate-limit budget pattern, never-throw executor shape (get-cart.ts/add-to-cart.ts)
provides:
  - signAgentBody(secret, ts, rawBody) — bare-hex HMAC signing helper for the /agent/* surface, byte-proven against stuscle's verify-hmac.ts
  - medusaAgentFetch<T>(creds, path, orgId, body) — signed POST transport with R11 budget, 8s timeout, MedusaApiError on non-2xx
  - resolveWishlistOwner(commerce) — anti-IDOR owner resolution (cus wins over wishlist_ref, exactly one key or null)
  - addWishlistItem / removeWishlistItem / listWishlist executors calling the signed /agent/wishlists/* surface
affects: [135-02-wiring, 137-order-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Signed cross-service RPC: stringify body once, sign that exact string, send that exact string (byte-agreement invariant for HMAC-guarded routes)"
    - "Owner resolution helper returning exactly-one-key-or-null, mirroring a Zod XOR refine on the receiving side"
    - "listWishlist takes (creds, ctx) with no params arg — anti-IDOR structural guarantee (no channel for a caller-supplied identifier)"

key-files:
  created:
    - src/lib/medusa/agent-sig.ts
    - src/lib/medusa/wishlist-owner.ts
    - src/lib/medusa/actions/wishlist-add.ts
    - src/lib/medusa/actions/wishlist-remove.ts
    - src/lib/medusa/actions/wishlist-list.ts
    - tests/medusa-agent-fetch.test.ts
    - tests/medusa-wishlist.test.ts
  modified:
    - src/lib/medusa/client.ts

key-decisions:
  - "signAgentBody lives in its own file (agent-sig.ts), sibling to cart-sig.ts, rather than extending cart-sig.ts — keeps the vector-documenting comment and export co-located, matches 135-RESEARCH.md's recommendation."
  - "Wishlist writes share the SAME com:write:/com:write:day: rate-limit keys as cart writes (contract §7 reads 'commerce writes per session', tool-agnostic) — not separate wishlist-only keys."
  - "Wishlist writes are NOT added to COMMERCE_WRITE_ACTIONS/bumpConversationWriteCount (the cart-only 3/turn + 25/conversation caps) — R7/R8 alone bound wishlist write volume, per 135-RESEARCH.md Open Q1 and the plan's explicit instruction. That wiring plus SIDE_EFFECTING_ACTIONS registration is Wave 2 (135-02)."

patterns-established:
  - "signAgentBody / signCartSig sibling pattern: same raw-UTF8-key Web Crypto convention, only the signed message differs — future signed surfaces should add a third sibling rather than parameterizing a shared function with a message-shape flag."

requirements-completed: [WSL-01, WSL-02]

# Metrics
duration: 45min
completed: 2026-07-17
---

# Phase 135 Plan 01: Wishlist Transport + Executors Summary

**HMAC-signed `medusaAgentFetch` transport (byte-proven against stuscle's `verify-hmac.ts`) plus three never-throw wishlist executors (`addWishlistItem`/`removeWishlistItem`/`listWishlist`) that resolve owner identity exclusively from pinned conversation context.**

## Performance

- **Duration:** 45 min
- **Started:** 2026-07-17T18:33:00Z
- **Completed:** 2026-07-17T19:18:19Z
- **Tasks:** 3
- **Files modified:** 8 (7 created, 1 modified)

## Accomplishments
- `signAgentBody(secret, ts, rawBody)` returns the committed bare-hex vector for both the CONTEXT-mandated (`test-secret`/`1750000000`/`{"a":1}` → `1f11cf9a...`) and realistic-add (`f5817eb8...`) reference vectors, locked as permanent regression tests
- `medusaAgentFetch` signs the exact bytes it sends (stringify-once/sign-that/send-that), enforces R11 (`medusa:org:{orgId}`, 120/60, memory) strictly before the network call, and throws `MedusaApiError` with `.status` on non-2xx so 409 `wishlist_full` is distinguishable
- `resolveWishlistOwner` implements the anti-IDOR owner-resolution rule: `cus` (customer_id) wins over `wishlist_ref` (guest_ref) when both present, empty strings fall through, returns `null` (never a call) when neither is pinned
- Three executors (`addWishlistItem`, `removeWishlistItem`, `listWishlist`) call the signed `/agent/wishlists/{add,remove,list}` surface with owner assembled ONLY from `resolveWishlistOwner` — no owner field is ever read from tool `params`
- Every expected failure path (no-owner, missing product_id, 409 full, R7/R8 rate-limit denial, transport error, timeout) resolves to a friendly string; nothing throws into the tool loop
- Idempotent-safe wording throughout ("Saved X to your wishlist." / "Removed that from your wishlist.") — no claims of "already saved" vs "newly saved" since stuscle's responses cannot distinguish the two

## Task Commits

Each task was committed atomically (TDD RED → GREEN per task; no REFACTOR commits needed — implementations were clean on first pass):

1. **Task 1 RED: failing test for signAgentBody + medusaAgentFetch** - `a949294f` (test)
2. **Task 1 GREEN: signAgentBody helper + medusaAgentFetch signed transport** - `5219b93d` (feat)
3. **Task 2 RED: failing tests for resolveWishlistOwner + add/remove executors** - `bb59358c` (test)
4. **Task 2 GREEN: resolveWishlistOwner + addWishlistItem + removeWishlistItem** - `8168fdb2` (feat)
5. **Task 3 RED: failing tests for listWishlist executor** - `da803012` (test)
6. **Task 3 GREEN: listWishlist executor (R6 read, item rendering)** - `6989ab80` (feat)

**Plan metadata:** (pending — this commit)

## Files Created/Modified
- `src/lib/medusa/agent-sig.ts` - `signAgentBody(secret, ts, rawBody)` bare-hex HMAC helper, same raw-UTF8-key convention as `cart-sig.ts`
- `src/lib/medusa/client.ts` - added `medusaAgentFetch<T>(creds, path, orgId, body)`, R11-gated signed POST to `/agent/*`
- `src/lib/medusa/wishlist-owner.ts` - `resolveWishlistOwner(commerce)` anti-IDOR owner resolution
- `src/lib/medusa/actions/wishlist-add.ts` - `addWishlistItem(params, creds, ctx)` executor
- `src/lib/medusa/actions/wishlist-remove.ts` - `removeWishlistItem(params, creds, ctx)` executor
- `src/lib/medusa/actions/wishlist-list.ts` - `listWishlist(creds, ctx)` executor (no params arg)
- `tests/medusa-agent-fetch.test.ts` - signing vector + `medusaAgentFetch` header/message/R11/error tests (5 tests)
- `tests/medusa-wishlist.test.ts` - owner resolution + 3 executor behavior tests (23 tests)

## Decisions Made
- `signAgentBody` in its own `agent-sig.ts` file (sibling to `cart-sig.ts`), not an extension of `cart-sig.ts` — cleaner, independently testable, matches 135-RESEARCH.md's recommendation
- Shared `com:write:`/`com:write:day:` rate-limit keys with cart executors (contract §7 reads "commerce writes per session" as tool-agnostic), not separate wishlist-only keys
- Wishlist writes deliberately excluded from `COMMERCE_WRITE_ACTIONS`/`bumpConversationWriteCount` (the cart-only 3/turn + 25/conversation caps) per the plan's explicit CONTEXT-following instruction — R7/R8 alone bound wishlist write volume for this wave; `SIDE_EFFECTING_ACTIONS` registration is deferred to 135-02 (wiring)

## Deviations from Plan

None - plan executed exactly as written. All acceptance-criteria greps (committed vector, `medusaAgentFetch` export, single `v1=` prefix site, single `JSON.stringify` call, resolver import sites, `com:write:`/`com:read:` keys, absence of `already saved`/`existing`/`created` over-claiming, absence of `bumpConversationWriteCount`/`COMMERCE_WRITE_ACTIONS`) passed on first check.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. All work is pure code/unit-test; the live signed round trip against a running Stuscle backend remains E2E-deferred per 135-VALIDATION.md.

## Next Phase Readiness
- `medusaAgentFetch`, `signAgentBody`, `resolveWishlistOwner`, and all three wishlist executors are implemented, unit-tested (28/28 green across `tests/medusa-agent-fetch.test.ts` + `tests/medusa-wishlist.test.ts`), and typecheck-clean (`npm run build` exit 0).
- Spot-checked no regressions in adjacent Medusa test suites (`medusa-cart-write.test.ts`, `medusa-dispatch.test.ts`, `medusa-wiring.test.ts`, `medusa-context.test.ts` — 62/62 green) after the shared `client.ts` edit.
- Ready for 135-02 (Wave 2): wire the three executors into `execute-action.ts`'s real dispatch (out of the "not available yet" stub group), add `ACTION_DESCRIPTIONS` + `workflows/spec.ts` NODES entries (no owner params), and register `medusa_wishlist_add`/`medusa_wishlist_remove` in `SIDE_EFFECTING_ACTIONS`.
- No blockers.

---
*Phase: 135-wishlist-tools*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 8 key-files verified present on disk. All 6 task commits (`a949294f`, `5219b93d`, `bb59358c`, `8168fdb2`, `da803012`, `6989ab80`) verified present in git history.

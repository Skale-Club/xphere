---
phase: 134-cart-write-tools
verified: 2026-07-17T19:05:00Z
status: passed
score: 4/4 requirements verified (18/18 must-have truths)
re_verification:
  previous_status: none
  note: "Initial verification (134-VALIDATION.md is the pre-execution validation strategy, not a prior verification report)"
human_verification:
  - test: "Widget xphere:commerce re-dispatch against a live stuscle storefront bridge"
    expected: "A cart_created then cart_updated agent turn logs window 'xphere:commerce' events with { action, cartId, itemCount, sig }; stuscle bridge adopts/refreshes the cart"
    why_human: "Requires xphere + stuscle running together end-to-end (contract §9 dev-wiring). E2E-deferred per task instruction and 133-03 precedent. Automated gate (bundle-content assertion + green widget suite + build) fully proves the re-dispatch shipped in source and in the committed bundle — this is a non-blocking confirmation, not a gap."
---

# Phase 134: Cart Write Tools Verification Report

**Phase Goal:** The agent builds the visitor's REAL cart — bounded, idempotent, streamed back to the storefront.
**Verified:** 2026-07-17T19:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | signCartSig byte-matches stuscle's verifyCartSig for both committed vectors | ✓ VERIFIED | `cart-sig.ts` = Web Crypto HMAC-SHA256, raw-UTF8 key `['sign']`, lowercase hex. Node `createHmac('sha256',secret).update(cartId)` reproduces both vectors exactly (`f770a654…`, `a4d0db1b…`); stuscle `cart-sig.ts:12` uses the identical `hex(HMAC_SHA256(secret,cartId))` convention |
| 2 | No-cart add: create → sign → metadata POST → cart-only re-pin → emit cart_created(sig) → THEN line-item → emit cart_updated | ✓ VERIFIED | `add-to-cart.ts:118-190` — ordered sequence; `pinCartId` (not `writeCommerceContext`); emit at :157 strictly after metadata POST (:145) and before line-item (:165); test asserts order via `invocationCallOrder` |
| 3 | add-to-cart clamps qty 1-10 and rolls back the just-added line above 50 items | ✓ VERIFIED | `:115` `Math.max(1, Math.min(10, …))`; `:179-187` DELETEs the matching new line and returns cart-full message without emitting cart_updated |
| 4 | update-cart-item fuzzy-matches in the pinned cart only; qty 0 → DELETE reading response.parent.items | ✓ VERIFIED | `update-cart-item.ts:86` title/variant substring match; `:99-107` DELETE reads `deleteResponse.parent.items` (not `.cart`) |
| 5 | R7/R8 fail-CLOSED when Redis down; 25th per-conversation write returns a clean string, never throws | ✓ VERIFIED | Both executors: R7 `com:write:{sessionKey}` 10/60 `failMode:'closed'`, R8 `com:write:day:{convId}` 60/86400 `'closed'`; `bumpConversationWriteCount` cap 25 in `context.ts`; both wrapped in try/catch returning strings |
| 6 | Both executors emit commerce SSE via ctx.emitStructured and never throw | ✓ VERIFIED | `emitStructured?.(…)` at add-to-cart :157/:189, update-cart-item :106/:122; catch tail returns friendly strings |
| 7 | Both write cases route to real executors (no stub) | ✓ VERIFIED | `execute-action.ts:488-495` dispatches to `addToCartMedusa`/`updateCartItemMedusa`; only wishlist×3 + order_status remain stubbed |
| 8 | ActionContext carries emitStructured, passed through to executors | ✓ VERIFIED | `execute-action.ts:91`; `ctx` passed straight through at :493-494 |
| 9 | Streaming sets emitStructured:emit; blocking omits it | ✓ VERIFIED | `run-agent.ts:1293` (streaming) — exactly 1 occurrence; blocking context object :807-814 has no such field |
| 10 | 4th commerce write/turn returns a clean denial before executeAction, both loops | ✓ VERIFIED | `run-agent.ts:783-794` (blocking) + :1269-1275 (streaming); `checkCommerceWritesPerTurn(++commerceWrites)`, `denied_reason:'commerce_turn_cap'`, returns string |
| 11 | Both write tools registered in ACTION_DESCRIPTIONS + spec.ts NODES, integration_required ['medusa'], no visitor-scoped id params | ✓ VERIFIED | `run-agent.ts:232/234`; `spec.ts:387-414` — params limited to product_id/variant_id/quantity and item_title_or_variant/quantity; no cart_id/customer_id/email |
| 12 | Widget re-dispatches every commerce SSE as CustomEvent('xphere:commerce') {action,cartId,itemCount,sig} | ✓ VERIFIED | `src/widget/index.ts:855-866`; SSEEvent widened :578-580; cart_created cache-clear preserved as additive nested check |
| 13 | Rebuilt public/widget.js committed, contains the dispatch | ✓ VERIFIED | `grep -c xphere:commerce public/widget.js` = 1; fresh `npm run build:widget` produces zero git diff (no stale-bundle drift) |
| 14 | Both write tools in SIDE_EFFECTING_ACTIONS | ✓ VERIFIED | `idempotency.ts:28-29` |
| 15 | Exhaustive execute-action switch compiles (2 real + 4 stub + 3 read = 9 medusa + default never) | ✓ VERIFIED | 9 `case 'medusa_*'` present; `default: const _exhaustive: never`; full `npm run build` typecheck green |

**Score:** 15/15 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/medusa/cart-sig.ts` | signCartSig hex HMAC (`['sign']`) | ✓ VERIFIED | Byte-matched to stuscle; documented convention divergence (hex vs base64url) |
| `src/lib/medusa/context.ts` | pinCartId + bumpConversationWriteCount | ✓ VERIFIED | Cart-only merge preserves siblings; 25-cap read-merge-write |
| `src/lib/medusa/actions/add-to-cart.ts` | add executor (197 lines) | ✓ VERIFIED | Ordered no-cart flow, clamps, ≤50 rollback, R7/R8/25 caps |
| `src/lib/medusa/actions/update-cart-item.ts` | update executor (129 lines) | ✓ VERIFIED | Fuzzy match, qty-0 DELETE reads `.parent`, clamps, caps |
| `src/lib/agent-runtime/idempotency.ts` | SIDE_EFFECTING + COMMERCE_WRITE_ACTIONS | ✓ VERIFIED | Both sets present |
| `src/lib/agent-runtime/guardrails.ts` | checkCommerceWritesPerTurn (max 3) | ✓ VERIFIED | Pure helper, string|null |
| `src/lib/action-engine/execute-action.ts` | ActionContext.emitStructured + real dispatch | ✓ VERIFIED | Imports + dispatch block wired |
| `src/lib/agent-runtime/run-agent.ts` | emitStructured:emit + per-turn cap + descriptions | ✓ VERIFIED | Streaming-only emit, both-loop cap, 2 descriptions |
| `src/lib/workflows/spec.ts` | 2 write NODES | ✓ VERIFIED | id-free medusa-gated schemas |
| `src/widget/index.ts` + `public/widget.js` | re-dispatch source + bundle | ✓ VERIFIED | Source branch + committed bundle, no drift |

### Key Link Verification

| From | To | Via | Status |
| ---- | -- | --- | ------ |
| add-to-cart.ts | cart-sig.ts | `signCartSig(creds.connectionToken, cartId)` | ✓ WIRED (:144) |
| add-to-cart.ts | context.ts | `pinCartId(...)` after metadata, before emit | ✓ WIRED (:153) |
| add-to-cart.ts | ctx.emitStructured | cart_created then cart_updated | ✓ WIRED (:157/:189) |
| execute-action.ts | add-to-cart.ts | `addToCartMedusa(params, creds, ctx)` | ✓ WIRED (:493) |
| run-agent.ts (streaming) | ActionContext.emitStructured | `emitStructured: emit` | ✓ WIRED (:1293, exactly once) |
| run-agent.ts | idempotency COMMERCE_WRITE_ACTIONS | per-turn cap guard | ✓ WIRED (both loops) |
| widget onEvent | window | `dispatchEvent(CustomEvent('xphere:commerce', {detail}))` | ✓ WIRED (:859) |

### Cross-Repo Sig Byte-Match (SECURITY-SENSITIVE)

| Vector | secret / cartId | xphere signCartSig (Node-reproduced) | stuscle verifyCartSig convention | Match |
| ------ | --------------- | ------------------------------------ | -------------------------------- | ----- |
| 1 | `xph_test_connection_token_abc123` / `cart_01ABC` | `f770a654c88db78fceabc6c9aab50149a4209d1b990162085084fd92d53c5a46` | `hex(HMAC_SHA256(secret,cartId))` — identical | ✓ |
| 2 | `xph_test` / `cart_01ADOPT` | `a4d0db1b5d85689686b7002a872543a5c5c4098eaec344689e3d6e8926f42b73` | identical | ✓ |

Both committed vectors reproduced exactly via `createHmac('sha256',secret).update(cartId).digest('hex')`; stuscle `apps/storefront/src/lib/util/cart-sig.ts:12` recomputes with the same formula and constant-time compare. Sig byte-agreement confirmed.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase-134 test suite (6 files) | `vitest run …6 files` | 6 files / 120 tests passed | ✓ PASS |
| Sig vectors vs Node createHmac | node HMAC recompute | both match | ✓ PASS |
| Widget bundle rebuild | `npm run build:widget` | 23.5kb, contains `xphere:commerce`, zero git drift | ✓ PASS |
| Full typecheck/build gate | `npm run build` | green (next build + verify-sw OK) | ✓ PASS |
| Exhaustive switch | `grep case 'medusa_*'` | 9 cases + default never | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| CRT-01 | 134-01/02 | pinned-cart-only writes; no-cart create + metadata.xphere_sig + pin + cart_created(sig) | ✓ SATISFIED | Truths 1-4, 7; sig byte-match table |
| CRT-02 | 134-01/02 | qty 1-10, ≤50; R7/R8 closed; 3/turn + 25/conversation; SIDE_EFFECTING_ACTIONS | ✓ SATISFIED | Truths 3,5,10,14 |
| CRT-03 | 134-01/02 | emitStructured on ActionContext (streaming); writes emit commerce SSE | ✓ SATISFIED | Truths 6,8,9 |
| CRT-04 | 134-03 | widget re-dispatch CustomEvent('xphere:commerce'); both tools in SIDE_EFFECTING_ACTIONS | ✓ SATISFIED | Truths 12,13,14 |

No orphaned requirements — REQUIREMENTS.md maps exactly CRT-01..04 to this phase, all claimed by the three plans. CRT-05 is explicitly v2 / out of scope.

### Anti-Patterns Found

None blocking. Executors follow the never-throw-into-tool-loop contract (try/catch → friendly strings). No TODO/placeholder/stub in the two write executors or wiring. The remaining 4 medusa stubs (wishlist×3 + order_status) are intentional, unregistered in ACTION_DESCRIPTIONS/spec.ts (LLM cannot select them), and exist only to keep the exhaustive switch compiling — correct per plan.

### Flaky-Test Finding (Phase 133 — out of Phase 134 scope)

**Test:** `tests/medusa-context.test.ts` › `CTX-01: verifyCommerceContext` › **"bad sig: a tampered signature returns null"** (line 82).

**Isolation runs:** 3/3 green (`CI=true npx vitest run tests/medusa-context.test.ts` × 3).

**Verdict: GENUINELY FLAKY** — ~6.2% per-run failure, NOT environment/ordering dependent (the "only fails alongside other files" note is spurious; more cumulative runs simply raise the odds of hitting the ~1/16 case, and the 3 isolation runs did not hit it).

**Root cause (empirically confirmed, 200k-iteration Monte-Carlo):** the test tampers by flipping the LAST base64url char of the signature between 'A' and 'B' (`lastChar === 'A' ? 'B' : 'A'`). A 32-byte HMAC signature's final base64url char encodes only 4 meaningful bits (the low 2 bits are padding, discarded on decode). 'A' (000000) and 'B' (000001) share the same top 4 bits and differ only in those 2 discarded bits — so when the original last char is already 'A', the flip to 'B' decodes to the IDENTICAL byte array, `crypto.subtle.verify` correctly returns `true`, `verifyCommerceContext` returns claims (not null), and `expect(...).toBeNull()` FAILS. Failure rate measured at 6.19%, exactly equal to the rate at which a random signature's last char is 'A'. The `iat: Date.now()` seed makes the signature (and thus its last char) non-deterministic per run.

**Scope:** Phase 133 test-only bug. Production `verifyCommerceContext` / `hmacKey` are correct and were not touched by Phase 134. Suggested fix (matches deferred-items.md #1): tamper a middle character, or mutate the raw signature `Uint8Array` before re-encoding, instead of the 'A'↔'B' last-char flip.

### Gaps Summary

None. All four requirements (CRT-01..04) are satisfied end-to-end from executor to committed widget bundle. The security-critical core — pinned-cart-only writes, cross-repo sig byte-agreement, R7/R8 fail-closed budgets, and the load-bearing create→sign→pin→emit ordering — all verified against the actual codebase and the stuscle repo. The single deferred item (live host-page widget re-dispatch) is E2E-deferred per explicit task instruction and the 133-03 precedent; the automated gate fully proves the re-dispatch shipped in source and in the committed artifact.

---

_Verified: 2026-07-17T19:05:00Z_
_Verifier: Claude (gsd-verifier)_

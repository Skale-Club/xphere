---
workstream: medusa-commerce
created: 2026-07-17
gsd_state_version: 1.0
milestone: medusa-commerce
milestone_name: Medusa Commerce Agent Integration
status: in_progress
last_updated: "2026-07-17T18:11:55.000Z"
last_activity: 2026-07-17 -- 134-01 landed (cart-sig sign helper + cross-repo vector, pinCartId cart-only re-pin, bumpConversationWriteCount 25-per-conversation cap, checkCommerceWritesPerTurn, SIDE_EFFECTING_ACTIONS/COMMERCE_WRITE_ACTIONS, MedusaExecCtx.emitStructured, both cart-write executors — wave 1 of Phase 134); tests/medusa-cart-write.test.ts 31/31 green, tests/agent-delegation.test.ts baseline-repaired; npm run build green
progress:
  total_phases: 7
  completed_phases: 3
  total_plans: 13
  completed_plans: 10
  percent: 43
---

# Project State — workstream medusa-commerce

## Project Reference

See: .planning/PROJECT.md (org-wide) and this workstream's ROADMAP.md / REQUIREMENTS.md.

**Core value:** Commerce tools act with visitor-level authority only — pinned identity, hard caps, no id parameters in tool schemas.
**Current focus:** Phase 134 — Cart Write Tools — IN PROGRESS (1 of 3 plans landed). Next: 134-02 (execute-action + run-agent wiring), depends on 134-01.

## Current Position

Phase: 134 of 137 (Cart Write Tools) — in progress, 1 of 3 plans landed
Plan: 1 of 3 in Phase 134 — 134-01 (cart-sig signer + primitives + both cart-write executors) done; 134-02 (execute-action/run-agent wiring), 134-03 (widget commerce re-dispatch) remain
Status: CRT-01, CRT-02, CRT-03, CRT-04 satisfied at the primitive/executor level (Wave 1) — signCartSig byte-matches stuscle's verifyCartSig (both cross-repo vectors locked), medusa_add_to_cart/medusa_update_cart_item are fully built and unit-tested but NOT yet reachable from the agent. Wave 2 must wire execute-action.ts's real dispatch + thread ActionContext.emitStructured from run-agent.ts + register both tools in ACTION_DESCRIPTIONS/spec.ts NODES before the tools go live.
Last activity: 2026-07-17 — 134-01 landed: Task 1 added src/lib/medusa/cart-sig.ts (signCartSig, Web Crypto HMAC-SHA256 hex, ['sign'] key usage — the sign counterpart to context.ts's ['verify']-only hmacKey), context.ts's pinCartId (cart-only re-pin merge, no verified_at stamp) + bumpConversationWriteCount (25-per-conversation durable cap in memory.commerce.write_count), client.ts's MedusaExecCtx.emitStructured, idempotency.ts's SIDE_EFFECTING_ACTIONS+COMMERCE_WRITE_ACTIONS additions, and guardrails.ts's checkCommerceWritesPerTurn. Task 2 added add-to-cart.ts (addToCartMedusa): ordered no-cart bootstrap (create -> sign -> metadata POST awaited 2xx -> pinCartId -> emit cart_created -> add line item -> emit cart_updated, proven via vitest invocationCallOrder), qty clamp 1-10, <=50-item rollback, R7/R8 fail-closed, product_id->variant resolution. Task 3 added update-cart-item.ts (updateCartItemMedusa): fuzzy title/variant line match within the pinned cart only, qty-0 DELETE reading the response's .parent (not .cart, Pitfall 3 — fixed mid-task to make the '.parent' substring textually explicit rather than hidden behind a `{ parent }` destructure), clamp otherwise, same R7/R8+25-cap preamble. tests/medusa-cart-write.test.ts (new, 31 tests, includes the two committed cross-repo sig vectors) and tests/agent-delegation.test.ts (baseline-repaired SIDE_EFFECTING_ACTIONS assertion, 4->6 documented types) both green; npm run build (typecheck) green with zero errors on first attempt.

Progress: [▓▓▓▓░░░░░░] 43% (3/7 phases)

## Performance Metrics

**Velocity:**
- Total plans completed: 10 (of 13 total across the workstream so far)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 131 | 2 | 24min | 12min |
| 132 | 4 | ~30min (132-04 only measured; 01-03 metrics not captured in this file) | — |
| 133 | 3/3 landed | ~48min (133-01: 20min, 133-02: 15min, 133-03: 13min) | ~16min |
| 134 | 1/3 landed | ~20min (134-01) | ~20min |

## Accumulated Context

### Decisions

- 131-01: rateLimit's memory-fallback failMode is a per-instance **fixed-window Map** (CONTEXT.md's locked decision), not the "token-bucket" wording used elsewhere in REQUIREMENTS.md/contract — semantically equivalent for this purpose, documented in a code comment in `src/lib/rate-limit.ts` to prevent future confusion.
- 131-03: R4 (`chat:newsess:{ip}`) gates ANY session-create path — fresh (no sessionId), bogus/expired sessionId (Redis miss), and org-mismatched sessionId — not just the narrow "no sessionId" reading; the org-mismatch branch double-charges R3 then R4, accepted as a negligible edge-case cost. This matches the phase research's Pitfall 4 analysis and closes what would otherwise be an unbounded session-creation bypass.
- 131-03: `getSession` is called exactly once per request (org-independent, before org resolve) and reused for both the R3/R4 gate and the later session resolve/create decision — avoids a second Redis round trip; the two former byte-identical session-create blocks were deduplicated into `createNewSession(orgId)`.
- 131-03: Shared `getClientIp(request)` now lives in `src/lib/request-ip.ts`, used by both the chat route and the widget config route — no inline `x-forwarded-for` parsing remains in either.
- FROZEN contract: `.planning/research/INTEGRATION-CONTRACT.md` (canonical copy lives in the stuscle repo at `docs/INTEGRATION-XPHERE.md`). Payloads/headers/endpoints must match it exactly; changes require editing the contract first in BOTH repos.
- The Stuscle half (widget mount + mint route, wishlist module, `/agent/*` HMAC surface, event subscribers) is built in `C:\Users\Vanildo\Dev\stuscle` (its own GSD project, phases 1–5). Xphere phases must stay testable standalone (curl/mocks) — E2E lands when both sides ship.
- Model policy: gsd-executor on sonnet; plan-checker/verifier/integration-checker/nyquist-auditor on opus (`.planning/config.json` model_overrides).
- Anti-IDOR core rule (applies to EVERY commerce tool): tool input schemas contain NO cart_id/customer_id/email/order_id parameters — executors inject pinned ids from `conversations.memory.commerce` exclusively.
- Commerce write limits are fail-CLOSED (R7/R8/R9); read/chat limits fail to in-process memory fallback. Existing rate-limit call sites keep fail-open.
- Phase numbering 131–137 continues the global sequence (calendar-reliability workstream owns 126–130). Migration numbering: check latest `supabase/migrations/` at execution time (1258+ when planned).
- 132-04: R6 (`com:read:{sessionId}`) keys on `session_key ?? conversationId`, resolved from the SAME `conversations` lookup that returns pinned `memory.commerce` — one round-trip per executor call, per 132-RESEARCH.md Open Q1's recommendation.
- 132-04: `medusa_get_cart`'s anti-IDOR guarantee is structural — the executor's signature is `(creds, ctx)` with no `params` argument at all, so a caller-supplied cart id has no channel into the call (stronger than "the executor ignores it").
- 132-04: the six not-yet-built `medusa_*` action types (add_to_cart, update_cart_item, wishlist_add/remove/list, get_order_status) share one grouped `execute-action.ts` switch case returning a placeholder string, keeping the exhaustive `default: never` switch compiling ahead of the phases that implement them; they are absent from `ACTION_DESCRIPTIONS`/`spec.ts` NODES so the LLM can never select them.
- 132-04: widening `database.ts`'s `action_type` union also broke a second, previously-unnoticed exhaustive `Record<action_type, string>` (`ACTION_TYPE_LABELS` in the tool-config detail dashboard page) — fixed as an in-scope Rule 3 blocking issue. Future `action_type` enum widenings should grep for `Record<.*action_type.*, string>` in addition to the two `database.ts` unions.
- 133-01: pinned cart key is `cart` (matching Phase 132's shipped `get-cart.ts` reader, `commerce.cart`), NOT `cart_id` as CONTEXT.md's forward-looking wording suggested — 133-RESEARCH.md Open Q1 Option A, zero changes to already-merged Phase 132 executors. `cus` (not `customer_id`) is likewise the verbatim contract §3 claim name; future readers (Phase 135/137) must read `commerce.cus`.
- 133-01: HMAC key for `verifyCommerceContext` is the raw UTF-8 bytes of the `xph_...` connection-token STRING (`TextEncoder().encode(connectionToken)`), NOT the hex-decoded 32-byte key that `src/lib/email/unsubscribe-token.ts`/`src/lib/crypto.ts` use for `ENCRYPTION_SECRET` — this is what agrees byte-for-byte with stuscle's `node:crypto createHmac('sha256', XPHERE_CONNECTION_TOKEN)` mint. Locked by a committed literal cross-repo test vector in `tests/medusa-context.test.ts`.
- 133-01: `readCommerceContext` is a thin wrapper delegating to Phase 132's `loadPinnedContext` — no second, divergent reader of `conversations.memory.commerce` was introduced.
- 133-02: the verify+pin block is inserted as step "6b" (between the existing persist-message step and the `runAgent` call) in `src/app/api/chat/[token]/route.ts`, wrapped in a single try/catch — every failure branch (no creds for the org, `verifyCommerceContext` returns null, `writeCommerceContext` throws) logs a warn (`commerce_ctx_invalid` / `commerce_ctx_error`) and falls through; nothing in the block can turn the chat's 200 SSE response into an error. The block is skipped entirely when `commerce_context` is absent, so orgs without a medusa integration incur zero extra DB/crypto cost.
- 133-03: `tests/widget.test.ts` had 2 pre-existing stale assertions (config-fetch missing `?u=<pageUrl>`, chat POST body missing `pageUrl`) unrelated to Phase 133 — repaired as a Wave-0 baseline fix before touching the widget source, matching the 131-01 baseline-repair precedent.
- 133-03: `public/widget.js` was un-ignored in `.gitignore` (it had been untracked as a pure build artifact since an April 2026 chore commit) and is now committed alongside every widget-touching plan going forward — required because `tests/widget.test.ts` reads the file from disk via `readFileSync` and this plan's success criteria explicitly required the rebuilt bundle committed. `public/reviews-widget.js` remains gitignored (unaffected, out of scope). Production deploys are unaffected either way since `npm run build` always rebuilds `public/widget.js` fresh via esbuild.
- 133-03: the widget's `commerce`/`cart_created` SSE handling is guarded by a plain string comparison (`evt.event === 'commerce' && evt.action === 'cart_created'`) — inert until Phase 134 emits that event; no widget re-dispatch to `window` for other consumers is added yet (that's Phase 134's `CRT-04`, `xphere:commerce` CustomEvent).
- 133-03: Task 3's manual browser checkpoint (real same-origin cookie-backed context fetch, verified via `public/widget-test.html` against a live stuscle storefront) was deferred rather than blocking plan completion — no live xphere+stuscle stack exists in this execution environment. The jsdom-covered contract (conditional `commerce_context`, never blocking chat when the endpoint is absent/failing) is proven by the green `tests/widget.test.ts` suite; the real cross-repo same-origin fetch remains a TODO for the contract §9 dev-wiring step.
- 134-01: `signCartSig` output is lowercase HEX (not base64url like the Phase 133 context-token sig) — the one deliberate divergence from that convention; the CryptoKey is imported with `['sign']` usage (`context.ts`'s `hmacKey` uses `['verify']`, which cannot sign). Both cross-repo vectors (`cart_01ABC`/`xph_test_connection_token_abc123` -> `f770a654...`, `cart_01ADOPT`/`xph_test` -> `a4d0db1b...`) are committed as permanent regression assertions in `tests/medusa-cart-write.test.ts`.
- 134-01: the 25-per-conversation write cap lives in `memory.commerce.write_count` (`bumpConversationWriteCount`), not Redis — durable across turns/invocations, resolving 134-RESEARCH.md's Open Q1 in favor of the DB-counter option (R7/R8's time-windowed budgets remain Redis-backed and fail-closed).
- 134-01: `add-to-cart`'s no-cart bootstrap sequence (create -> sign -> metadata POST awaited 2xx -> `pinCartId` -> emit `cart_created` -> add line item -> emit `cart_updated`) is proven strictly ordered via vitest `invocationCallOrder` assertions across the mocked `medusaStoreFetch` and `emitStructured` spy — not just code-reading — protecting the load-bearing ordering invariant (134-RESEARCH.md Pitfall 2) against future refactors.
- 134-01: `update-cart-item.ts`'s DELETE branch intentionally avoids destructuring the response as `{ parent }`; it names the whole response `deleteResponse` and reads `deleteResponse.parent.items` / `deleteResponse.parent` explicitly, so the `.parent`-vs-`.cart` distinction (Pitfall 3) stays textually visible in the source for future readers (and the plan's `grep -n "\.parent"` acceptance check).

### Blockers

(None)

### Notes

- `conversations.memory` JSONB already exists (migration 015) — commerce context lives at `memory.commerce`, no schema change needed for pinning.
- `ActionContext` already has `conversationId?` (added for DND in 1085) — run-agent call sites just need to pass it.
- Chat route: rate limits R1-R5 + message cap + maxDuration 60 landed in 131-03 (CHT-02, CHT-03 satisfied) — before any commerce tool ships.
- Xkedule integration (`src/lib/xkedule/*`, migration 1200) is the template for the Medusa provider.

## Session Continuity
**Stopped At:** Completed 134-01-PLAN.md (cart-sig sign helper + cross-repo vector, pinCartId, bumpConversationWriteCount, checkCommerceWritesPerTurn, SIDE_EFFECTING_ACTIONS/COMMERCE_WRITE_ACTIONS, MedusaExecCtx.emitStructured, medusa_add_to_cart + medusa_update_cart_item executors — Wave 1 of Phase 134). CRT-01..04 are satisfied at the primitive/executor level; the tools are not yet wired into the agent.
**Resume File:** None — next up is executing 134-02-PLAN.md (execute-action real dispatch + ActionContext.emitStructured + run-agent emitStructured:emit streaming wiring + per-turn cap in both tool loops + ACTION_DESCRIPTIONS/spec.ts NODES registration), which depends on 134-01 (this plan, now landed). No blockers. Real cross-repo same-origin context-fetch verification (133-03's deferred Task 3) remains outstanding separately for whenever xphere + stuscle run together (contract §9 dev-wiring).

---
workstream: medusa-commerce
created: 2026-07-17
gsd_state_version: 1.0
milestone: medusa-commerce
milestone_name: Medusa Commerce Agent Integration
status: in_progress
last_updated: "2026-07-17T19:35:21.000Z"
last_activity: 2026-07-17 -- 135-02 landed (wave 2 of Phase 135, dispatcher/registry wiring): execute-action.ts real-dispatches medusa_wishlist_add/remove/list to the Wave-1 executors behind the same never-throw guard as the cart-write block; medusa_get_order_status is now the ONLY case left in the "not available yet" stub group (reserved for Phase 137); SIDE_EFFECTING_ACTIONS += medusa_wishlist_add/medusa_wishlist_remove (list excluded, COMMERCE_WRITE_ACTIONS unchanged so wishlist writes stay out of the cart-only 3/turn+25/conversation caps); ACTION_DESCRIPTIONS + workflows/spec.ts NODES register all three tools (integration_required medusa, zero owner/customer/guest/cart/email params). CI=true npx vitest run tests/medusa-dispatch.test.ts tests/medusa-wiring.test.ts tests/medusa-spec.test.ts green (38/38); tests/medusa-agent-fetch.test.ts + tests/medusa-wishlist.test.ts still green (28/28, 135-01 unaffected); npm run build clean (exit 0, "Compiled successfully"). Phase 135 (Wishlist Tools) is now COMPLETE -- WSL-01/WSL-02 both satisfied end-to-end.
progress:
  total_phases: 7
  completed_phases: 5
  total_plans: 15
  completed_plans: 15
  percent: 71
---

# Project State — workstream medusa-commerce

## Project Reference

See: .planning/PROJECT.md (org-wide) and this workstream's ROADMAP.md / REQUIREMENTS.md.

**Core value:** Commerce tools act with visitor-level authority only — pinned identity, hard caps, no id parameters in tool schemas.
**Current focus:** Phase 135 — Wishlist Tools — COMPLETE. Next up: Phase 136 (Commerce Events Ingestion) — research/validation docs already landed, plan authoring next.

## Current Position

Phase: 135 of 137 (Wishlist Tools) — COMPLETE, 2 of 2 plans landed
Plan: 2 of 2 in Phase 135 — 135-01 (medusaAgentFetch signed transport + signAgentBody + 3 wishlist executors) done; 135-02 (execute-action/registry wiring) done
Status: WSL-01 and WSL-02 are fully satisfied end-to-end. medusaAgentFetch signs-then-sends the identical body string (byte-proven against stuscle's verify-hmac.ts), resolveWishlistOwner returns owner exclusively from pinned cus/wishlist_ref (never from params), and all three executors (addWishlistItem/removeWishlistItem/listWishlist) never throw into the tool loop (135-01). Now wired into execute-action.ts's real dispatch, ACTION_DESCRIPTIONS, workflows/spec.ts NODES (integration_required medusa, zero owner params), and SIDE_EFFECTING_ACTIONS (add/remove only, list stays a read tool, COMMERCE_WRITE_ACTIONS unchanged) (135-02). medusa_get_order_status is now the ONLY remaining "not available yet" stub in execute-action.ts, reserved for Phase 137.
Last activity: 2026-07-17 — 135-02 landed (wave 2 of Phase 135, final plan of the phase): Task 1 split the old 4-case wishlist/order-status stub group in execute-action.ts — medusa_wishlist_add/remove/list now dispatch to the Wave-1 executors behind the same never-throw guard as the cart-write block (ctx?.organizationId/ctx?.supabase check -> getMedusaCredentialsForOrg -> per-action-type branch); medusa_get_order_status is the sole remaining stub. idempotency.ts registered medusa_wishlist_add/medusa_wishlist_remove in SIDE_EFFECTING_ACTIONS (list excluded; COMMERCE_WRITE_ACTIONS untouched, still exactly the 2 cart writes). Task 2 added 3 ACTION_DESCRIPTIONS entries (run-agent.ts) and 3 NodeSpec entries (workflows/spec.ts, integration_required:['medusa']) — add/remove expose only product_id/variant_id, list exposes {}, no customer_id/guest_ref/cart_id/email anywhere. CI=true npx vitest run tests/medusa-dispatch.test.ts tests/medusa-wiring.test.ts tests/medusa-spec.test.ts green (38/38); tests/medusa-agent-fetch.test.ts + tests/medusa-wishlist.test.ts still green (28/28, 135-01 unaffected); npm run build clean (exit 0, "Compiled successfully"). One Rule-3 blocking deviation: reworded an idempotency.ts comment that had accidentally embedded the literal substring "medusa_wishlist_list", which broke the plan's own grep-based acceptance check for that string's absence from the file.

Progress: [▓▓▓▓▓▓▓░░░] 71% (5/7 phases)

## Performance Metrics

**Velocity:**
- Total plans completed: 15 (of 15 total across the workstream so far — Phases 131-135 fully landed; Phases 136-137 not yet planned)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 131 | 3/3 landed | 24min (131-01/131-03 measured; 131-02 metrics not captured in this file) | — |
| 132 | 4/4 landed | ~30min (132-04 only measured; 01-03 metrics not captured in this file) | — |
| 133 | 3/3 landed | ~48min (133-01: 20min, 133-02: 15min, 133-03: 13min) | ~16min |
| 134 | 3/3 landed | ~39min (134-01: ~20min, 134-02: ~12min, 134-03: ~7min) | ~13min |
| 135 | 2/2 landed | 65min (135-01: 45min, 135-02: ~20min) | ~33min |

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
- 134-02: `ActionContext` (execute-action.ts's caller-facing type) is passed straight through to the medusa write executors as `MedusaExecCtx` with no adapter or cast — its required-field shape is a structural superset, and the streaming closure `emit: (obj: object) => void` is directly assignable to `emitStructured?: (obj: Record<string, unknown>) => void` by TS's contravariant function-parameter checking (`Record<string, unknown>` is a subtype of `object`).
- 134-02: `emitStructured: emit` is set on the streaming `executeAction` context object literal ONLY — the blocking call site's context object has no `emitStructured` field at all (not even `undefined`), keeping Wave 1's "executors null-check `ctx.emitStructured?.()`" contract literally true, not just conventionally true. Verified by a source-assertion test that counts exactly one `emitStructured: emit` occurrence across the whole file.
- 134-02: the per-turn commerce-write cap (`checkCommerceWritesPerTurn`) is checked inside each tool's `execute()` closure, gated by `COMMERCE_WRITE_ACTIONS.has(capturedActionType)`, placed AFTER the idempotency cache-hit early-return and BEFORE `executeAction` — a cached-response replay never increments `commerceWrites`; only a genuine dispatch attempt does. A breach returns a denial string (never throws) and logs `denied_reason: 'commerce_turn_cap'` in `toolCallsLog`, matching every other denial path in the loop.
- 134-03: the widget's `commerce`/`cart_created` branch (inert since 133-03) is now widened to fire the `xphere:commerce` `window.CustomEvent` for EVERY `commerce` event, with the `cart_created` cache-clear kept as an additive nested check, not a replacement — `cart_updated` frames (from `update-cart-item.ts`, 134-01) now reach the host page too, which the cache-clear-only version could not do.
- 134-03: the bundle-content assertion (`tests/widget.test.ts` asserting `public/widget.js` contains the literal string `xphere:commerce`) is a deliberate live-stack-free proof of the SHIPPED artifact, not just the source — jsdom can't observe a real cross-window `dispatchEvent` call meaningfully in this harness, and a stale/un-rebuilt bundle is exactly the risk the plan's Pitfall 7 called out.
- 134-03: **Phase 134 (Cart Write Tools) is complete** — CRT-01 through CRT-04 all satisfied end-to-end, executor to browser. Widget commerce re-dispatch closes the loop opened by Wave 1's `cart_created`/`cart_updated` SSE emission (134-01) and Wave 2's live wiring (134-02).
- 135-01: `signAgentBody` lives in its own `agent-sig.ts` file (sibling to `cart-sig.ts`), not an extension of `cart-sig.ts` — same raw-UTF8-key Web Crypto convention (`['sign']` usage, no hex-decode, no `xph_` strip), only the signed message differs (`${ts}.${rawBody}` vs bare `cartId`). Returns BARE hex; `medusaAgentFetch` (client.ts) is the ONLY place that writes the `v1=` scheme tag.
- 135-01: wishlist writes (`addWishlistItem`/`removeWishlistItem`) share the SAME `com:write:`/`com:write:day:` rate-limit keys as cart writes (contract §7 reads "commerce writes per session" as tool-agnostic) — one shared session/day write budget across cart and wishlist mutations, not separate wishlist-only keys.
- 135-01: wishlist writes are deliberately NOT added to `COMMERCE_WRITE_ACTIONS`/`bumpConversationWriteCount` (the cart-only 3/turn + 25/conversation guardrail caps) — R7/R8 alone bound wishlist write volume for this wave, per 135-RESEARCH.md Open Q1's "follow CONTEXT" recommendation. `SIDE_EFFECTING_ACTIONS` registration and all dispatcher/registry wiring is Wave 2 (135-02), not this plan.
- 135-01: `resolveWishlistOwner` prefers `cus` (customer_id) over `wishlist_ref` (guest_ref) when both are pinned — a verified customer identity outranks the guest cookie fallback; returns exactly one owner key or `null` (never both, never an `undefined` sibling), matching stuscle's `ownerSchema.refine(!!customer_id !== !!guest_ref)` XOR constraint.
- 135-01: `listWishlist` takes `(creds, ctx)` with NO params argument at all (mirrors `getMedusaCart`) — the anti-IDOR guarantee is structural, not just conventional: a caller-supplied identifier has no channel into the call.
- 135-02: `medusa_get_order_status` is now the ONLY case left in execute-action.ts's "not available yet" stub group (Phase 137) — the wishlist stub group from 132-04/135-01 has been fully replaced by real dispatch.
- 135-02: `medusa_wishlist_add`/`medusa_wishlist_remove` are registered in `SIDE_EFFECTING_ACTIONS` for idempotency wrapping but deliberately NOT added to `COMMERCE_WRITE_ACTIONS` — that set stays exactly the 2 cart writes, so wishlist writes never count against the cart-only 3/turn + 25/conversation guardrail caps (per 135-01's decision, executed here).
- 135-02: **Phase 135 (Wishlist Tools) is complete** — WSL-01 and WSL-02 both satisfied end-to-end (135-01's signed transport/owner-resolution/executors + 135-02's dispatcher/registry/idempotency wiring).

### Blockers

(None)

### Notes

- `conversations.memory` JSONB already exists (migration 015) — commerce context lives at `memory.commerce`, no schema change needed for pinning.
- `ActionContext` already has `conversationId?` (added for DND in 1085) — run-agent call sites just need to pass it.
- Chat route: rate limits R1-R5 + message cap + maxDuration 60 landed in 131-03 (CHT-02, CHT-03 satisfied) — before any commerce tool ships.
- Xkedule integration (`src/lib/xkedule/*`, migration 1200) is the template for the Medusa provider.

## Session Continuity
**Stopped At:** Completed 135-02-PLAN.md (execute-action.ts real dispatch for medusa_wishlist_add/remove/list behind the cart-write block's never-throw guard, leaving medusa_get_order_status as the sole remaining stub for Phase 137; SIDE_EFFECTING_ACTIONS += medusa_wishlist_add/medusa_wishlist_remove with COMMERCE_WRITE_ACTIONS unchanged; ACTION_DESCRIPTIONS + workflows/spec.ts NODES registered for all three wishlist tools, zero owner/customer/guest/cart/email params — wave 2 (final) of Phase 135, WSL-01/WSL-02 fully satisfied end-to-end). **Phase 135 (Wishlist Tools) is COMPLETE.**
**Resume File:** None — Phase 135 is done. Next up is Phase 136 (Commerce Events Ingestion): 136-RESEARCH.md and 136-VALIDATION.md already landed (docs(136) commit); plan authoring (`/gsd:plan-phase 136`) is the next step. No blockers. Real cross-repo same-origin context-fetch AND widget-to-storefront-bridge re-dispatch verification (133-03's and 134-03's deferred manual checkpoints) remain outstanding for whenever xphere + stuscle run together (contract §9 dev-wiring). The live signed `/agent/wishlists/*` round trip against a running Stuscle backend is likewise E2E-deferred (135-VALIDATION.md Manual-Only table) — both 135-01's and 135-02's unit tests mock the transport throughout. One pre-existing, unrelated bookkeeping item remains logged (not fixed) in `134-cart-write-tools/deferred-items.md`: `131-02-PLAN.md`'s ROADMAP.md checkbox was never flipped despite its SUMMARY.md existing.

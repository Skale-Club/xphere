---
workstream: medusa-commerce
created: 2026-07-17
gsd_state_version: 1.0
milestone: medusa-commerce
milestone_name: Medusa Commerce Agent Integration
status: in_progress
last_updated: "2026-07-17T16:57:26.000Z"
last_activity: 2026-07-17 -- 133-02 landed (chat route commerce_context schema + fail-soft verify+pin block before runAgent, wave 2 of Phase 133); 29/29 chat-api tests green (22 existing + 7 new), 41/41 scoped gate (chat-api + medusa-context), build green
progress:
  total_phases: 7
  completed_phases: 2
  total_plans: 10
  completed_plans: 8
  percent: 29
---

# Project State — workstream medusa-commerce

## Project Reference

See: .planning/PROJECT.md (org-wide) and this workstream's ROADMAP.md / REQUIREMENTS.md.

**Core value:** Commerce tools act with visitor-level authority only — pinned identity, hard caps, no id parameters in tool schemas.
**Current focus:** Phase 133 — Signed Context & Identity Pinning (wave 1 of 3 landed: verify + pinning core)

## Current Position

Phase: 133 of 137 (Signed Context & Identity Pinning) — in progress, 2 of 3 plans landed (waves 1-2)
Plan: 2 of 3 in Phase 133 — 133-01 (verify + pinning core) and 133-02 (chat route wiring) done; 133-03 (widget forwarding) remains
Status: CTX-01 and CTX-02 fully satisfied (verify/pin core + route wiring); CTX-03 (widget) pending 133-03
Last activity: 2026-07-17 — 133-02 landed: ChatRequestSchema += commerce_context (<=2048), and a fail-soft verify+pin block (getMedusaCredentialsForOrg -> verifyCommerceContext -> writeCommerceContext) inserted after session settle, before runAgent, in src/app/api/chat/[token]/route.ts; absent token costs nothing, every failure path warns and the chat still streams 200; 29/29 chat-api tests green (22 existing + 7 new), 41/41 scoped gate (chat-api + medusa-context), npm run build green

Progress: [▓▓▓░░░░░░░] 29% (2/7 phases)

## Performance Metrics

**Velocity:**
- Total plans completed: 8 (of 10 total across the workstream so far)

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| 131 | 2 | 24min | 12min |
| 132 | 4 | ~30min (132-04 only measured; 01-03 metrics not captured in this file) | — |
| 133 | 2/3 landed | ~35min (133-01: 20min, 133-02: 15min) | ~18min |

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

### Blockers

(None)

### Notes

- `conversations.memory` JSONB already exists (migration 015) — commerce context lives at `memory.commerce`, no schema change needed for pinning.
- `ActionContext` already has `conversationId?` (added for DND in 1085) — run-agent call sites just need to pass it.
- Chat route: rate limits R1-R5 + message cap + maxDuration 60 landed in 131-03 (CHT-02, CHT-03 satisfied) — before any commerce tool ships.
- Xkedule integration (`src/lib/xkedule/*`, migration 1200) is the template for the Medusa provider.

## Session Continuity
**Stopped At:** Completed 133-02-PLAN.md (chat route: `commerce_context` schema + fail-soft verify+pin block before `runAgent`; CTX-02 fully satisfied)
**Resume File:** None — next up is 133-03-PLAN.md (widget: `data-context-endpoint` same-origin fetch + conditional `commerce_context` POST + `Opps.setContext` + `build:widget` commit; CTX-03, wave 3, depends on 133-02).

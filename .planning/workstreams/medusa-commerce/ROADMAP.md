# Roadmap: Medusa Commerce Agent Integration (workstream medusa-commerce)

## Overview

Seven phases give xphere agents commerce powers over a connected Medusa store (Stuscle) through the web widget, guarded by hard rate limits and a signed visitor-identity binding. Everything builds against the FROZEN contract at `.planning/research/INTEGRATION-CONTRACT.md` — payloads, headers, and endpoints must match it exactly. The Stuscle half (widget mount, context mint route, wishlist module, `/agent/*` surface, event subscribers) is built in its own repo (`C:\Users\Vanildo\Dev\stuscle`) and is expected to exist by E2E time; each phase here remains testable standalone with curl/mocks.

## Phases

- [x] **Phase 131: Chat Route Hardening** - Rate-limit matrix + message cap + failMode extension on the public chat endpoint (pre-existing gap, standalone value) ✅ 2026-07-17
- [x] **Phase 132: Medusa Provider & Read Tools** - `medusa` integration provider, credentials/client, product search/detail + cart view tools ✅ 2026-07-17
- [ ] **Phase 133: Signed Context & Identity Pinning** - Verify the storefront-minted context token, pin cart/customer to the conversation, widget context forwarding
- [ ] **Phase 134: Cart Write Tools** - add-to-cart / update-cart-item with clamps, write caps, idempotency, SSE commerce events, widget re-dispatch
- [ ] **Phase 135: Wishlist Tools** - wishlist add/remove/list via the Stuscle HMAC `/agent/*` surface
- [ ] **Phase 136: Commerce Events Ingestion** - `/api/v1/commerce/events` endpoint, `commerce:events` scope, receipts dedupe, workflow event dispatch
- [ ] **Phase 137: Product Cards & Order Status** - `ui`/`product_cards` SSE + widget renderer, order-status tool (logged-in only), CRM contact linking

## Phase Details

### Phase 131: Chat Route Hardening
**Goal**: The public `/api/chat/{token}` endpoint can no longer be used to burn an org's LLM budget or flood the runtime — independent of any commerce feature.
**Depends on**: Nothing
**Requirements**: CHT-01, CHT-02, CHT-03, CHT-04
**Success Criteria** (what must be TRUE):
  1. `src/lib/rate-limit.ts` supports `failMode: 'open' | 'memory' | 'closed'` — `memory` falls back to a per-instance token bucket when Redis is down, `closed` denies; existing call sites keep `open` behavior unchanged.
  2. The chat route enforces R1 (20 msgs/min/IP, before org lookup), R2 (200/day/IP), R3 (10/min/session), R4 (10 new sessions/hour/IP), R5 (300/min/org) — over-limit requests get 429 with a friendly SSE-compatible error body.
  3. `ChatRequestSchema.message` is capped at 4,000 chars (400 on violation) and the route's `maxDuration` is 60.
  4. The legacy `custom_webhook` executor calls `assertPublicHttpUrl` before fetching (SSRF gap closed); unit tests cover the limiter failModes and the new caps.
**Plans**: 3 plans

Plans:
- [x] 131-01-PLAN.md — Wave 0 baseline repair + rateLimit failMode extension with bounded memory fallback (CHT-01)
- [ ] 131-02-PLAN.md — custom_webhook SSRF guard via assertPublicHttpUrl (CHT-04)
- [x] 131-03-PLAN.md — Chat route R1–R5 matrix + message cap + maxDuration 60 + shared IP helper (CHT-02, CHT-03)

### Phase 132: Medusa Provider & Read Tools
**Goal**: An org can connect its Medusa store in Integrations, and agents with the tools attached answer product and cart questions with region-correct prices.
**Depends on**: Phase 131
**Requirements**: MED-01, MED-02, MED-03, MED-04
**Success Criteria** (what must be TRUE):
  1. A migration adds `medusa` to `integration_provider` and all `medusa_*` values to `action_type` (search_products, get_product, get_cart, add_to_cart, update_cart_item, wishlist_add, wishlist_remove, wishlist_list, get_order_status) in ONE migration; `src/types/database.ts` regenerated.
  2. The Integrations UI lists Medusa (Server URL + Publishable Key + Connection Token fields); credentials round-trip encrypted through the `integrations` row.
  3. `medusa_search_products`, `medusa_get_product`, `medusa_get_cart` execute via `execute-action.ts` against the store API (`x-publishable-api-key`), 8s timeout, 120/min/org budget (R11), returning concise natural-language strings; `medusa_get_cart` reads the cart id ONLY from pinned conversation context (no id parameter in any tool schema).
  4. `run-agent.ts` passes `conversationId` into `executeAction` context at both call sites; `ACTION_DESCRIPTIONS` and `workflows/spec.ts` NODES registered with `integration_required: ['medusa']`.
**Plans**: 4 plans

Plans:
- [x] 132-01-PLAN.md — Migration 1259 + integration_provider enum + Medusa registry entry (MED-01, MED-02) [wave 1]
- [x] 132-02-PLAN.md — Medusa credentials + Store API client (R11 + 8s + x-publishable-api-key) (MED-02, MED-03) [wave 1]
- [x] 132-03-PLAN.md — run-agent conversationId wiring + ACTION_DESCRIPTIONS + spec.ts NODES (MED-04) [wave 1]
- [x] 132-04-PLAN.md — Read executors (search / get-product / get-cart) + action_type enum + exhaustive dispatcher (MED-01, MED-03, MED-04) [wave 2] ✅ 2026-07-17

### Phase 133: Signed Context & Identity Pinning
**Goal**: The conversation is bound to the visitor's real cart/customer via the storefront-signed token — the IDOR barrier — and the widget forwards context.
**Depends on**: Phase 132
**Requirements**: CTX-01, CTX-02, CTX-03
**Success Criteria** (what must be TRUE):
  1. `verifyCommerceContext` validates HMAC (timing-safe) + `exp` + `org` (must equal the widget token's org) per contract §3, using the org's decrypted medusa connection token; invalid/absent tokens are dropped fail-soft (chat continues, warn logged).
  2. The chat route accepts optional `commerce_context` (max 2048) and merges verified claims into `conversations.memory.commerce`; re-pinning happens only from a newly VERIFIED token, never from message text.
  3. The widget (src/widget/index.ts) reads `data-context-endpoint`, lazily fetches `{token}` from the host page (cache until exp), sends it as `commerce_context` on every POST, exposes `Opps.setContext(token)`; `npm run build:widget` output committed.
  4. Unit tests cover verify (valid/expired/bad sig/wrong org) and pinning rules.
**Plans**: 3 plans

Plans:
- [x] 133-01-PLAN.md — verifyCommerceContext (raw-utf8 HMAC key + exp + org) + writeCommerceContext pinning under contract claim names; cross-repo vector + read-back tests (CTX-01, CTX-02) [wave 1]
- [ ] 133-02-PLAN.md — chat route: accept commerce_context (<=2048) + fail-soft verify+pin before runAgent (CTX-02) [wave 2]
- [ ] 133-03-PLAN.md — widget data-context-endpoint same-origin fetch + conditional commerce_context POST + Opps.setContext + build:widget commit; tests/widget.test.ts baseline repair (CTX-03) [wave 3]

### Phase 134: Cart Write Tools
**Goal**: The agent builds the visitor's real cart — bounded, idempotent, and reflected live to the storefront.
**Depends on**: Phase 133
**Requirements**: CRT-01, CRT-02, CRT-03, CRT-04
**Success Criteria** (what must be TRUE):
  1. `medusa_add_to_cart` / `medusa_update_cart_item` operate exclusively on the pinned cart; when no cart is pinned, add-to-cart creates one (region from context), writes `metadata.xphere_sig = hex(HMAC(secret, cart_id))`, pins it, and emits SSE `{event:'commerce', action:'cart_created', cartId, itemCount, sig}`.
  2. Executor-level clamps hold: quantity 1–10/op, ≤50 line items, R7 (10 writes/min/session, fail-closed), R8 (60 writes/day/conversation, fail-closed), 3 side-effecting commerce calls/turn + 25/conversation in guardrails; both tools in `SIDE_EFFECTING_ACTIONS`.
  3. `ActionContext` gains `emitStructured?`; the streaming path passes the SSE emitter; successful writes emit `cart_updated` events; the widget re-dispatches `commerce` events as `CustomEvent('xphere:commerce')` on window (rebuilt widget committed).
  4. Unit tests cover clamps, no-cart→create+sign+pin flow, and cap enforcement.
**Plans**: TBD

### Phase 135: Wishlist Tools
**Goal**: The agent saves/lists/removes wishlist items for the visitor via Stuscle's HMAC-guarded `/agent/*` surface.
**Depends on**: Phase 134
**Requirements**: WSL-01, WSL-02
**Success Criteria** (what must be TRUE):
  1. `medusa_wishlist_add/remove/list` call `POST {base}/agent/wishlists/{add,remove,list}` signed per contract §4.2 (`X-Xphere-Timestamp` + `X-Xphere-Signature: v1=hex(hmac(secret, ts + "." + rawBody))`), owner resolved ONLY from pinned context (customer_id, else wishlist_ref; neither → tool explains nothing is saved yet and how it works).
  2. add/remove are in `SIDE_EFFECTING_ACTIONS`, covered by R7/R8 write budgets; list is a read (R6); signing helper unit-tested against a reference vector.
**Plans**: TBD

### Phase 136: Commerce Events Ingestion
**Goal**: Orders and new customers from Medusa land in xphere idempotently, create/annotate contacts, and fire CRM workflows.
**Depends on**: Phase 132
**Requirements**: EVI-01, EVI-02, EVI-03
**Success Criteria** (what must be TRUE):
  1. `commerce:events` scope exists in `api-keys/scopes.ts`; `POST /api/v1/commerce/events` (clone of `/api/v1/leads` skeleton: 64KB cap, `verifyApiKey`, zod per contract §5, `Idempotency-Key === event_id`) returns 201/200-duplicate/401/403/422 exactly per contract.
  2. Migration adds `commerce_event_receipts` (UNIQUE(org_id, event_id), RLS org-scoped); duplicate events return 200 without re-dispatch.
  3. `emitCommerceEvent` mirrors `emitLeadCaptured`: find-or-create contact by email, annotate the conversation whose `memory.commerce.cart_id` matches `data.cart_id` (`last_order_display_id`), dispatch workflows on `commerce.order.placed` / `commerce.customer.created` with `event_dispatches` audit; TRIGGERS registered in `workflows/spec.ts`.
**Plans**: TBD

### Phase 137: Product Cards & Order Status
**Goal**: Product answers render as rich cards in the widget, and logged-in shoppers get order status; webchat conversations link to CRM contacts.
**Depends on**: Phases 134, 136
**Requirements**: UIX-01, UIX-02, UIX-03
**Success Criteria** (what must be TRUE):
  1. Search/get-product tools additionally emit `{event:'ui', component:'product_cards', items:[...]}` (≤5 items, url storefront-relative per contract §6); the widget buffers `ui` events and renders cards after the answer using createElement/textContent only — the "Add to cart" button routes through `Opps.sendMessage` (never a direct API call); rebuilt widget committed.
  2. `medusa_get_order_status` calls Stuscle `POST /agent/orders/status` with the PINNED customer_id only (guests get a friendly "log in on the store" answer; R9 5 lookups/day/session, fail-closed).
  3. When a verified context carries `email`, the chat route find-or-creates the contact and sets `conversations.contact_id` + `visitor_email`.
**Plans**: TBD

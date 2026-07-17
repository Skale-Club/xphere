# Requirements: Medusa Commerce Agent Integration (workstream medusa-commerce)

**Defined:** 2026-07-17
**Core Value:** Commerce tools act with visitor-level authority only — pinned identity, hard caps, no id parameters in tool schemas.

Contract reference for every requirement: `.planning/research/INTEGRATION-CONTRACT.md` (FROZEN).

## v1 Requirements

### Chat Hardening (CHT)

- [x] **CHT-01**: `rate-limit.ts` gains `failMode: 'open'|'memory'|'closed'` (memory = per-instance token-bucket fallback; closed = deny when Redis down); existing call sites unchanged
- [ ] **CHT-02**: Chat route enforces R1 20/min/IP (before org lookup), R2 200/day/IP, R3 10/min/session, R4 10 new sessions/hour/IP, R5 300/min/org — 429 on breach
- [ ] **CHT-03**: `message` capped at 4,000 chars; chat route `maxDuration = 60`
- [ ] **CHT-04**: Legacy `custom_webhook` executor guarded by `assertPublicHttpUrl` (SSRF)

### Medusa Provider & Read Tools (MED)

- [ ] **MED-01**: One migration adds `integration_provider 'medusa'` + all nine `medusa_*` action_types; `src/types/database.ts` regenerated
- [ ] **MED-02**: Integrations registry entry (Server URL, Publishable Key, Connection Token) storing per contract §2 (`location_id` = base URL, `encrypted_api_key` = connection token, `config.publishable_key`)
- [ ] **MED-03**: `medusa_search_products` / `medusa_get_product` / `medusa_get_cart` executors via `execute-action.ts` → store API, 8s timeout, R11 120/min/org; cart id ONLY from pinned context; no id params in tool schemas
- [ ] **MED-04**: `conversationId` passed into `executeAction` at both run-agent call sites; ACTION_DESCRIPTIONS + spec.ts NODES registered

### Context & Pinning (CTX)

- [ ] **CTX-01**: `verifyCommerceContext` — HMAC timing-safe + exp + org check per contract §3, fail-soft on invalid
- [ ] **CTX-02**: Chat route accepts `commerce_context` (≤2048), merges verified claims into `conversations.memory.commerce`; re-pin only from newly verified token
- [ ] **CTX-03**: Widget fetches token from `data-context-endpoint` (cache until exp), sends on every POST, exposes `Opps.setContext`; widget rebuilt

### Cart Writes (CRT)

- [ ] **CRT-01**: `medusa_add_to_cart` / `medusa_update_cart_item` on pinned cart only; no-cart → create + `metadata.xphere_sig` + pin + SSE `cart_created` with sig
- [ ] **CRT-02**: Clamps: qty 1–10/op, ≤50 line items; R7 10 writes/min/session (closed), R8 60/day/conversation (closed); 3 writes/turn + 25/conversation in guardrails
- [ ] **CRT-03**: `emitStructured` on ActionContext (streaming passes emitter); writes emit `commerce` SSE events per contract §6
- [ ] **CRT-04**: Widget re-dispatches `commerce` SSE as `CustomEvent('xphere:commerce')`; both write tools in `SIDE_EFFECTING_ACTIONS`

### Wishlist Tools (WSL)

- [ ] **WSL-01**: `medusa_wishlist_add/remove/list` via signed `/agent/wishlists/*` per contract §4.2; owner from pinned context only (customer_id else wishlist_ref)
- [ ] **WSL-02**: HMAC signing helper (ts + "." + rawBody) unit-tested; add/remove side-effecting (R7/R8), list read-budgeted (R6 30/min/session)

### Events Ingestion (EVI)

- [ ] **EVI-01**: `commerce:events` scope + `POST /api/v1/commerce/events` per contract §5 (64KB, Bearer, Idempotency-Key === event_id, zod; 201/200/401/403/422)
- [ ] **EVI-02**: `commerce_event_receipts` migration (UNIQUE(org_id, event_id), RLS); duplicates → 200 no re-dispatch
- [ ] **EVI-03**: `emitCommerceEvent` — contact find-or-create by email, conversation annotation via cart_id match, workflow dispatch `commerce.order.placed`/`commerce.customer.created` + `event_dispatches` audit + spec.ts TRIGGERS

### Cards & Orders (UIX)

- [ ] **UIX-01**: Product tools emit `ui`/`product_cards` SSE (≤5 items per contract §6); widget renders cards safely (createElement/textContent), "Add to cart" routes via `Opps.sendMessage`
- [ ] **UIX-02**: `medusa_get_order_status` → Stuscle `/agent/orders/status` with pinned customer_id only; guests told to log in; R9 5/day/session closed
- [ ] **UIX-03**: Verified context with email → contact find-or-create + `conversations.contact_id` + `visitor_email`

## v2 Requirements

- **UIX-04**: Guest order lookup via email OTP
- **CRT-05**: Org-configurable guardrail knobs (max cart value, daily write cap) + settings UI
- **EVI-04**: HMAC/replay upgrade on the events endpoint; more event types (cart.updated, fulfillment)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Checkout/payments via chat | Stays in the storefront's audited flow |
| Medusa admin API usage | Over-privileged; store API + 4 HMAC routes is least-privilege |
| Stuscle-side code | Built in the stuscle repo's own GSD project |

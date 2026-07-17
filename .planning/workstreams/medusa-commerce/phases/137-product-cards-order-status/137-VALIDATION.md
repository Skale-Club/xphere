---
phase: 137
slug: product-cards-order-status
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 137 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (mock fetch/supabase, Docker-free) + jsdom widget test |
| **Quick run command** | `CI=true npx vitest run tests/medusa-order-status.test.ts tests/medusa-product-cards.test.ts tests/chat-api.test.ts tests/widget.test.ts --reporter=dot` |
| **Full suite** | `npm test` (~58 pre-existing unrelated failures — do NOT gate on it) |
| **Type/widget gate** | `npm run build` + `npm run build:widget` |
| **Estimated runtime** | quick < 15s |

---

## CRITICAL facts (from research)

1. **Product cards need NO run-agent change** — `emitStructured` already reaches the read tools on the streaming path (run-agent.ts:1299). Add `ctx.emitStructured?.({event:'ui', component:'product_cards', items})` INSIDE search-products.ts / get-product.ts. items ≤5; price already `formatMoney` (major units); variantId from `*variants`; url = `${storefront_url}/${country_code}/products/${handle}`.
2. **country_code fallback** (open Q2 — planner decides): pinned country_code, else resolved-region country, else emit the card WITHOUT a url (never emit a broken `//products/...` link).
3. **Widget renderer**: buffer `ui` events, render `.opps-cards` after `done` with createElement/textContent + img.src/anchor ONLY (no innerHTML — XSS on host stores); "Add to cart" → `submitMessage('Add "<title>" to my cart')` (never a direct API call). Old bundles ignore unknown events → graceful degrade. `npm run build:widget` + commit public/widget.js; keep jsdom tests/widget.test.ts green.
4. **Order status** = near-clone of wishlist-list.ts via `medusaAgentFetch` (Phase 135, HMAC vector-proven) to stuscle `POST /agent/orders/status` (§4.2 shape, already built in stuscle Phase 5). params {display_id?} — NO customer_id/email in schema. Owner-guard FIRST: pinned `cus` required, else friendly "log in on the store" (NO email lookup, NO guest path). display_id > memory.commerce.last_order_display_id > omit. R9 `ord:read:{sessionKey}` 5/86400 failMode 'closed'. execute-action get_order_status stub → real (the LAST stub; switch stays exhaustive). ACTION_DESCRIPTIONS + spec NODE (params {display_id?}).
5. **CRM linking (UIX-03)**: after writeCommerceContext in the chat route, when claims.email present → find-or-create contact by email (REUSE Phase 136's contact upsert / ingest.ts `email_normalized` pattern — do NOT fork a second helper) → set conversations.contact_id (ONLY if null) + visitor_email; throttled + fail-soft.
6. **Sequencing (open Q1)**: Phase 136 must be MERGED before 137 plans/executes (137 reuses 136's contact-upsert helper + last_order_display_id).

---

## Sampling Rate

- **After every task commit:** the touched test file(s)
- **After every wave:** quick run + `npm run build` (+ build:widget for the widget task)
- **Before verify-work:** scoped tests + build + build:widget green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task | Requirement | Type | Automated Command | Status |
|------|-------------|------|-------------------|--------|
| product tools emit ui/product_cards (≤5, url shape, country fallback) | UIX-01 | unit | `vitest run tests/medusa-product-cards.test.ts` (emitStructured spy) | ⬜ |
| widget renderer (buffer ui, createElement/textContent, Add→sendMessage) + build:widget | UIX-01 | jsdom+build | `vitest run tests/widget.test.ts` + `npm run build:widget` | ⬜ |
| get-order-status executor (pinned cus only, guest→login, R9 closed, display_id>last_order) + dispatch/NODE | UIX-02 | unit | `vitest run tests/medusa-order-status.test.ts` + `npm run build` | ⬜ |
| chat-route contact linking (email→contact, contact_id if null, throttled, fail-soft) | UIX-03 | unit | `vitest run tests/chat-api.test.ts` | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] `tests/medusa-order-status.test.ts`, `tests/medusa-product-cards.test.ts` (new); extend `tests/chat-api.test.ts`, `tests/widget.test.ts`

---

## Manual-Only / E2E-Deferred

| Behavior | Requirement | Why deferred | Instructions |
|----------|-------------|--------------|--------------|
| Live product cards render + order status round trip | UIX-01, UIX-02 | Needs both stacks up (widget on stuscle storefront + stuscle order route) | E2E pass: search → cards render with images/prices/Add button; "my order status" logged-in → §4.2 answer; guest → login prompt |

---

## Validation Sign-Off

- [ ] product emit + order-status + chat linking fully unit-tested; widget renderer jsdom-green + build:widget committed
- [ ] order status logged-in ONLY (pinned cus); no guest/email path; R9 closed
- [ ] widget uses createElement/textContent only (no innerHTML); Add→sendMessage
- [ ] No <automated> requires a live stack
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

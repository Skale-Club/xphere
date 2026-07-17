# Phase 137: Product Cards & Order Status - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Mode:** Derived from user-approved integration plan (plan-mode session 2026-07-17); discuss not needed

<domain>
## Phase Boundary

Rich product cards in the widget, the logged-in-only order-status tool, and CRM contact linking for identified visitors. Contract: §4.2 (orders/status), §6 (`ui` SSE event). Closes the milestone.

</domain>

<decisions>
## Implementation Decisions

### Product cards
- `search-products.ts` / `get-product.ts` (Phase 132 files): when `ctx.emitStructured` present, ALSO emit `{event:'ui', component:'product_cards', items:[{id, variantId, title, thumbnail, price, handle, url}]}` — ≤5 items; `url` = `${config.storefront_url ?? ''}/${country_code}/products/${handle}` (relative when storefront_url absent). Text return stays (the model narrates; cards enrich).
- Widget renderer (`src/widget/index.ts` + rebuild): buffer `ui` events during the turn; on `done`, append a `.opps-cards` container after the assistant bubble. Cards built ONLY with `createElement` + `textContent` (title, price) + `img.src` (thumbnail) + an anchor (View → url) + an "Add to cart" button whose click calls the existing `sendMessage('Add "<title>" to my cart')` path — never a direct API call. Add card CSS to the widget's style block, respecting existing theme variables.

### Order status
- `get-order-status.ts` — params `{ }` or `{ display_id?: number }` (display_id is weak-secret-ish but useless without the pinned customer — allowed). Flow: pinned `customer_id` required — absent → friendly "log in on the store so I can check your orders" string (NO email-based lookup, NO exceptions). R9 `ord:read:{sessionId}` 5/24h failMode 'closed'. Calls Stuscle `POST /agent/orders/status {customer_id, display_id?}` via `medusaAgentFetch` (Phase 135). Prefer `memory.commerce.last_order_display_id` (Phase 136) when the user says "my order" without a number. Render status/fulfillment/payment/total/items concisely.
- Wiring: execute-action case, ACTION_DESCRIPTIONS, spec.ts NODE.

### CRM linking (chat route)
- When a verified context carries `email` (Phase 133 already pinned it): find-or-create contact by email (org-scoped) → set `conversations.contact_id` (only if currently null) + `visitor_email`. Do this at pin time in the chat route (after `writeCommerceContext`), throttled: skip if the conversation already has that contact linked. Reuse the same contact-upsert helper as Phase 136.

### Claude's Discretion
- Card CSS details (match widget theme); buffering data structure; how "View" anchors open (target=_top given script runs in host page — no iframe).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 134's `emitStructured` + widget SSE handling; Phase 135's `medusaAgentFetch`; Phase 136's contact upsert + `last_order_display_id`.
- Widget bubble rendering `appendMessage` (~line 748) and `WIDGET_CSS` block.

### Established Patterns
- Widget: no innerHTML anywhere — keep it that way (XSS surface on host stores).

### Integration Points
- `src/widget/index.ts` (rebuild + commit `public/widget.js`), chat route (linking), executors from earlier phases.

</code_context>

<specifics>
## Specific Ideas

- Cards must degrade gracefully: if the widget version on a host page is old (no `ui` handler), unknown events are already ignored — confirm and keep that invariant.
- Order responses NEVER include addresses or payment instruments (contract shape is status/total/items only) — assert in test.

</specifics>

<deferred>
## Deferred Ideas

- Guest OTP order lookup (v2 UIX-04); carousel/quick-reply widgets beyond product cards.

</deferred>

# Phase 137: Product Cards & Order Status - Research

**Researched:** 2026-07-17
**Domain:** SSE `ui` events + safe DOM widget rendering + a signed logged-in-only order-status tool + CRM contact linking (final xphere phase of the medusa-commerce milestone)
**Confidence:** HIGH — every finding is a direct read of shipped in-repo code or the FROZEN contract; no external/library research was needed (this phase is pure wiring of verified Phase 132–136 patterns).

<user_constraints>
## User Constraints (from 137-CONTEXT.md)

### Locked Decisions

**Product cards**
- `search-products.ts` / `get-product.ts` (Phase 132 files): when `ctx.emitStructured` present, ALSO emit `{event:'ui', component:'product_cards', items:[{id, variantId, title, thumbnail, price, handle, url}]}` — ≤5 items; `url` = `${config.storefront_url ?? ''}/${country_code}/products/${handle}` (relative when storefront_url absent). Text return stays (the model narrates; cards enrich).
- Widget renderer (`src/widget/index.ts` + rebuild): buffer `ui` events during the turn; on `done`, append a `.opps-cards` container after the assistant bubble. Cards built ONLY with `createElement` + `textContent` (title, price) + `img.src` (thumbnail) + an anchor (View → url) + an "Add to cart" button whose click calls the existing `sendMessage('Add "<title>" to my cart')` path — never a direct API call. Add card CSS to the widget's style block, respecting existing theme variables.

**Order status**
- `get-order-status.ts` — params `{ }` or `{ display_id?: number }` (display_id is weak-secret-ish but useless without the pinned customer — allowed). Flow: pinned `customer_id` required — absent → friendly "log in on the store so I can check your orders" string (NO email-based lookup, NO exceptions). R9 `ord:read:{sessionId}` 5/24h failMode 'closed'. Calls Stuscle `POST /agent/orders/status {customer_id, display_id?}` via `medusaAgentFetch` (Phase 135). Prefer `memory.commerce.last_order_display_id` (Phase 136) when the user says "my order" without a number. Render status/fulfillment/payment/total/items concisely.
- Wiring: execute-action case, ACTION_DESCRIPTIONS, spec.ts NODE.

**CRM linking (chat route)**
- When a verified context carries `email` (Phase 133 already pinned it): find-or-create contact by email (org-scoped) → set `conversations.contact_id` (only if currently null) + `visitor_email`. Do this at pin time in the chat route (after `writeCommerceContext`), throttled: skip if the conversation already has that contact linked. Reuse the same contact-upsert helper as Phase 136.

### Claude's Discretion
- Card CSS details (match widget theme); buffering data structure; how "View" anchors open (`target=_top` given script runs in host page — no iframe).

### Deferred Ideas (OUT OF SCOPE)
- Guest OTP order lookup (v2 UIX-04); carousel/quick-reply widgets beyond product cards.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **UIX-01** | Product tools emit `ui`/`product_cards` SSE (≤5 items per contract §6); widget renders cards safely (createElement/textContent), "Add to cart" routes via `Opps.sendMessage` | Pattern 1 (emit inside the existing product executors — `ctx.emitStructured` already flows to read tools on the streaming path, run-agent.ts:1299, no plumbing change) + Pattern 2 (widget SSE buffer/render, createElement-only) |
| **UIX-02** | `medusa_get_order_status` → Stuscle `/agent/orders/status` with pinned customer_id only; guests told to log in; R9 5/day/session closed | Pattern 3 (new `get-order-status.ts` executor modeled on `wishlist-list.ts` — the shipped `medusaAgentFetch` analog; stub → real in execute-action.ts:518) |
| **UIX-03** | Verified context with email → contact find-or-create + `conversations.contact_id` + `visitor_email` | Pattern 4 (chat-route linking after `writeCommerceContext`, reusing the `ingest.ts` find-by-email + insert pattern; conversations columns confirmed present) |
</phase_requirements>

## Summary

Phase 137 closes the milestone with three wiring tasks over infrastructure that already exists and is byte-verified against the stuscle side. **None of it introduces new dependencies or new HTTP plumbing.** (1) The two shipped product executors gain a single `ctx.emitStructured?.({event:'ui', component:'product_cards', items})` call built from data they already fetch; the streaming path already passes `emitStructured` to read tools (run-agent.ts:1299), so no run-agent change is needed. (2) The widget's SSE consumer (`submitMessage`'s `onEvent`) gains a buffered `ui` branch that renders a `.opps-cards` block after the `done` event using `createElement`/`textContent` only (the codebase's no-innerHTML invariant), with the "Add to cart" button routing through the existing `submitMessage()` path; then `public/widget.js` is rebuilt and committed. (3) A new `get-order-status.ts` executor is a near-clone of the shipped `wishlist-list.ts` — same `medusaAgentFetch` signed transport (HMAC vector already cross-repo-proven), same never-throw friendly-string discipline, plus a pinned-`cus`-required guard, R9 fail-closed, and `last_order_display_id` preference. The stuscle `POST /agent/orders/status` endpoint already exists and returns the exact §4.2 shape. (4) The chat route gains a small find-or-create-contact-by-email step after `writeCommerceContext`.

**Primary recommendation:** Treat this as four small, independently-testable wiring changes (product-emit, widget-render, order-status executor + dispatch, chat-route linking). Reuse the exact patterns from `wishlist-list.ts`, `add-to-cart.ts` (emit), `ingest.ts` (contact upsert), and the existing widget event handler. Do NOT invent new transport, new HMAC, or new innerHTML. The one real cross-phase risk is the **Phase 136 dependency** (see Open Questions): 136 is *planned but not yet built*, and it owns both the `last_order_display_id` writer and the canonical contact-upsert helper 137 is told to reuse.

## Project Constraints (from CLAUDE.md)

| Directive | Impact on this phase |
|-----------|----------------------|
| `npm run build` after changes (catches TS strict errors) | Phase gate must include `npm run build` (also rebuilds the widget via the `build:widget` prefix in the `build` script) |
| Node.js runtime for route handlers | Chat route is already `runtime = 'nodejs'`; the linking step stays in that handler |
| Multi-tenancy: never manually filter `org_id` on the authenticated client; but service-role client requires explicit `org_id` scoping | The chat route uses `createServiceRoleClient()` — every contacts/conversations read+write MUST be `.eq('org_id', orgId)` scoped (matches `ingest.ts` and `context.ts`) |
| Migrations: never edit old ones; `npx supabase db push` then update `database.ts` | No new migration expected in 137 (contacts/conversations columns already exist; `commerce_event_receipts` already migrated). Do NOT add one unless a new column is truly required (it isn't). |
| Public REST API pattern (Bearer, proper status codes) | Not touched here — 137 adds no new `/api/v1/*` route |
| `src/lib/crypto.ts` encryption format frozen | Untouched — order-status reuses `agent-sig.ts` (already frozen + vector-tested) |
| Tests: Vitest under `tests/` | All new tests go in `tests/` as `*.test.ts` |

## Standard Stack (reusable in-repo building blocks — no new deps)

### Core (must reuse, do not reimplement)
| Module | Path | Purpose | Why standard |
|--------|------|---------|--------------|
| `medusaAgentFetch` | `src/lib/medusa/client.ts:79` | Signed POST to `/agent/*` (HMAC ts.rawBody) | The ONLY sanctioned transport to the privileged surface; byte-agreement invariant + R11 + 8s timeout baked in |
| `signAgentBody` | `src/lib/medusa/agent-sig.ts` | HMAC used by `medusaAgentFetch` | Cross-repo vector proven (`tests/medusa-agent-fetch.test.ts`) — stuscle's `/agent/*` middleware recomputes it |
| `loadPinnedContext` | `src/lib/medusa/pinned-context.ts` | Single `conversations` read → `{sessionKey, commerce}` | Anti-IDOR core: owner id comes ONLY from `memory.commerce`, never params |
| `rateLimit` | `src/lib/rate-limit.ts` | `failMode: 'open'|'memory'|'closed'` | R9 uses `'closed'`; R6 uses `'memory'` |
| `formatMoney` | `src/lib/medusa/format.ts` | `Intl.NumberFormat` currency, MAJOR units (no /100) | Order total + card price formatting; Medusa v2 returns major units |
| `resolveRegionId` | `src/lib/medusa/regions.ts` | country_code → region id (falls back to `regions[0]`) | Already called by the product executors; can seed a country fallback |
| `getMedusaCredentialsForOrg` | `src/lib/medusa/credentials.ts` | Loads `{baseUrl, connectionToken, publishableKey, storefrontUrl}` | `storefrontUrl` (config.storefront_url) is ALREADY loaded — used for the card `url` |
| `ingestLead` / `findContact` | `src/lib/leads/ingest.ts` | find-by-email + insert contact | The canonical contact upsert-by-email pattern to reuse for UIX-03 |
| `normaliseEmail` | `src/lib/contacts/zod-schemas.ts` | Email normalization for `email_normalized` lookup | Lookup key is `contacts.email_normalized`, not `email` |
| `submitMessage` (widget closure) | `src/widget/index.ts:829` | Core widget send path | "Add to cart" button calls this; also `window.Opps.sendMessage` (index.ts:1142) |

### Supporting (touch points, no new install)
| Module | Path | Change |
|--------|------|--------|
| `execute-action.ts` | `src/lib/action-engine/execute-action.ts:518` | Replace the `medusa_get_order_status` stub with a real dispatch (needs org+supabase+creds, then `getOrderStatus(params, creds, ctx)`) |
| `ACTION_DESCRIPTIONS` | `src/lib/agent-runtime/run-agent.ts:210` | Add a `medusa_get_order_status` entry |
| `NODES` (spec) | `src/lib/workflows/spec.ts:361` (commerce block) | Add a `medusa_get_order_status` node, `integration_required:['medusa']`, params `{display_id?}` |
| `SSEEvent` (widget) | `src/widget/index.ts:572` | Extend with `component?: string; items?: unknown[]` |
| Chat route | `src/app/api/chat/[token]/route.ts:204` | Add email→contact linking after `writeCommerceContext` |

**Installation:** none. `npm view` version checks N/A — no package changes. The build tool is the existing `esbuild` `build:widget` script (package.json).

### Alternatives Considered
| Instead of | Could Use | Why NOT |
|------------|-----------|---------|
| `medusaAgentFetch` (signed) for order status | `medusaStoreFetch` (publishable key) | The store API has no privileged order-by-customer surface; `/agent/orders/status` is HMAC-guarded and returns the aggregated fulfillment/payment status. Signed is the only correct path. |
| createElement/textContent card DOM | `innerHTML` templating | Hard project invariant (`137-CONTEXT` + widget never uses innerHTML) — XSS on host stores. `img.src`/anchor `href` are attributes, not markup. |
| New `/api/v1/*` route for order status | reuse existing executor dispatch | Order status is a chat *tool*, not an inbound webhook — it belongs in `execute-action.ts`, keyed by the pinned conversation. |

## Architecture Patterns

### Recommended file layout for this phase
```
src/lib/medusa/actions/get-order-status.ts   # NEW — clone of wishlist-list.ts shape
src/lib/medusa/actions/search-products.ts    # EDIT — add emit
src/lib/medusa/actions/get-product.ts        # EDIT — add emit
src/lib/action-engine/execute-action.ts      # EDIT — stub → real dispatch (line 518)
src/lib/agent-runtime/run-agent.ts           # EDIT — ACTION_DESCRIPTIONS entry
src/lib/workflows/spec.ts                     # EDIT — NODES entry
src/lib/contacts/link-verified-contact.ts    # NEW (recommended) — extract find-or-create + link
src/app/api/chat/[token]/route.ts             # EDIT — call the linking helper
src/widget/index.ts                           # EDIT — SSEEvent + ui buffer/render + CSS
public/widget.js                              # REBUILT + COMMITTED (npm run build:widget)
tests/medusa-order-status.test.ts             # NEW
tests/medusa-product-cards-emit.test.ts       # NEW
tests/chat-route-contact-linking.test.ts      # NEW (unit-test the extracted helper)
tests/widget.test.ts                          # EXTEND (jsdom render + bundle assertion)
```

### Pattern 1 — Product cards emit (UIX-01, source half)
**What:** After the existing `products`/`product` fetch, build a `≤5`-item array and emit it. The text return is unchanged (the LLM still narrates from the string).
**When:** Inside the `try`, after the products are fetched, before the `return`. Guarded by `ctx.emitStructured?.(...)` (present only on the streaming path — run-agent.ts:1299 — a no-op in the blocking path).
**Key details verified in source:**
- `emitStructured` already reaches read tools: `execute-action.ts:480` passes `ctx` straight to `searchMedusaProducts`; the streaming `executeAction` call sets `emitStructured: emit`. **No run-agent change is required for cards.**
- `price` is already the `formatMoney(...)` string (major units).
- `variantId` = first variant's `id`. `*variants.calculated_price` in `PRODUCT_FIELDS` already expands the variant scalar `id` (proven by `add-to-cart.ts:78` using `*variants` to read `variants[0].id`). Add `id` to the local `StoreProductVariant` interface to read it; optionally add `variants.id` to `PRODUCT_FIELDS` to be explicit.
- `url` = `${creds.storefrontUrl ?? ''}/${countryCode}/products/${handle}` — `creds.storefrontUrl` is already loaded (credentials.ts:37).

```typescript
// search-products.ts — inside try, after `products` is fetched:
if (ctx.emitStructured) {
  const countryCode =
    typeof commerce.country_code === 'string' ? commerce.country_code : /* fallback — see Open Q2 */ undefined
  const items = products.slice(0, 5).map((p) => {
    const variant = p.variants?.[0]
    const price = variant?.calculated_price
    return {
      id: p.id,
      variantId: variant?.id,
      title: p.title,
      thumbnail: p.thumbnail,
      price:
        price?.calculated_amount != null && price.currency_code
          ? formatMoney(price.calculated_amount, price.currency_code)
          : undefined,
      handle: p.handle,
      url: `${creds.storefrontUrl ?? ''}/${countryCode ?? ''}/products/${p.handle ?? ''}`,
    }
  })
  ctx.emitStructured({ event: 'ui', component: 'product_cards', items })
}
```
(`get-product.ts` emits a single-item array via the same shape.)

### Pattern 2 — Widget renderer (UIX-01, client half)
**What:** Buffer `ui` events during the turn; render after `done`.
**Where:** `submitMessage`'s `onEvent` (index.ts:847). Add `let pendingCards: unknown[] = []` alongside `tokenBuffer`. New branch `else if (evt.event === 'ui' && evt.component === 'product_cards' && Array.isArray(evt.items)) { pendingCards = evt.items.slice(0, 5) }`. In the `done` branch, after `appendMessage(tokenBuffer, 'assistant')`, call `renderCards(pendingCards)` then reset `pendingCards = []`. Also flush in the "stream ended without done" safety fallback (index.ts:889).
**Card DOM (createElement/textContent ONLY):**
```typescript
function renderCards(items: Array<Record<string, unknown>>): void {
  if (!items.length) return
  const container = document.createElement('div')
  container.className = 'opps-cards'
  for (const it of items) {
    const card = document.createElement('div'); card.className = 'opps-card'
    if (typeof it.thumbnail === 'string') {
      const img = document.createElement('img')
      img.className = 'opps-card-img'; img.src = it.thumbnail; img.alt = ''       // src = attribute, safe
      card.appendChild(img)
    }
    const title = document.createElement('div'); title.className = 'opps-card-title'
    title.textContent = String(it.title ?? '')                                    // textContent, never innerHTML
    card.appendChild(title)
    if (typeof it.price === 'string') {
      const price = document.createElement('div'); price.className = 'opps-card-price'
      price.textContent = it.price; card.appendChild(price)
    }
    const actions = document.createElement('div'); actions.className = 'opps-card-actions'
    if (typeof it.url === 'string' && it.url) {
      const view = document.createElement('a')
      view.className = 'opps-card-view'; view.href = it.url; view.target = '_top'   // host page, not iframe
      view.rel = 'noopener'; view.textContent = 'View'; actions.appendChild(view)
    }
    const add = document.createElement('button')
    add.className = 'opps-card-add'; add.type = 'button'; add.textContent = 'Add to cart'
    const t = String(it.title ?? '')
    add.addEventListener('click', () => { void submitMessage(`Add "${t}" to my cart`) }) // existing agent path
    actions.appendChild(add); card.appendChild(actions)
    container.appendChild(card)
  }
  msgList.appendChild(container)
  msgList.scrollTop = msgList.scrollHeight
}
```
**Graceful degradation (confirmed):** `onEvent`'s if/else-if chain has NO terminal `else` that errors — an unknown event type is silently ignored. An old cached `widget.js` (no `ui` branch) therefore drops `ui` events harmlessly. Keep this invariant.
**CSS:** add `.opps-cards`/`.opps-card`/`.opps-card-img`/`-title`/`-price`/`-actions`/`-view`/`-add` to `WIDGET_CSS` (index.ts:24), using the existing theme vars (`var(--opps-primary-color)`, `${T.borderColor}`, `${T.panelBg}`, `${T.textPrimary}`).
**Build:** `npm run build:widget` regenerates `public/widget.js`; COMMIT it. `tests/widget.test.ts` and `tests/widget-asset.test.ts` load the *built* bundle from `public/widget.js` — an unbuilt/uncommitted change is invisible to and will fail tests.

### Pattern 3 — Order-status executor (UIX-02)
**What:** New `get-order-status.ts`, signature `(params, creds, ctx)` — a near-clone of `wishlist-list.ts` (the shipped `medusaAgentFetch` read analog). Never throws; every expected failure → friendly string.
**Order of operations (verified against wishlist-list.ts + contract §4.2/§7):**
1. `const { sessionKey, commerce } = await loadPinnedContext(ctx)`.
2. **Owner guard FIRST (before R9):** `const cus = typeof commerce.cus === 'string' ? commerce.cus : undefined`. If `!cus` → return `"Log in on the store and I'll be able to check your orders — I can't look those up for guests yet."` (NO email lookup, NO throw, does not consume R9).
3. **R9:** `rateLimit('ord:read:' + sessionKey, 5, 86400, { failMode: 'closed' })`. If `!allowed` → `"You've checked orders a few times today — try again tomorrow."`
4. **display_id preference:** `params.display_id` (number) wins → else `commerce.last_order_display_id` (number, Phase 136) → else omit (server returns most recent).
5. `const body = { customer_id: cus, ...(displayId !== undefined ? { display_id: displayId } : {}) }`.
6. `await medusaAgentFetch<OrderStatusResponse>(creds, '/agent/orders/status', ctx.organizationId, body)`.
7. On success render concisely: display_id, status, fulfillment_status, payment_status, `formatMoney(total, currency_code)`, items (`title xquantity`). **Response contains no addresses/payment instruments — contract §4.2 shape is status/total/items only** (assert in test).
8. Catch: `MedusaApiError` with `.status === 404` → `"I couldn't find that order."` (import `MedusaApiError` from `../client`); `MedusaRateLimitError` (R11) / `TimeoutError` / generic → the same friendly strings as `wishlist-list.ts`.

**Response type (from stuscle `build-order-status.ts`, verified):**
```typescript
interface OrderStatusResponse {
  order: {
    display_id: number; status: string; fulfillment_status: string; payment_status: string
    total: number; currency_code: string; created_at: string
    items: { title: string; quantity: number }[]
  }
}
```
**Dispatch wiring (execute-action.ts:518):** replace the stub with a real branch. Order status is a READ over the signed surface — it does NOT go in `SIDE_EFFECTING_ACTIONS` or `COMMERCE_WRITE_ACTIONS` (R9 is its only budget). Simplest: give it its own case mirroring the read-tools case (org+supabase check → `getMedusaCredentialsForOrg` → `getOrderStatus(params, creds, ctx)`), preserving the friendly-string-on-missing-config contract. The exhaustive `switch` already has the `case`; only its body changes.
**Registration:** ACTION_DESCRIPTIONS entry (params are `{display_id?}` — explicitly NO customer/email) + spec.ts NODE `{ type:'medusa_get_order_status', kind:'action', integration_required:['medusa'], params_schema:{ type:'object', properties:{ display_id:{ type:'number', description:'Optional order number' } } }, examples:[{}] }`.

### Pattern 4 — CRM contact linking (UIX-03)
**What:** After `writeCommerceContext` in the chat route, when `claims.email` is present, find-or-create the contact and link the conversation.
**Where:** `route.ts:210`, inside the existing `if (claims) { ... }` block, still inside the fail-soft `try/catch` (must never throw the chat).
**Recommended shape — extract a helper** `linkVerifiedContact(supabase, orgId, conversationId, email)` in `src/lib/contacts/` so it is unit-testable without exercising the whole route:
1. `SELECT contact_id FROM conversations WHERE id = conversationId AND org_id = orgId` → **throttle:** if `contact_id` already non-null, return (skip — already linked).
2. Find-or-create by email using the `ingest.ts` pattern: `const norm = normaliseEmail(email)`; lookup `contacts` by `email_normalized = norm`, `org_id`, `identity_status != 'archived_duplicate'`; if none, insert `{ org_id, email: norm, source:'api'|closest, lifecycle_stage:'lead' }` (the DB derives `email_normalized`). Handle the insert race by re-selecting (same as `ingest.ts:105`).
3. `UPDATE conversations SET contact_id = <id>, visitor_email = norm WHERE id = conversationId AND org_id = orgId AND contact_id IS NULL` — the `contact_id IS NULL` guard enforces "only if currently null" atomically; `visitor_email` may be set regardless.
**Reuse note:** `137-CONTEXT` says "reuse the same contact-upsert helper as Phase 136." Phase 136's `emitCommerceEvent` does the identical find-or-create-by-email + conversation link. **See Open Question 1** — extract ONE shared helper both consume; do not fork two email-upsert code paths.
**Confirmed schema:** `conversations` has `contact_id: string | null` and `visitor_email: string | null` (database.ts:2560/2551); `contacts` lookup key is `email_normalized` (ingest.ts:41).

### Anti-Patterns to Avoid
- **innerHTML for cards** — banned; use createElement + textContent + attribute assignment.
- **Putting an id in a tool schema** — `medusa_get_order_status` params are `{display_id?}` ONLY; `customer_id`/`email` come from the pin. (`display_id` is allowed: it's useless without the pinned `customer_id`, which the stuscle query filters in the same WHERE — no existence leak, per the route comment.)
- **Guest email fallback / OTP** — explicitly out of scope (UIX-04, v2). Guests get the login string, full stop.
- **Emitting cards on the blocking path** — `ctx.emitStructured` is intentionally absent there; the `?.` guard makes it a no-op. Don't force it.
- **Overwriting an existing `conversations.contact_id`** — only set when null.
- **Re-stringifying the agent body** — `medusaAgentFetch` already enforces the byte-agreement invariant; pass a plain object, never a pre-stringified one.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Signing the order-status request | A fresh HMAC | `medusaAgentFetch` (`client.ts:79`) | Byte-agreement + R11 + timeout + cross-repo vector already proven |
| Reading the pinned owner | A new conversations query | `loadPinnedContext` | Single-lookup session key + commerce; anti-IDOR guarantee |
| Money formatting | `toFixed`/manual symbols | `formatMoney` | Major-units, locale-correct, already used everywhere |
| Contact find-or-create by email | A bespoke upsert | `ingest.ts` `findContact`+insert pattern (or the shared helper) | `email_normalized` lookup + archived-duplicate filter + insert-race handling are subtle |
| Store→region resolution | Hardcoding a region | `resolveRegionId` | Already handles country match + `regions[0]` fallback |
| Widget SSE parsing | A new reader | The existing `consumeStream`/`onEvent` chain | NDJSON framing + malformed-line skip already correct |
| Rebuilding the widget | Hand-editing `public/widget.js` | `npm run build:widget` | esbuild bundle; tests read the built file |

**Key insight:** This phase is 90% *composition of already-shipped, already-tested primitives*. The value is correct wiring + the two new bits (card DOM builder, order renderer), not new infrastructure.

## Common Pitfalls

### Pitfall 1 — Forgetting to rebuild + commit `public/widget.js`
**What goes wrong:** `src/widget/index.ts` edited but `public/widget.js` stale → the deployed widget and the jsdom tests (which `eval` the built file) never see the new renderer.
**Avoid:** `npm run build:widget` then `git add public/widget.js`. Add a bundle-content assertion (like the existing `expect(code).toContain('xphere:commerce')` at widget.test.ts:196) asserting the built bundle contains the card renderer (e.g. `'opps-cards'`).
**Warning sign:** widget.test.ts card assertions pass against source expectations but the built bundle lacks the string.

### Pitfall 2 — `country_code` missing on the card URL
**What goes wrong:** Cards can be emitted with no verified token pinned (a guest searching) → `commerce.country_code` is `undefined` → `url` becomes `${storefrontUrl}//products/handle` (double slash), which the storefront's `[countryCode]` router cannot resolve.
**Avoid:** Provide a deterministic fallback (see Open Q2) — derive the country from the resolved region's first country, or a config default; if none can be determined, prefer emitting a still-usable relative `/products/handle` is NOT enough (storefront requires the segment), so consider omitting cards when country is unknown rather than shipping a broken link.
**Warning sign:** a card "View" link 404s on the storefront.

### Pitfall 3 — Depending on `last_order_display_id` that Phase 136 hasn't written yet
**What goes wrong:** 137's order executor reads `commerce.last_order_display_id`, but the writer (Phase 136 `emitCommerceEvent`) is not built. Until 136 lands and an `order.placed` event fires, the key is simply absent.
**Avoid:** This is a *soft* dependency — treat absence as "no remembered order" and fall back to most-recent (omit `display_id`). Never assume the key exists. (It is not a build blocker.)
**Warning sign:** "my order" resolves to the wrong/most-recent order in a session where 136 hasn't annotated one — expected pre-136.

### Pitfall 4 — R9 consumed by guests, or checked before the owner guard
**What goes wrong:** Running R9 before the `cus` check burns the 5/day budget for visitors who can't look up orders anyway; or worse, letting a guest reach `medusaAgentFetch` with a null `customer_id`.
**Avoid:** Owner guard first (return login string), THEN R9, THEN fetch — exactly the `wishlist-list.ts` order (owner → limit → fetch).

### Pitfall 5 — Linking overwriting an existing contact, or throwing the chat
**What goes wrong:** Re-linking every turn, or setting `contact_id` when one already exists, or letting a DB error bubble out of the chat route.
**Avoid:** Throttle on `contact_id IS NULL` (both the early skip and the UPDATE guard); keep the whole step inside the route's fail-soft `try/catch`; scope every query by `org_id`.

### Pitfall 6 — Reading `variantId` from a field that isn't selected
**What goes wrong:** The local `StoreProductVariant` interface omits `id`, so `variant.id` is `undefined` on the card even though the API returned it.
**Avoid:** Add `id: string` to the `StoreProductVariant` interface in both product executors; optionally add `variants.id` to `PRODUCT_FIELDS` to be explicit (`*variants` already expands it — proven by add-to-cart.ts:78).

## Code Examples

### Signed read over `/agent/*` (the order-status template) — from `wishlist-list.ts`
```typescript
// Source: src/lib/medusa/actions/wishlist-list.ts (shipped, tested)
const { sessionKey, commerce } = await loadPinnedContext(ctx)
const owner = resolveWishlistOwner(commerce)          // → for orders: `commerce.cus` only
if (!owner) return "…friendly guest message…"
const r6 = await rateLimit('com:read:' + sessionKey, 30, 60, { failMode: 'memory' }) // orders: R9 5/86400 'closed'
const { wishlist } = await medusaAgentFetch<WishlistListResponse>(
  creds, '/agent/wishlists/list', ctx.organizationId, owner,               // orders: '/agent/orders/status', { customer_id, display_id? }
)
```

### Emit ordering discipline — from `add-to-cart.ts`
```typescript
// Source: src/lib/medusa/actions/add-to-cart.ts:189 (shipped)
ctx.emitStructured?.({ event: 'commerce', action: 'cart_updated', cartId, itemCount: cart.items?.length ?? 0 })
// product cards follow the same null-guarded emit, with { event:'ui', component:'product_cards', items }
```

### stuscle response shape (what to render) — verified
```typescript
// Source: C:\Users\Vanildo\Dev\stuscle\apps\backend\src\api\agent\orders\status\build-order-status.ts
{ order: { display_id, status, fulfillment_status, payment_status, total /* MAJOR units */,
           currency_code, created_at, items: [{ title, quantity }] } }   // or 404 { error:'not_found' }
```

## State of the Art

Not applicable — no external libraries or moving ecosystem versions are involved. The only "current vs old" concern is internal contract versioning:

| Old assumption | Current (FROZEN v1.1) | Impact |
|----------------|-----------------------|--------|
| Medusa money in cents | MAJOR units (decimal) — no `/100` | Card `price` and order `total` pass amounts straight to `formatMoney` |
| `ui` events might break old widgets | Unknown SSE events are silently ignored by the widget | Cards degrade gracefully on stale bundles — keep the no-terminal-else invariant |

## Environment Availability

| Dependency | Required by | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| stuscle `POST /agent/orders/status` | UIX-02 | ✓ (route + schema + build-order-status exist, verified) | contract §4.2 | — |
| esbuild `build:widget` | UIX-01 widget build | ✓ (package.json script) | esbuild (pinned) | — |
| vitest | all tests | ✓ | `^4.1.2` | — |
| Redis (rate-limit backing) | R9/R6 counters | Gated/optional | — | `failMode` fallback: R9 `'closed'` (deny when Redis down — intentional), R6 `'memory'` |
| Phase 136 code (`emitCommerceEvent`, `last_order_display_id`, contact-upsert helper) | UIX-02 (soft) + UIX-03 (helper reuse) | ✗ *planned, not built* | — | Fallback: order executor treats `last_order_display_id` absence as "no remembered order"; UIX-03 uses the `ingest.ts` pattern directly if 136 hasn't landed |

**Missing dependencies with no fallback:** none — nothing blocks execution.
**Missing dependencies with fallback:** Phase 136 assets (see Open Question 1) — sequence 136 before 137, or have 137 self-contain the contact-upsert.

## Open Questions

1. **Phase 136 is planned but not yet built — who owns the shared contact-upsert helper and `last_order_display_id`?**
   - What we know: `.planning/.../136-*-PLAN.md` exist but there are NO `136-*-SUMMARY.md` files and NO `src/lib/commerce/` code; migration `1260_commerce_event_receipts.sql` + the `commerce_event_receipts` type in `database.ts` are present, but `emitCommerceEvent`, the `last_order_display_id` writer, and the contact upsert are not. 137 is the FINAL phase, so 136 should execute first.
   - What's unclear: whether 136 will extract a reusable `findOrCreateContactByEmail` helper (136-CONTEXT says "reuse the ingestLead helper if extractable, else same logic") or keep it inline in `emitCommerceEvent`.
   - Recommendation: **Plan 137 to introduce/own a shared `src/lib/contacts/` email-upsert helper** (mirroring `ingest.ts`), and have UIX-03 use it. If 136 has already landed an equivalent, reuse that instead of duplicating. Keep `last_order_display_id` strictly optional in the order executor (absence = fall back to most-recent). Flag the sequencing (136 before 137) to the orchestrator.

2. **`country_code` fallback for the card URL when no token is pinned.**
   - What we know: the contract token always carries a non-null `country_code`, but a guest can trigger `search_products` with no pinned context (`commerce` = `{}`).
   - Recommendation (Claude's discretion per CONTEXT): derive the country from the region already resolved in the executor (extend `resolveRegionId` to also return `countries[0].iso_2`, or add a sibling resolver), OR read a config default; if no country can be determined, omit cards for that turn (text still narrates) rather than emit a broken `//products/…` link.

3. **`variants.id` selection** — confirm at plan time that `*variants.calculated_price` returns the variant `id` (it does per add-to-cart.ts:78); if any doubt, add `variants.id` to `PRODUCT_FIELDS`. Low risk.

## Validation Architecture

Nyquist enabled (`config.json` `workflow.nyquist_validation: true`). Docker-free — vitest with mocked supabase / mocked `medusaAgentFetch`; live stuscle round-trips and real-browser widget behavior are E2E-deferred.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest `^4.1.2` |
| Config file | `vitest.config.ts` (node env default; `tests/**/*.test.ts`; alias `@`→`src`; `server-only` stubbed) |
| jsdom | per-file directive `// @vitest-environment jsdom` (see `tests/widget.test.ts:1`) |
| Quick run command | `CI=true npx vitest run tests/<file>.test.ts --reporter=dot` |
| Full (scoped) command | `CI=true npx vitest run tests/medusa-*.test.ts tests/widget*.test.ts tests/chat-route-contact-linking.test.ts && npm run build` |

> Do NOT gate on full `npm test` — ~58 pre-existing unrelated failures (documented in 136-VALIDATION.md and the earlier phases). Scope to touched files + `npm run build`.

### Phase Requirements → Test Map
| Req | Behavior | Test type | Automated command | File exists? |
|-----|----------|-----------|-------------------|-------------|
| UIX-01 | product tool emits `ui/product_cards` ≤5 with correct item + url shape; blocking path (no emitter) does not throw & still returns text | unit (emitStructured spy, mocked `medusaStoreFetch`) | `npx vitest run tests/medusa-product-cards-emit.test.ts -x` | ❌ Wave 0 |
| UIX-01 | widget renders `.opps-cards` after `done` via createElement/textContent; "Add to cart" calls the send path; unknown-event degradation | unit (jsdom, built bundle) | `npx vitest run tests/widget.test.ts -x` | ⚠️ extend existing |
| UIX-01 | built `public/widget.js` contains the card renderer | unit (bundle assertion) | `npx vitest run tests/widget.test.ts -x` | ⚠️ extend |
| UIX-02 | logged-in → `medusaAgentFetch('/agent/orders/status', {customer_id})`; param `display_id` wins; else `last_order_display_id`; guest → login string (no fetch); R9 closed → limit string (no fetch); 404 → not-found string; render carries no address/payment-instrument fields | unit (mock `medusaAgentFetch` + `rateLimit` + supabase stub) | `npx vitest run tests/medusa-order-status.test.ts -x` | ❌ Wave 0 |
| UIX-02 | stub → real dispatch; ACTION_DESCRIPTIONS + spec NODE registered; switch stays exhaustive | unit (dispatch + spec, mirror `tests/medusa-wiring.test.ts`/`medusa-spec.test.ts`) | `npx vitest run tests/medusa-wiring.test.ts tests/medusa-spec.test.ts -x` | ⚠️ extend existing |
| UIX-03 | email present + `contact_id` null → find/create contact + set `contact_id`+`visitor_email`; already-linked → skip; scoped by org_id; never throws | unit (extracted helper, mocked supabase) | `npx vitest run tests/chat-route-contact-linking.test.ts -x` | ❌ Wave 0 |

### Sampling rate
- **Per task commit:** the single touched test file (`--reporter=dot`).
- **Per wave merge:** `CI=true npx vitest run tests/medusa-*.test.ts tests/widget*.test.ts tests/chat-route-contact-linking.test.ts`.
- **Phase gate:** the scoped suite green + `npm run build` (rebuilds the widget, catches TS-strict) + `public/widget.js` rebuilt & committed.

### Wave 0 gaps
- [ ] `tests/medusa-order-status.test.ts` — covers UIX-02 (mock `@/lib/medusa/client` via `importOriginal` to keep `MedusaApiError`/`MedusaRateLimitError` for `instanceof`; mock `@/lib/rate-limit`; `buildSupabase` stub from `tests/medusa-cart-write.test.ts`).
- [ ] `tests/medusa-product-cards-emit.test.ts` — covers UIX-01 source half (emitStructured spy; assert ≤5, url shape, item keys; assert no-emitter path returns text without throwing).
- [ ] `tests/chat-route-contact-linking.test.ts` — covers UIX-03 (unit-test the extracted `linkVerifiedContact` helper against a chainable supabase mock).
- [ ] Extend `tests/widget.test.ts` — jsdom render of a `ui`+`done` SSE sequence → `.opps-cards` present, textContent-based, "Add to cart" wired; plus a built-bundle `toContain('opps-cards')` assertion.
- [ ] Manual: `widget-test.html` (or the existing manual harness) for real-browser card rendering + host-page `target=_top` navigation — E2E-deferred.
- [ ] E2E-deferred (Manual-Only): live stuscle `/agent/orders/status` round-trip (real HMAC verify, real fulfillment/payment aggregation, 404 on foreign display_id) and the live storefront card-link navigation. Framework install: none (vitest present).

## Sources

### Primary (HIGH confidence — direct source reads)
- `src/lib/medusa/actions/{search-products,get-product,add-to-cart,get-cart,wishlist-list}.ts` — executor patterns, emit ordering, friendly-string discipline.
- `src/lib/medusa/{client,agent-sig,credentials,regions,format,context,pinned-context}.ts` — transport, signing, creds (storefrontUrl), region/money helpers, pin read/write.
- `src/lib/action-engine/execute-action.ts:471-525` — read/write/wishlist dispatch + the `medusa_get_order_status` stub to replace.
- `src/lib/agent-runtime/run-agent.ts:210-242, 1284-1301` — ACTION_DESCRIPTIONS + `emitStructured: emit` reaching read tools on the streaming path.
- `src/lib/workflows/spec.ts:361-438` — commerce NODES block.
- `src/widget/index.ts` — SSE consumer (`consumeStream`/`onEvent`), `submitMessage`, `Opps.sendMessage`, WIDGET_CSS, theme vars.
- `src/app/api/chat/[token]/route.ts:200-219` — verify+pin block where linking attaches.
- `src/lib/leads/ingest.ts` — canonical find-by-email + insert (race-safe) upsert.
- `src/types/database.ts:2507-2592` — `commerce_event_receipts` + `conversations` (`contact_id`,`visitor_email`) columns.
- `C:\Users\Vanildo\Dev\stuscle\apps\backend\src\api\agent\orders\status\{route,schema,build-order-status}.ts` — the §4.2 endpoint + exact response shape.
- `.planning/research/INTEGRATION-CONTRACT.md` §4.2/§6/§7 (FROZEN v1.1) — order body/response, `ui` event, R9.
- `tests/{widget,widget-asset,medusa-cart-write,medusa-agent-fetch}.test.ts`, `vitest.config.ts`, `package.json` — test harness + build script.
- `.planning/.../136-{CONTEXT,03-PLAN}.md`, filesystem state — Phase 136 dependency (planned, unbuilt).

### Secondary / Tertiary
- None — no WebSearch/Context7 needed; the phase is internal wiring against verified in-repo code and a frozen contract.

## Metadata

**Confidence breakdown:**
- Standard stack / reuse targets: HIGH — every module read directly, patterns are shipped & tested.
- Architecture (4 patterns): HIGH — mirror existing executors/handlers; the stuscle endpoint and its response shape were read, not assumed.
- Pitfalls: HIGH — derived from source invariants (no-innerHTML, emit-guard, R-order, org-scoping) and the observed Phase 136 gap.
- Phase 136 coordination & country_code fallback: MEDIUM — flagged as open questions requiring a planner decision, not a factual gap.

**Research date:** 2026-07-17
**Valid until:** ~2026-08-16 for the internal patterns (stable); re-verify only if Phases 132–136 files or the FROZEN contract change.

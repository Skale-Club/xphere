# Phase 134: Cart Write Tools - Research

**Researched:** 2026-07-17
**Domain:** Medusa 2.17 store cart WRITE path + agent guardrails + HMAC adoption sig + SSE structured events + widget re-dispatch
**Confidence:** HIGH (endpoints, sig bytes, thread points verified against installed code in BOTH repos)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**emitStructured plumbing**
- `ActionContext += emitStructured?: (obj: Record<string, unknown>) => void`.
- `run-agent.ts` streaming path passes the SSE `emit` function through; blocking path omits it (executors must null-check). Events flow through the existing NDJSON encoder untouched.

**Executors (`src/lib/medusa/actions/`)**
- `add-to-cart.ts` — params `{ product_id?: string, variant_id?: string, quantity?: number }` (product/variant ids allowed; visitor-scoped ids NEVER). Flow: clamp qty to 1–10 → resolve pinned cart from `memory.commerce` → if none: `POST /store/carts {region_id}` (region from context; else resolve per Phase 132 fallback) → `POST /store/carts/:id` update `metadata.xphere_sig = hex(HMAC_SHA256(connectionToken, cart_id))` → `writeCommerceContext` pin → emit `{event:'commerce', action:'cart_created', cartId, itemCount, sig}` → then `POST /store/carts/:id/line-items {variant_id, quantity}`. If product_id given without variant_id: fetch product, use its single variant or ask the user to pick (return option list string). Check line-item count ≤50 after add (read cart) — if exceeded, remove the just-added item and return a friendly limit message.
- `update-cart-item.ts` — params `{ item_title_or_variant?: string, quantity: number }`: resolve the line item by fuzzy title/variant match within the PINNED cart only; `quantity 0` → DELETE line item; else clamp 1–10 and update. Emit `{event:'commerce', action:'cart_updated', cartId, itemCount}` on success (both tools).
- Both return natural-language summaries including the new cart total.

**Budgets & guardrails (contract §7)**
- R7 `com:write:{sessionId}` 10/60s failMode 'closed'; R8 `com:write:day:{convId}` 60/24h 'closed' — enforced at the top of both executors.
- `src/lib/agent-runtime/guardrails.ts`: commerce write caps — max 3 side-effecting commerce calls per TURN, 25 per conversation. Turn counter can live in the run-agent tool loop (in-memory per invocation); conversation counter via Redis or a memory.commerce counter — planner's choice, but breaches must return a clean tool-result string, not throw.
- `src/lib/agent-runtime/idempotency.ts`: add `medusa_add_to_cart`, `medusa_update_cart_item` to `SIDE_EFFECTING_ACTIONS`.

**Widget re-dispatch (`src/widget/index.ts` + rebuild)**
- Handle `commerce` SSE events in the stream consumer: `window.dispatchEvent(new CustomEvent('xphere:commerce', { detail: { action, cartId, itemCount, sig } }))`. Also trigger the Phase 133 context re-fetch on `cart_created`.

### Claude's Discretion
- Fuzzy line-item matching approach; cart-total formatting; where the per-turn write counter lives; test structure (vitest, mocked fetch + mocked rate-limit: clamps, no-cart create+sign+pin+emit sequence order, R7 closed behavior when Redis down, 51st line item rollback).

### Deferred Ideas (OUT OF SCOPE)
- Max-cart-value knob (org-configurable) — v2 (CRT-05).
- promotions/discount application via chat — later.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **CRT-01** | `medusa_add_to_cart` / `medusa_update_cart_item` on pinned cart only; no-cart → create + `metadata.xphere_sig` + pin + SSE `cart_created` with sig | §"Cart write endpoints" (verified paths + shapes), §"The adoption sig" (byte-verified vector), §"Re-pin after create" (merge helper), §Code Examples (executor skeleton + ordered sequence) |
| **CRT-02** | Clamps: qty 1–10/op, ≤50 line items; R7 10/min/session (closed), R8 60/day/conversation (closed); 3 writes/turn + 25/conversation in guardrails | §"Clamps & caps", §"Guardrails: where each cap lives", §"Rate-limit closed-mode" (verified failMode 'closed' semantics) |
| **CRT-03** | `emitStructured` on ActionContext (streaming passes emitter); writes emit `commerce` SSE events per contract §6 | §"emitStructured threading" (exact call sites in run-agent), §"SSE encoder" (no encoder change needed) |
| **CRT-04** | Widget re-dispatches `commerce` SSE as `CustomEvent('xphere:commerce')`; both write tools in `SIDE_EFFECTING_ACTIONS` | §"Widget re-dispatch (CRT-04)" (exact handler extension), §"Idempotency" (SIDE_EFFECTING_ACTIONS one-line change) |
</phase_requirements>

## Summary

This phase turns the two stubbed Medusa write cases (`medusa_add_to_cart`, `medusa_update_cart_item` in `execute-action.ts`, currently returning "not available yet") into real executors that mutate the visitor's **pinned** cart, plus the plumbing to stream the mutation back to the storefront. Every hard fact is verified against installed code: the raw Medusa 2.17.2 store cart endpoints and their zod validators (`metadata` and `region_id` are accepted on the store routes with just the publishable key), the exact `{cart}` vs `{deleted, parent: cart}` response shapes, and — the security-critical piece — **byte agreement of the `cart_created` adoption sig** between xphere's Web Crypto and stuscle's `verifyCartSig` (proven: Node `createHmac('sha256', secret).update(cartId).digest('hex')` === Web Crypto `subtle.sign` hex, for the raw-UTF8 connection-token key).

The work is almost entirely composition of Phase 131–133 assets: `medusaStoreFetch` (extended for POST/DELETE bodies), the `loadPinnedContext` single-lookup, the `failMode:'closed'` rate limiter, `writeCommerceContext`, the HMAC key convention in `context.ts`, the run-agent tool-loop dispatch, the NDJSON encoder, and the widget stream consumer that Phase 133 already wired for `commerce`/`cart_created`. No new dependencies. The one genuinely new primitive is a `sign` helper (context.ts's existing `hmacKey` imports the key with `['verify']` usage only — signing needs `['sign']`).

**Primary recommendation:** Build two executors mirroring `get-cart.ts` (never throw; friendly strings; single `loadPinnedContext`), add a `signCartSig(secret, cartId)` Web-Crypto helper next to the existing HMAC code, thread `emitStructured: emit` into the ActionContext at the streaming run-agent call site only, enforce the per-turn cap with an in-closure counter in run-agent and the per-conversation-25 cap via the `memory.commerce` counter the executor already reads, and extend the existing widget `commerce`/`cart_created` branch to `window.dispatchEvent`. Ship a committed cross-repo sig **test vector** so both repos' unit tests pin the same bytes.

## Standard Stack

### Core (all already installed — no new deps)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@medusajs/js-sdk` / Store API | 2.17.2 | Cart write endpoints (called raw via `medusaStoreFetch`, not the SDK) | The stuscle backend runs 2.17.2; the SDK source is the authoritative endpoint/shape reference |
| Web Crypto (`crypto.subtle`) | Node ≥20 global | HMAC-SHA256 sign of `cart_id` → hex sig | Same primitive `context.ts` already uses for verify; no `node:crypto` import needed |
| `vitest` | installed | Unit tests (`vitest run`, node env; jsdom per-file for widget) | Repo standard; `tests/**/*.test.ts` |
| `esbuild` (via `npm run build:widget`) | installed | Rebuild `public/widget.js` after `src/widget/index.ts` edit | Repo standard widget build |

### Supporting (Phase 131–133 assets reused verbatim)
| Asset | Purpose | When to Use |
|-------|---------|-------------|
| `medusaStoreFetch` (`client.ts`) | R11-budgeted, pk-headed, 8s-timeout fetch | Every store call; pass `init` for POST/DELETE + JSON body |
| `loadPinnedContext` (`pinned-context.ts`) | ONE conversations read → `{ sessionKey, commerce }` | Top of each executor (R7 key + region + cart id in one read) |
| `rateLimit(..., { failMode: 'closed' })` (`rate-limit.ts`) | R7/R8 deny-on-Redis-down | Top of each executor, before any store call |
| `writeCommerceContext` / merge pattern (`context.ts`) | Re-pin `memory.commerce` preserving other keys | After creating a cart (see re-pin note — prefer a dedicated `cart`-only merge) |
| `resolveRegionId` (`regions.ts`) | Country → region fallback | When `commerce.region_id` absent at create time |
| `formatMoney` (`format.ts`) | MAJOR-unit currency formatting | NL summary cart totals (Medusa returns major units) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Two-step create (`POST /store/carts` then `POST /store/carts/:id` metadata) | Single `POST /store/carts {region_id, metadata}` | **Impossible** — sig = HMAC(secret, **cart_id**), and cart_id isn't known until after create. Two-step is mandatory (documents the locked order). |
| `quantity: 0 → DELETE` | `POST .../:line_id {quantity: 0}` (validator allows `gte(0)`, 0 removes) | Both remove the line; contract §4.1 mandates DELETE for 0 — follow the contract. |
| Reuse `writeCommerceContext` for re-pin | Dedicated `pinCartId(...)` merge helper | `writeCommerceContext` overwrites all commerce fields from a `CommerceClaims` (verified-token shape) and stamps `verified_at`; a self-created cart is not a verified token. A `cart`-only merge is cleaner + honest (see Pitfall 5). |

**Installation:** none. Verified present:
```bash
# @medusajs 2.17.2 (stuscle backend), js-sdk 2.17.2 (both repos), vitest + esbuild (xphere)
```

## Architecture Patterns

### File layout (new + touched)
```
src/lib/medusa/
├── actions/
│   ├── add-to-cart.ts          # NEW — medusa_add_to_cart executor
│   └── update-cart-item.ts     # NEW — medusa_update_cart_item executor
├── cart-sig.ts                 # NEW (or add to context.ts) — signCartSig(secret, cartId): Promise<hex>
├── context.ts                  # TOUCH — optional pinCartId() cart-only merge helper
└── client.ts                   # TOUCH — add emitStructured? to MedusaExecCtx (structural match to ActionContext)

src/lib/action-engine/execute-action.ts   # TOUCH — ActionContext += emitStructured?; wire the 2 write cases
src/lib/agent-runtime/run-agent.ts         # TOUCH — pass emitStructured:emit (streaming only) + per-turn cap counter
src/lib/agent-runtime/guardrails.ts        # TOUCH — checkCommerceWritesPerTurn (pure) + per-conversation-25 helper
src/lib/agent-runtime/idempotency.ts       # TOUCH — add 2 action types to SIDE_EFFECTING_ACTIONS
src/widget/index.ts                        # TOUCH — extend commerce SSE branch to dispatchEvent; then build:widget
public/widget.js                           # REBUILT + committed
public/widget-test.html                    # TOUCH — add CRT-04 manual checklist item

tests/                                     # NEW test files (see Validation Architecture)
```

### Cart write endpoints (VERIFIED against `@medusajs/js-sdk@2.17.2` + `@medusajs/medusa@2.17.2` validators)

All accept only `x-publishable-api-key` (no auth header needed for guest carts). `medusaStoreFetch` already sends the pk and enforces R11.

| Op | Method + Path | Body | Response shape |
|----|---------------|------|----------------|
| Create cart | `POST /store/carts` | `{ region_id }` (also accepts `metadata`, `items`, `email`, `currency_code`, `sales_channel_id`, `locale`; `.strict()`) | `{ cart }` |
| Set metadata (sign) | `POST /store/carts/:id` | `{ metadata: { xphere_sig } }` (validator: `metadata: z.record(z.string(), z.unknown()).nullish()`) | `{ cart }` |
| Add line item | `POST /store/carts/:id/line-items` | `{ variant_id, quantity }` (`quantity: z.number().gt(0)`) | `{ cart }` (**full cart WITH items** — no extra GET needed) |
| Update line item | `POST /store/carts/:id/line-items/:line_id` | `{ quantity }` (`quantity: z.number().gte(0)` — 0 removes) | `{ cart }` |
| Delete line item | `DELETE /store/carts/:id/line-items/:line_id` | — | `{ id, object, deleted, parent: cart }` (**note: `parent`, NOT `cart`**) |
| Read cart (fuzzy match / re-read) | `GET /store/carts/:id?fields=...` | — | `{ cart }` |

> **Confirmed:** the store update-cart route accepts `metadata` and `region_id` with just the publishable key (validator lines 41–53 of `dist/api/store/carts/validators.js`). The add/update/create routes return the **full computed cart** including `items` and `total`, so `itemCount` (= `cart.items.length`) and the ≤50 check need **no separate GET**. Pass a `?fields=id,currency_code,+total,*items,+items.total,*items.variant` query on write calls to guarantee items+totals are present in the response.

### The adoption sig (CRT-01 — SECURITY CRITICAL, byte-verified)

**Format (contract §3/§6):** `xphere_sig = hex(HMAC_SHA256(key = raw-UTF8 bytes of connectionToken, message = raw cart_id string))`.

**Cross-repo proof (run during research):** for `secret="xph_test_connection_token_abc123"`, `cartId="cart_01ABC"`:
- Node (stuscle `verifyCartSig`): `createHmac('sha256', secret).update('cart_01ABC').digest('hex')`
- Web Crypto (xphere): `subtle.importKey('raw', utf8(secret), {name:'HMAC',hash:'SHA-256'}, false, ['sign'])` → `subtle.sign('HMAC', key, utf8('cart_01ABC'))` → hex
- **Both = `f770a654c88db78fceabc6c9aab50149a4209d1b990162085084fd92d53c5a46`** ✅

Stuscle's verifier (`apps/storefront/src/lib/util/cart-sig.ts`) does exactly `createHmac("sha256", secret).update(cartId).digest("hex")` then `timingSafeEqual`. Its test uses `secret="xph_test"`, `cart="cart_01ADOPT"` → `a4d0db1b5d85689686b7002a872543a5c5c4098eaec344689e3d6e8926f42b73`. **Same key convention as Phase 133's context token: raw UTF-8 of the xph_ token, no hex-decode, no prefix strip.** The ONE difference from the context token: sig output is **hex**, not base64url (context token is base64url).

**Mismatch risks to avoid (all flagged):**
1. Do NOT hex-decode the connection token (it is not a hex string; `context.ts` line 33–35 documents this exact trap).
2. Do NOT strip the `xph_` prefix.
3. Do NOT `.update(cartId)` with any encoding transform — the message is the raw cart_id string bytes.
4. Import the CryptoKey with `['sign']` usage (the existing `hmacKey` in `context.ts` uses `['verify']` — you cannot `subtle.sign` with a verify-only key).
5. Output hex, not base64url.

### Re-pin after create (preserve other pinned claims)

The executor already has the current `commerce` object from `loadPinnedContext`. To pin the created cart without losing `region_id`/`country_code`/`cus`/`email`/`wishlist_ref`, do a **cart-only merge** (recommended dedicated helper `pinCartId`):
```
read conversations.memory (scoped by id + org_id) → prev = memory.commerce ?? {}
update memory.commerce = { ...prev, cart: newCartId }   // touch ONLY cart
```
This is the same read-merge-write shape as `writeCommerceContext`, minus the claim overwrite + `verified_at` stamp. Do NOT reuse `writeCommerceContext` directly: it expects a full `CommerceClaims` (verified-token shape) and overwrites every commerce field — a self-created cart is the ONE legitimate non-token re-pin (contract §3 explicitly authorizes it), so a purpose-built merge is the honest fit.

### emitStructured threading (CRT-03)

- **Type:** add `emitStructured?: (obj: Record<string, unknown>) => void` to BOTH `ActionContext` (`execute-action.ts`) and `MedusaExecCtx` (`client.ts` — the two are "structurally compatible" per its existing comment; the medusa case passes `ctx` straight through to the executor).
- **Streaming call site** (`run-agent.ts` `runAgentStreaming`, the `executeAction(...)` call ~line 1242–1249): add `emitStructured: emit` to the ActionContext object. `emit` is `(obj) => controller.enqueue(encode(obj))`, already in closure scope.
- **Blocking call site** (`runAgentBlocking`, ~line 775–791): do NOT add it → `undefined` → executor null-checks (`ctx.emitStructured?.(...)`).
- **Encoder:** `createEncoder()` is `(obj) => enc.encode(JSON.stringify(obj) + '\n')` — fully generic. A `commerce` event needs **zero encoder change**; it's just another `emit({ event:'commerce', ... })`.

### Guardrails: where each cap lives (CRT-02)

Four distinct limits — do not conflate:
| Cap | Kind | Home | Mechanism |
|-----|------|------|-----------|
| qty 1–10/op | clamp | executor | `Math.max(1, Math.min(10, n))` before body build |
| ≤50 line items | clamp | executor | check `cart.items.length` on the write response; rollback new line if breached |
| R7 10/min/session (closed) | rate-limit | executor | `rateLimit('com:write:' + sessionKey, 10, 60, { failMode:'closed' })` |
| R8 60/day/conversation (closed) | rate-limit | executor | `rateLimit('com:write:day:' + ctx.conversationId, 60, 86400, { failMode:'closed' })` |
| 3 writes/TURN | guardrail | run-agent tool loop | in-closure `let commerceWrites = 0` + pure `checkCommerceWritesPerTurn(n)` in guardrails.ts; check before `executeAction` when `capturedActionType` is a commerce write |
| 25 writes/conversation | guardrail | executor (recommended) | increment/check `memory.commerce.write_count` in the read-merge-write the executor already does; returns a clean string on breach |

- **R7 session key:** use `sessionKey` from `loadPinnedContext` (= `conversations.session_key`, fallback `conversationId`) — this is exactly what `get-cart.ts` uses for R6. Single lookup gives sessionKey + region + cart id.
- **Per-turn (3):** run-agent needs to know an action is a commerce write *before* dispatch. Add `COMMERCE_WRITE_ACTIONS = new Set(['medusa_add_to_cart','medusa_update_cart_item'])` (export from idempotency.ts alongside `SIDE_EFFECTING_ACTIONS`, or a small commerce module). In each tool-loop `execute`, if `COMMERCE_WRITE_ACTIONS.has(capturedActionType)` and `++commerceWrites > 3`, return a friendly string BEFORE `executeAction` (never throw; matches the existing "return denial string" pattern). Declare the counter once per invocation in BOTH blocking and streaming loops (they duplicate by design).
- **Per-conversation (25):** prefer the `memory.commerce.write_count` counter (durable across turns/invocations, no Redis dependency, co-located with the pin the executor already reads/writes). Alternative: a Redis key `com:writes:conv:{convId}` — but a soft guardrail should NOT fail-closed on Redis-down, so the DB counter is the more predictable choice. Sequential awaited tool loop makes the read-modify-write race-safe in practice (flag anyway).

### Idempotency (CRT-04 second clause)
- One-line change: add `'medusa_add_to_cart'` and `'medusa_update_cart_item'` to `SIDE_EFFECTING_ACTIONS` in `idempotency.ts`.
- `requiresIdempotency` then returns true → run-agent derives `key = sha256(invocationId + ':' + toolCallIndex)`, checks before execute, records after. Two *different* write calls in one turn get different `toolCallIndex` → NOT deduped against each other (correct — distinct intents). Only an exact re-execution of the same index (a loop retry) is deduped.
- **Emit interaction:** the idempotency cache-hit path in run-agent returns the cached string BEFORE calling `executeAction`, so a replay does NOT re-emit the SSE event or re-hit the store — the desired no-double-add behavior falls out for free (the emit lives inside the executor).

### Widget re-dispatch (CRT-04 first clause)

Phase 133 already added a `commerce`/`cart_created` branch in the widget stream consumer (`src/widget/index.ts` ~line 852) that clears the cached context token. Extend it:
1. Widen the `SSEEvent` interface (~line 572) with `cartId?: string; itemCount?: number; sig?: string`.
2. In the `onEvent` handler, add a branch for ANY `evt.event === 'commerce'` that re-dispatches:
   `window.dispatchEvent(new CustomEvent('xphere:commerce', { detail: { action: evt.action, cartId: evt.cartId, itemCount: evt.itemCount, sig: evt.sig } }))`
3. Keep the existing `cart_created` cache-clear (Phase 133 behavior) — it's additive.
4. `npm run build:widget` → commit `public/widget.js`.

The storefront consumer already exists and is frozen (`commerce-bridge.tsx` + `commerce-event.ts` in stuscle): it routes `cart_updated → refreshAgentCart()`, `cart_created + cartId + sig → adoptAgentCart(cartId, sig, countryCode)`, else ignore. So the widget detail shape `{ action, cartId, itemCount, sig }` must match exactly (it does — contract §6).

### Anti-Patterns to Avoid
- **Accepting a cart_id/line_id from tool params.** Tool input schemas contain ZERO visitor-scoped ids (anti-IDOR core, contract §3). `update-cart-item` resolves the line by fuzzy *title/variant*, never by id; `add-to-cart` allows only product/variant ids.
- **Emitting `cart_created` before the metadata sig write returns 2xx.** Adoption then fails verification on the storefront. Order is load-bearing (CONTEXT §specifics).
- **Reading `.cart` off the DELETE response.** It's `.parent`, not `.cart`.
- **Dividing prices by 100.** Medusa v2 store amounts are MAJOR units (Phase 132 pitfall; `format.ts` documents it).
- **Throwing into the tool loop.** Executors return strings; run-agent turns a throw into a generic "Tool execution failed".

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cart id / region resolution | New lookup | `loadPinnedContext` + `resolveRegionId` | Single conversations read gives sessionKey+region+cart; region fallback already verified vs stuscle |
| Fail-closed write budget | Custom counter | `rateLimit(key, n, w, { failMode:'closed' })` | R7/R8 semantics (deny on Redis-down) already implemented + tested (Phase 131) |
| HMAC verify convention | New crypto | Mirror `context.ts` `hmacKey` (raw-UTF8 key), add `['sign']` variant | Byte agreement with stuscle proven; any deviation breaks adoption |
| SSE framing | New event channel | `emit({ event:'commerce', ... })` through existing encoder | Encoder is generic; widget already consumes the stream |
| Idempotency for writes | New dedup table | Add 2 strings to `SIDE_EFFECTING_ACTIONS` | `tool_idempotency_keys` infra + run-agent gating already exists |
| Money formatting | `toFixed`/manual | `formatMoney(amount, currency)` | Intl currency, MAJOR units, region-correct |

**Key insight:** this phase writes almost no new *infrastructure* — it composes six Phase 131–133 primitives plus one `sign` helper. The risk surface is (a) sig byte agreement and (b) event ORDER, not library choice.

## Common Pitfalls

### Pitfall 1: sig key mishandling → silent adoption failure
**What goes wrong:** the storefront `adoptAgentCart` silently ignores a bad sig (logs, returns false), so the cart is created but never adopted — no visible error, just "the cart didn't sync."
**Why:** hex-decoding the token, stripping `xph_`, base64url instead of hex, or a `['verify']`-only key that can't sign.
**How to avoid:** use `subtle.importKey('raw', TextEncoder().encode(secret), ..., ['sign'])` + hex output; pin the exact bytes with a committed cross-repo test vector (below).
**Warning signs:** unit sig test passes but the storefront logs `[agent-bridge] bad sig`.

### Pitfall 2: emitting `cart_created` before metadata write
**What goes wrong:** storefront fetches the cart during adoption, but `metadata.xphere_sig` isn't set yet / the sig it verifies is over a cart whose metadata write is still in flight — adoption races and fails.
**How to avoid:** `await` the `POST /store/carts/:id {metadata}` 2xx, THEN pin, THEN emit `cart_created`. Only after that add the line item and emit `cart_updated`.

### Pitfall 3: DELETE response shape (`parent`, not `cart`)
**What goes wrong:** `const { cart } = await medusaStoreFetch(... DELETE ...)` yields `undefined`; `itemCount` crashes or is wrong.
**How to avoid:** delete returns `{ deleted, parent: cart }`. Read `itemCount` from `parent.items.length`; update/add read from `cart.items.length`.

### Pitfall 4: two-step create is mandatory, not an optimization target
**What goes wrong:** a "clever" single `POST /store/carts {region_id, metadata:{xphere_sig}}` is impossible — the sig needs the cart_id that create returns.
**How to avoid:** always create → read cart_id → sign → `POST /store/carts/:id {metadata}`. Document this so a future refactor doesn't "collapse the extra call."

### Pitfall 5: `writeCommerceContext` overwrites the whole commerce object
**What goes wrong:** re-pinning the created cart via `writeCommerceContext` drops `region_id`/`cus`/etc. unless you reconstruct a full `CommerceClaims`, and it stamps a misleading `verified_at`.
**How to avoid:** use a cart-only merge (`{ ...prev, cart: newCartId }`). Reserve `writeCommerceContext` for actual verified-token re-pins in the chat route.

### Pitfall 6: ≤50 rollback must delete the NEW line only
**What goes wrong:** deleting "the just-added item" by variant_id could nuke a pre-existing line if the variant was already in the cart.
**Why it's actually safe:** Medusa merges same-variant adds into one line (no new line), so the item COUNT only newly exceeds 50 when a brand-new distinct variant line is added — that line is always safe to delete wholesale. Identify it as the line whose `variant_id` matches the just-added variant. (Document the reasoning so the rollback isn't "fixed" into a bug.)

### Pitfall 7: widget tests read the BUILT file
**What goes wrong:** editing `src/widget/index.ts` without `npm run build:widget` → jsdom widget tests eval a stale `public/widget.js`.
**How to avoid:** rebuild before running widget tests; commit `public/widget.js`.

## Code Examples

### Sign helper (NEW `src/lib/medusa/cart-sig.ts`) — byte-matched to stuscle
```typescript
// key = raw UTF-8 bytes of the xph_ connection token (SAME convention as
// context.ts hmacKey), message = raw cart_id string, output = lowercase hex.
// Proven identical to stuscle verifyCartSig: createHmac('sha256', secret).update(cartId).digest('hex').
const enc = new TextEncoder()
export async function signCartSig(secret: string, cartId: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'], // NOTE: 'sign', not 'verify'
  )
  const mac = await crypto.subtle.sign('HMAC', key, enc.encode(cartId))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

### add-to-cart executor — ordered no-cart sequence (skeleton)
```typescript
// Source: mirrors get-cart.ts (never throws; single loadPinnedContext) + contract §3/§4.1/§6
export async function addToCartMedusa(
  params: Record<string, unknown>, creds: MedusaCredentials, ctx: MedusaExecCtx,
): Promise<string> {
  try {
    const { sessionKey, commerce } = await loadPinnedContext(ctx)

    const r7 = await rateLimit('com:write:' + sessionKey, 10, 60, { failMode: 'closed' })
    if (!r7.allowed) return "You're adding to the cart too fast — give it a moment."
    const r8 = await rateLimit('com:write:day:' + (ctx.conversationId ?? sessionKey), 60, 86400, { failMode: 'closed' })
    if (!r8.allowed) return "You've reached today's cart-change limit for this chat."

    const qty = Math.max(1, Math.min(10, Number(params.quantity) || 1)) // clamp 1–10

    let cartId = typeof commerce.cart === 'string' ? commerce.cart : undefined
    if (!cartId) {
      const regionId = typeof commerce.region_id === 'string'
        ? commerce.region_id
        : await resolveRegionId(creds, ctx.organizationId, typeof commerce.country_code === 'string' ? commerce.country_code : undefined)
      // 1) create
      const { cart } = await medusaStoreFetch<{ cart: { id: string } }>(
        creds, '/store/carts', ctx.organizationId,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ region_id: regionId }) },
      )
      cartId = cart.id
      // 2) sign + write metadata (MUST return before emit)
      const sig = await signCartSig(creds.connectionToken, cartId)
      await medusaStoreFetch(creds, `/store/carts/${cartId}`, ctx.organizationId,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ metadata: { xphere_sig: sig } }) })
      // 3) pin (cart-only merge, preserves region/cus/etc.)
      await pinCartId(ctx.supabase, ctx.conversationId!, ctx.organizationId, cartId)
      // 4) emit cart_created ONLY now
      ctx.emitStructured?.({ event: 'commerce', action: 'cart_created', cartId, itemCount: 0, sig })
    }

    const variantId = await resolveVariant(params, creds, ctx) // product_id → single variant or option-list string
    if (typeof variantId !== 'string') return variantId       // option-list prompt

    // 5) add line item — response is the FULL cart with items
    const fields = 'id,currency_code,+total,*items,+items.total,*items.variant'
    const { cart } = await medusaStoreFetch<{ cart: StoreCart }>(
      creds, `/store/carts/${cartId}/line-items?fields=${encodeURIComponent(fields)}`, ctx.organizationId,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant_id: variantId, quantity: qty }) })

    // 6) ≤50 rollback (delete the new variant's line if breached)
    if ((cart.items?.length ?? 0) > 50) {
      const newLine = cart.items!.find((i) => i.variant_id === variantId)
      if (newLine) await medusaStoreFetch(creds, `/store/carts/${cartId}/line-items/${newLine.id}`, ctx.organizationId, { method: 'DELETE' })
      return 'Your cart is full (50 items max) — I couldn’t add that one.'
    }

    ctx.emitStructured?.({ event: 'commerce', action: 'cart_updated', cartId, itemCount: cart.items?.length ?? 0 })
    return `Added ${qty} to your cart. ${summarizeTotal(cart)}`
  } catch (err) {
    if (err instanceof MedusaRateLimitError) return 'Too many store requests just now — try again in a moment.'
    if (err instanceof Error && err.name === 'TimeoutError') return 'The store took too long to respond.'
    return "I couldn't update your cart just now."
  }
}
```

### run-agent wiring (streaming path — per-turn cap + emitStructured)
```typescript
// declared once per invocation, alongside `let toolCallIndex = 0`
let commerceWrites = 0
// ... inside the dynamicTool execute(), BEFORE executeAction():
if (COMMERCE_WRITE_ACTIONS.has(capturedActionType)) {
  const turnDenial = checkCommerceWritesPerTurn(++commerceWrites) // pure helper, returns string | null
  if (turnDenial) { toolCallsLog.push({ name: capturedToolName, args: /*...*/, denied: true, denied_reason: 'commerce_turn_cap' }); return turnDenial }
}
// ... existing executeAction call — ADD emitStructured only here (streaming):
result = await executeAction(resolvedTool.actionType, toolArgs, { apiKey, locationId },
  { organizationId: orgId, supabase: serviceClient, toolConfig: resolvedTool.config,
    integrationProvider: resolvedTool.integrationProvider ?? undefined, delegationChain: currentChain,
    conversationId, emitStructured: emit })   // <-- blocking path omits this key
```

### widget re-dispatch (CRT-04)
```typescript
// SSEEvent += cartId?: string; itemCount?: number; sig?: string
} else if (evt.event === 'commerce') {
  window.dispatchEvent(new CustomEvent('xphere:commerce', {
    detail: { action: evt.action, cartId: evt.cartId, itemCount: evt.itemCount, sig: evt.sig },
  }))
  if (evt.action === 'cart_created') { cachedToken = null; cachedExp = 0 } // keep Phase 133 cache-clear
}
```

## State of the Art

| Old Approach | Current Approach | When | Impact |
|--------------|------------------|------|--------|
| SDK `sdk.store.cart.*` (storefront) | raw `medusaStoreFetch` (agent side) | this repo | Agent never runs the JS SDK; hit endpoints directly with pk header. SDK source is the shape reference only. |
| Stubbed write cases return "not available yet" | Real executors (this phase) | 134 | The 6-case stub group in `execute-action.ts` loses its two cart entries |

**Deprecated/outdated:** none relevant. Medusa 2.17.2 store cart API is current and matches the frozen contract §4.1.

## Common Pitfalls checklist for the planner (verification hooks)
- [ ] `cart_created` emitted strictly after the metadata `POST` resolves 2xx.
- [ ] sig computed with `['sign']` key usage + hex output; cross-repo vector test present.
- [ ] DELETE response read via `.parent`.
- [ ] Re-pin preserves `region_id`/`country_code`/`cus`/`email`/`wishlist_ref`.
- [ ] R7/R8 use `failMode:'closed'`; per-turn/per-conv caps return strings, never throw.
- [ ] Both action types in `SIDE_EFFECTING_ACTIONS`.
- [ ] `public/widget.js` rebuilt + committed; widget-test.html checklist extended.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node Web Crypto (`crypto.subtle`) | sig signing | ✓ | Node ≥20 global | — |
| vitest + esbuild | tests + `build:widget` | ✓ | installed | — |
| Medusa store backend (`:9000`) | live cart writes (manual/integration only) | n/a for units | 2.17.2 | Unit tests mock `medusaStoreFetch` entirely — no live backend needed |
| Redis | R7/R8 enforcement | optional | — | `failMode:'closed'` DENIES when Redis down (by design); units mock `rateLimit` |

**Missing dependencies with no fallback:** none — all unit tests mock the store fetch, supabase, rate-limit, and `emitStructured`.
**Note:** live end-to-end adoption (widget → storefront `adoptAgentCart`) requires both dev servers per the contract §9 checklist; that is manual UAT, not part of this phase's automated gate.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (node env; `@vitest-environment jsdom` per-file for widget) |
| Config file | `vitest.config.ts` (include `tests/**/*.test.ts`, alias `@`, `server-only` stub) |
| Quick run command | `npx vitest run tests/medusa-cart-writes.test.ts` |
| By-name | `npx vitest run -t "no-cart"` |
| Full suite command | `npm run test` (`vitest run`) |
| Widget build (before widget tests) | `npm run build:widget` |
| Full gate | `npm run build` (build:widget + build:reviews-widget + `next build` = typecheck) + `npm run lint` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CRT-01 | no-cart → create → sign → metadata write → pin → emit `cart_created` **in that order** | unit | `npx vitest run tests/medusa-cart-writes.test.ts -t "create+sign+pin+emit order"` | ❌ Wave 0 |
| CRT-01 | `cart_created.sig` == committed cross-repo hex vector | unit | `... -t "sig vector"` | ❌ Wave 0 |
| CRT-01 | pin merge preserves region/cus/etc. (cart-only) | unit | `... -t "pin preserves"` | ❌ Wave 0 |
| CRT-01 | fuzzy line match; `quantity:0` → DELETE; reads `parent.items` | unit | `... -t "update fuzzy"` / `... -t "delete on zero"` | ❌ Wave 0 |
| CRT-02 | qty clamp 1–10; ≤50 rollback deletes new line | unit | `... -t "clamp"` / `... -t "51st item rollback"` | ❌ Wave 0 |
| CRT-02 | R7/R8 `failMode:'closed'` deny when Redis down (mock `rateLimit` → `{allowed:false}`) | unit | `... -t "R7 closed"` | ❌ Wave 0 |
| CRT-02 | per-turn cap (4th write returns string) + per-conversation-25 | unit | `npx vitest run tests/guardrails-commerce.test.ts` | ❌ Wave 0 |
| CRT-03 | streaming passes `emitStructured`; blocking omits (null-check no-op) | unit | `... -t "emitStructured streaming only"` | ❌ Wave 0 |
| CRT-03 | emit spy sees `commerce`/`cart_updated` on success | unit | `... -t "emits cart_updated"` | ❌ Wave 0 |
| CRT-04 | both action types in `SIDE_EFFECTING_ACTIONS` | unit | `npx vitest run tests/medusa-idempotency.test.ts` (or extend existing) | ❌ Wave 0 |
| CRT-04 | widget re-dispatches `xphere:commerce` CustomEvent | **manual** | `public/widget-test.html` + `window.addEventListener('xphere:commerce', e => console.log(e.detail))` | extend existing |

### Cross-repo sig vector (COMMIT THIS — both repos must agree)
```
secret : xph_test_connection_token_abc123
cartId : cart_01ABC
sig    : f770a654c88db78fceabc6c9aab50149a4209d1b990162085084fd92d53c5a46
```
Assert `await signCartSig('xph_test_connection_token_abc123','cart_01ABC') === '<sig>'`. This is the exact value `createHmac('sha256', secret).update(cartId).digest('hex')` produces — i.e. what stuscle's `verifyCartSig` recomputes. (Second reference vector, matching the stuscle test constants: `secret=xph_test`, `cartId=cart_01ADOPT` → `a4d0db1b5d85689686b7002a872543a5c5c4098eaec344689e3d6e8926f42b73`.)

### Sampling Rate
- **Per task commit:** `npx vitest run tests/medusa-cart-writes.test.ts` (+ `tests/guardrails-commerce.test.ts` when touching caps).
- **Per wave merge:** `npm run test`.
- **Phase gate:** `npm run test` green + `npm run build` (typecheck) + `npm run lint` green before `/gsd:verify-work`; `public/widget.js` rebuilt & committed; widget-test.html manual re-dispatch confirmed.

### Test mocking idiom (established — copy from `tests/medusa-actions.test.ts`)
- Mock `@/lib/medusa/client` via `importOriginal` (keep real error classes for `instanceof`), replace `medusaStoreFetch` with a `vi.fn()` returning canned `{cart}` / `{deleted, parent}` shapes.
- Mock `@/lib/rate-limit` (`rateLimit` → `vi.fn()`); drive R7/R8 closed by returning `{ allowed:false }`.
- Supabase chainable stub: `from().select().eq().eq().maybeSingle()` for reads, `.update().eq().eq()` for the pin write (copy `buildSupabase` from `tests/medusa-context.test.ts`).
- `emitStructured`: pass a `vi.fn()` spy in ctx; assert call ORDER (`cart_created` before the first line-item add's `cart_updated`) via `mock.invocationCallOrder` or sequential `mockMedusaStoreFetch`/spy call inspection.
- Widget: `@vitest-environment jsdom`, eval built `public/widget.js` (see `tests/widget.test.ts` `loadWidget`) — but CRT-04 re-dispatch is primarily MANUAL per the output spec; a jsdom assertion is optional/nice-to-have.

### Wave 0 Gaps
- [ ] `tests/medusa-cart-writes.test.ts` — CRT-01/02/03 executor behavior (clamps, order, sig vector, rollback, R7/R8 closed, emit spy, DELETE `parent` shape).
- [ ] `tests/guardrails-commerce.test.ts` — per-turn (3) + per-conversation (25) caps return clean strings.
- [ ] `tests/medusa-idempotency.test.ts` (or extend an existing idempotency test) — the two action types are in `SIDE_EFFECTING_ACTIONS` / `requiresIdempotency` true.
- [ ] `public/widget-test.html` — add a CRT-04 checklist item + a console `xphere:commerce` listener snippet.
- No framework install needed (vitest present).

## Project Constraints (from CLAUDE.md)
- `npm run build` after changes to catch type errors (build runs `next build` which type-checks; widget build does NOT type-check on its own).
- Runtime: Node.js for the chat route + executors; keep the widget vanilla TS (no React/Next imports).
- Multi-tenancy: every conversations query is scoped by `id` + `org_id` (the pin read-merge-write already is).
- Migrations: none needed this phase (no schema change; `medusa_add_to_cart`/`medusa_update_cart_item` already exist in the `action_type` enum + `database.ts` from Phase 132's MED-01). Do NOT edit old migrations; do NOT change `src/lib/crypto.ts` format.
- Tokens/keys: connection token is decrypted per-org via `getMedusaCredentialsForOrg` (`creds.connectionToken`); never log it.
- Frozen contract: any payload/endpoint/header change requires editing `INTEGRATION-CONTRACT.md` in BOTH repos first — this phase must NOT deviate from §3/§4.1/§6/§7.

## Open Questions
1. **Per-conversation-25 counter home (Redis vs `memory.commerce`).** CONTEXT grants discretion.
   - Known: it must survive across turns/invocations; R8 already covers the 60/day/conv time-boxed limit via Redis.
   - Recommendation: `memory.commerce.write_count` (durable, no Redis dep, folded into the existing read-merge-write). Flag the (low) read-modify-write race; sequential awaited tool loop makes it safe in practice.
2. **`ACTION_DESCRIPTIONS` + `spec.ts` NODES registration.** The two write tools are NOT yet in `ACTION_DESCRIPTIONS` (run-agent) or `NODES` (spec.ts) — required so the LLM can select them and workflow authoring surfaces them. Add both (`integration_required: ['medusa']`, no visitor-id params). Recommendation: register in this phase (goal implies the tools become live); mirror the `medusa_get_cart` node entry (empty/param-light schema — `add_to_cart`: `{product_id?, variant_id?, quantity?}`; `update_cart_item`: `{item_title_or_variant?, quantity}`).
3. **`fields` query on write responses.** Medusa returns the full cart by default, but totals/variant titles are safest to request explicitly. Recommendation: pass `?fields=id,currency_code,+total,*items,+items.total,*items.variant` on the add/update calls so `summarizeTotal` and fuzzy-match have what they need without a second GET.

## Sources

### Primary (HIGH confidence — installed code, both repos)
- `@medusajs/js-sdk@2.17.2` `dist/store/index.js` (lines 535–700) — cart create/update/createLineItem/updateLineItem/deleteLineItem paths, methods, and `{cart}` / `{deleted, parent:cart}` response shapes.
- `@medusajs/medusa@2.17.2` `dist/api/store/carts/validators.js` (lines 8–63) — `CreateCart`/`UpdateCart`/`StoreAddCartLineItem`/`StoreUpdateCartLineItem` accept `region_id`, `metadata`, `quantity gt/gte(0)`.
- xphere: `client.ts`, `get-cart.ts`, `search-products.ts`, `get-product.ts`, `context.ts`, `pinned-context.ts`, `credentials.ts`, `regions.ts`, `format.ts`, `execute-action.ts`, `run-agent.ts`, `encoder.ts`, `idempotency.ts`, `guardrails.ts`, `rate-limit.ts`, `widget/index.ts`, `workflows/spec.ts`, `chat/[token]/route.ts`, `tests/medusa-actions.test.ts`, `tests/medusa-context.test.ts`, `tests/widget.test.ts`, `vitest.config.ts`.
- stuscle: `lib/data/cart.ts`, `lib/data/agent-bridge.ts`, `lib/util/cart-sig.ts`, `lib/data/__tests__/agent-bridge.spec.ts`, `modules/layout/components/xphere-widget/commerce-bridge.tsx`, `lib/util/commerce-event.ts` — the frozen consumer side + `verifyCartSig` reference.
- INTEGRATION-CONTRACT.md (FROZEN v1.1) §3, §4.1, §6, §7.
- Cross-repo HMAC computation (run during research): Node `createHmac` hex === Web Crypto `subtle.sign` hex for raw-UTF8 key (3 vectors, all MATCH).

### Secondary (MEDIUM)
- Medusa docs URLs embedded in the js-sdk JSDoc (store cart API routes) — corroborate the installed source.

## Metadata

**Confidence breakdown:**
- Cart write endpoints/shapes: HIGH — read from installed 2.17.2 SDK + validators, cross-checked with the stuscle storefront's live usage.
- sig byte agreement: HIGH — computed and matched across Node/WebCrypto + stuscle's verifier + existing Phase 133 convention.
- emitStructured / guardrails thread points: HIGH — exact call sites read in run-agent (both paths) and execute-action.
- Per-conversation-25 counter home: MEDIUM — discretion; recommendation given, planner decides.

**Research date:** 2026-07-17
**Valid until:** 2026-08-16 (stable; only churns if `@medusajs` majors move — pinned at 2.17.2 today, and the contract is frozen)

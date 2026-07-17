# Phase 135: Wishlist Tools - Research

**Researched:** 2026-07-17
**Domain:** HMAC-signed cross-service RPC (xphere → Stuscle `/agent/*`), agent tool executors, Web Crypto signing
**Confidence:** HIGH — every claim verified against live code in BOTH repos + byte-computed signing vectors

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Signed client (`src/lib/medusa/client.ts` — add `medusaAgentFetch`)**
- `medusaAgentFetch<T>(creds, path, body)`: `ts = Math.floor(Date.now()/1000)`; `sig = hex(HMAC_SHA256(connectionToken, ts + "." + rawBodyString))`; headers `X-Xphere-Timestamp: ts`, `X-Xphere-Signature: v1=<sig>`, `Content-Type: application/json`; POST only; 8s timeout; R11 shared budget.
- rawBodyString is EXACTLY the string passed to fetch body — stringify once, sign that string, send that string (byte-identical; this is what stuscle verifies).
- Unit test with a fixed reference vector (secret `test-secret`, ts `1750000000`, body `{"a":1}`) — document expected hex in the test so the stuscle side can assert the same vector.

**Executors (`src/lib/medusa/actions/`)**
- Owner resolution (all three): pinned `customer_id` if present, else pinned `wishlist_ref`, else return a friendly explanation that nothing can be saved yet (and that browsing the store creates the link). NO owner params in tool schemas.
- `wishlist-add.ts` — params `{ product_id: string, variant_id?: string }` → `POST /agent/wishlists/add`. 409 `wishlist_full` → friendly "wishlist is full (100 items)" string.
- `wishlist-remove.ts` — params `{ product_id: string, variant_id?: string }` → `/agent/wishlists/remove`.
- `wishlist-list.ts` — no params → `/agent/wishlists/list`; render items (title, variant) as a short list.
- Budgets: add/remove → R7/R8 write budgets (fail-closed) + `SIDE_EFFECTING_ACTIONS`; list → R6 read budget.

**Wiring**
- `execute-action.ts` cases, `ACTION_DESCRIPTIONS`, `spec.ts` NODES (all three; `integration_required: ['medusa']`).

### Claude's Discretion
- Error-string wording; whether list result includes product URLs (needs `storefront_url` from config — nice-to-have).

### Deferred Ideas (OUT OF SCOPE)
- "Move wishlist item to cart" composite tool — later (agent can chain add_to_cart today).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WSL-01 | `medusa_wishlist_add/remove/list` via signed `/agent/wishlists/*` per contract §4.2; owner from pinned context only (customer_id else wishlist_ref) | `medusaAgentFetch` signing design (§Architecture P1), owner-resolution helper (§Architecture P3), three executors mirroring `get-cart.ts`/`add-to-cart.ts` (§Architecture P2), stuscle route/response shapes confirmed by reading `wishlists/{add,list,remove}/route.ts` |
| WSL-02 | HMAC signing helper (ts + "." + rawBody) unit-tested; add/remove side-effecting (R7/R8), list read-budgeted (R6 30/min/session) | Signing convention proven byte-identical to stuscle `verify-hmac.ts` + `sign-xphere.ts` (§Architecture P1, §Pitfalls 1); committed reference vectors (§Code Examples); R7/R8/R6 patterns copied from shipped `add-to-cart.ts`/`get-cart.ts` (§Architecture P4); `SIDE_EFFECTING_ACTIONS` registration (§Architecture P5) |
</phase_requirements>

## Summary

This phase adds three agent tools (`medusa_wishlist_add/remove/list`) that call Stuscle's privileged `/agent/wishlists/*` surface over an HMAC-signed POST. Everything the phase needs already exists on both sides and has been read directly: the Stuscle routes, Zod schemas, `verify-hmac.ts` middleware, the wishlist service (100-item cap, in-service idempotency), and — critically — the reference signer `sign-xphere.ts` that the Stuscle integration test uses. The xphere side reuses Phase 134's proven raw-UTF-8-key / hex-output Web Crypto convention (`cart-sig.ts`), the shipped `rateLimit`, `loadPinnedContext`, `SIDE_EFFECTING_ACTIONS`, and the never-throw friendly-string executor pattern from `get-cart.ts`/`add-to-cart.ts`.

The single load-bearing risk is **byte agreement of the signed message**. Stuscle recomputes `v1=hex(HMAC_SHA256(secret, `${ts}.${rawStr}`))` over `req.rawBody` decoded as UTF-8. I verified by computation that `crypto.subtle.sign` (raw-UTF-8 key) produces byte-identical output to Node's `createHmac` for the exact message `ts + "." + rawBody`, and that it matches Stuscle's `sign-xphere.ts` formula. The only way to break agreement is to stringify the body more than once or to sign a different `ts` string than the one placed in the header — both avoidable by the "stringify once, sign that, send that" rule.

**Primary recommendation:** Add `medusaAgentFetch` + an exported `signAgentBody(secret, ts, rawBody)` helper (bare hex; caller adds `v1=`), sharing the R11 org budget and 8s timeout with `medusaStoreFetch`. Build three executors mirroring the shipped cart executors (never throw; friendly strings; R7/R8 fail-closed for add/remove, R6 memory for list; owner from `commerce.cus` else `commerce.wishlist_ref`). Commit a cross-repo signing vector in `tests/medusa-wishlist.test.ts` and recommend Stuscle assert the same literal. Use idempotent-safe wording (the Stuscle responses cannot distinguish "already saved" from "newly saved").

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Web Crypto `crypto.subtle` | Node built-in (global) | HMAC-SHA256 signing of the agent request | Already the project convention (`cart-sig.ts`, `context.ts`); no dep; verified byte-identical to Node `createHmac` |
| `@/lib/rate-limit` `rateLimit` | in-repo | R6/R7/R8/R11 budgets | Shipped; `failMode: 'open'\|'memory'\|'closed'` already supports fail-closed writes |
| `vitest` | 4.1.2 (installed) | unit tests (signing vector + executors) | Project test runner; config `vitest.config.ts`, tests in `tests/**/*.test.ts` |

### Supporting (all in-repo, reused verbatim)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/lib/medusa/pinned-context.ts` `loadPinnedContext` | one `conversations` lookup → `{ sessionKey, commerce }` | every executor (owner + R6/R7 session key) |
| `src/lib/medusa/cart-sig.ts` | raw-UTF-8-key / hex-output signing convention | template for `signAgentBody` (same key handling) |
| `src/lib/medusa/credentials.ts` `getMedusaCredentialsForOrg` | decrypts `connectionToken`, returns `MedusaCredentials` | dispatcher, before executor |
| `src/lib/agent-runtime/idempotency.ts` `SIDE_EFFECTING_ACTIONS` | idempotency gating in run-agent tool loop | add `medusa_wishlist_add/remove` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crypto.subtle` (Web Crypto) | Node `crypto.createHmac` | Both produce identical bytes (verified). `subtle` matches the shipped `cart-sig.ts`/`context.ts` convention and needs no `server-only`/node-only import — keep it for consistency + testability in the node vitest env |
| new `agent-sig.ts` | extend `cart-sig.ts` | Minor. `cart-sig.ts` signs `cartId` only; a sibling `signAgentBody(secret, ts, rawBody)` is cleanest. Location is a planner call — colocating with the vector-documenting comment is fine |

**Installation:** None. No new dependencies. `crypto.subtle` is a global; `vitest` is installed.

**Version verification:** `vitest` confirmed at `^4.1.2` in `package.json`. No package to add.

## Architecture Patterns

### Recommended file layout
```
src/lib/medusa/
├── client.ts            # ADD medusaAgentFetch<T>(creds, path, orgId, body)
├── agent-sig.ts         # NEW (or extend cart-sig.ts): signAgentBody(secret, ts, rawBody) → bare hex
└── actions/
    ├── wishlist-add.ts     # NEW: addWishlistItem(params, creds, ctx)
    ├── wishlist-remove.ts  # NEW: removeWishlistItem(params, creds, ctx)
    └── wishlist-list.ts    # NEW: listWishlist(creds, ctx)   ← no params, mirrors get-cart.ts
```

### Pattern 1: `medusaAgentFetch` — signed POST to `/agent/*` (WSL-01, WSL-02)
**What:** POST-only signed client. Enforces R11 org budget BEFORE the network call (same key as `medusaStoreFetch`), signs `ts + "." + rawBody`, sends the identical raw string, 8s timeout, throws `MedusaApiError` on non-2xx (so executors can map 409).
**When:** every wishlist call.
**Byte-agreement invariant (SECURITY CRITICAL):** stringify the body **once**; sign THAT string; send THAT string; sign with the exact `ts` string put in the header.

```typescript
// Source: derived from src/lib/medusa/client.ts (medusaStoreFetch) +
// stuscle apps/backend/integration-tests/utils/sign-xphere.ts (reference signer)
export async function medusaAgentFetch<T>(
  creds: MedusaCredentials,
  path: string,                      // e.g. '/agent/wishlists/add'
  orgId: string,
  body: Record<string, unknown>,
): Promise<T> {
  const rl = await rateLimit(`medusa:org:${orgId}`, 120, 60, { failMode: 'memory' }) // R11 — shared with store fetch, BEFORE fetch
  if (!rl.allowed) throw new MedusaRateLimitError()

  const raw = JSON.stringify(body)                    // stringify ONCE
  const ts = Math.floor(Date.now() / 1000).toString() // seconds, as a STRING
  const sig = await signAgentBody(creds.connectionToken, ts, raw) // bare hex

  const url = `${creds.baseUrl.replace(/\/$/, '')}${path}`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Xphere-Timestamp': ts,
      'X-Xphere-Signature': `v1=${sig}`,
    },
    body: raw,                                         // send the SAME string that was signed
    signal: AbortSignal.timeout(8000),
  })
  if (!res.ok) throw new MedusaApiError(res.status, await res.text())
  return res.json() as Promise<T>
}
```

**Signing helper (exported, independently unit-testable):**
```typescript
// Same raw-UTF-8-key + lowercase-hex convention as cart-sig.ts signCartSig;
// the ONLY difference is the message: `${ts}.${rawBody}` instead of cartId.
// Returns BARE hex — medusaAgentFetch prepends the `v1=` scheme tag.
const encoder = new TextEncoder()
export async function signAgentBody(secret: string, ts: string, rawBody: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${ts}.${rawBody}`))
  return [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('')
}
```

### Pattern 2: Executor shape — never throw, friendly strings (mirror `get-cart.ts` / `add-to-cart.ts`)
**What:** Each executor returns a `Promise<string>`; every expected failure resolves to a friendly string (never throws into the LLM tool loop). Structure: `loadPinnedContext` → budget check → owner resolve → `medusaAgentFetch` → render → `catch` maps `MedusaRateLimitError` / `TimeoutError` / `MedusaApiError(409)` / default.

```typescript
// wishlist-add.ts (skeleton) — Source: mirrors add-to-cart.ts + get-cart.ts
export async function addWishlistItem(
  params: Record<string, unknown>, creds: MedusaCredentials, ctx: MedusaExecCtx,
): Promise<string> {
  try {
    const { sessionKey, commerce } = await loadPinnedContext(ctx)

    const owner = resolveWishlistOwner(commerce)      // Pattern 3
    if (!owner) return "Nothing's saved to a wishlist yet — browse the store or ask me to save an item and I'll start one for you."

    // R7 + R8 fail-CLOSED (contract §7) — SAME keys as cart writes so all
    // commerce writes share one session/day budget.
    const r7 = await rateLimit('com:write:' + sessionKey, 10, 60, { failMode: 'closed' })
    if (!r7.allowed) return "You're saving items too fast — give it a moment."
    const r8 = await rateLimit('com:write:day:' + (ctx.conversationId ?? sessionKey), 60, 86400, { failMode: 'closed' })
    if (!r8.allowed) return "You've reached today's save limit for this chat."

    const productId = typeof params.product_id === 'string' ? params.product_id : undefined
    if (!productId) return 'Tell me which product (name or link) you want to save.'
    const variantId = typeof params.variant_id === 'string' ? params.variant_id : undefined

    const { item } = await medusaAgentFetch<{ item: WishlistItem }>(
      creds, '/agent/wishlists/add', ctx.organizationId,
      { ...owner, product_id: productId, ...(variantId ? { variant_id: variantId } : {}) },
    )
    const title = item.product?.title ?? 'that item'
    return `Saved ${title} to your wishlist.`   // idempotent-safe wording (see Pitfall 5)
  } catch (err) {
    if (err instanceof MedusaApiError && err.status === 409) return 'Your wishlist is full (100 items max) — I couldn’t save that one.'
    if (err instanceof MedusaRateLimitError) return 'Too many store requests just now — try again in a moment.'
    if (err instanceof Error && err.name === 'TimeoutError') return 'The store took too long to respond.'
    return "I couldn’t save that to your wishlist just now."
  }
}
```
`wishlist-list.ts` takes `(creds, ctx)` (no params, like `getMedusaCart`), uses **R6** `rateLimit('com:read:' + sessionKey, 30, 60, { failMode: 'memory' })`, renders items, and returns "Your wishlist is empty." when `items.length === 0`.

### Pattern 3: Owner resolution from pinned context (anti-IDOR core)
**What:** Owner comes EXCLUSIVELY from `memory.commerce`; tool schemas contain no owner fields. Pinned keys (written by `context.ts writeCommerceContext`) are `cus` and `wishlist_ref`. Map to the Stuscle `ownerSchema` which requires **exactly one** of `customer_id` / `guest_ref` (Zod `.refine(!!customer_id !== !!guest_ref)`).

```typescript
// Returns exactly one owner key, or null when neither is pinned.
export function resolveWishlistOwner(
  commerce: Record<string, unknown>,
): { customer_id: string } | { guest_ref: string } | null {
  if (typeof commerce.cus === 'string' && commerce.cus) return { customer_id: commerce.cus }
  if (typeof commerce.wishlist_ref === 'string' && commerce.wishlist_ref) return { guest_ref: commerce.wishlist_ref }
  return null
}
```
Send exactly one key — do NOT include the other as `undefined`-that-serializes or as `null` (Stuscle's `!!a !== !!b` refine treats `null`/empty as "absent", but sending a literal `null` for the other key is harmless; sending both non-empty → 400). Cleanest is to spread only the resolved key (as above).

### Pattern 4: Budgets (contract §7) — reuse shipped `rateLimit` keys
| Tool | Budget | Key | Limit | failMode |
|------|--------|-----|-------|----------|
| list | R6 reads/session | `com:read:` + sessionKey | 30 / 60s | `memory` |
| add/remove | R7 writes/session | `com:write:` + sessionKey | 10 / 60s | `closed` |
| add/remove | R8 writes/conv/day | `com:write:day:` + (convId ?? sessionKey) | 60 / 86400s | `closed` |
| all | R11 calls/org | `medusa:org:` + orgId | 120 / 60s | `memory` (inside `medusaAgentFetch`) |

**Shared-key decision (recommended):** use the SAME `com:write:` / `com:read:` keys as the cart executors. Contract §7 defines R6/R7/R8 as *"Commerce reads/writes per session"* (not per-tool), so wishlist and cart writes should draw from one budget. This is the faithful reading; note it explicitly for the planner (alternative below in Open Questions).

### Pattern 5: Wiring (matches Phase 132/134 exactly)
1. `execute-action.ts` — move `medusa_wishlist_add/remove/list` out of the "not available yet" stub group into a real dispatch block (same never-throw guard as the cart group: `if (!ctx?.organizationId || !ctx?.supabase) return 'The store is not available right now.'` → `getMedusaCredentialsForOrg` → `if (!medusaCreds) return 'No store is connected to this workspace yet.'`). Keep `medusa_get_order_status` in the stub group (still Phase 137).
2. `run-agent.ts` `ACTION_DESCRIPTIONS` — add three keys (prompt-injection-safe framing: results are DATA).
3. `spec.ts` `NODES` — three nodes, `kind:'action'`, `integration_required:['medusa']`; params: add/remove `{ product_id, variant_id }` (NO owner), list `{}`.
4. `idempotency.ts` `SIDE_EFFECTING_ACTIONS` — add `medusa_wishlist_add`, `medusa_wishlist_remove` (NOT list).

### Anti-Patterns to Avoid
- **Signing a re-stringified body.** Never `JSON.stringify` the body a second time inside the fetch call — sign and send the identical string.
- **Owner params in tool schemas.** `spec.ts` add/remove params are `product_id`/`variant_id` only. The LLM must never supply `customer_id`/`guest_ref`.
- **Throwing into the tool loop.** Every failure path returns a friendly string, exactly like the shipped cart executors.
- **Claiming "already saved".** The Stuscle add route returns `{ item }` with no created/existing flag (idempotency is in-service). Do not assert duplicate-vs-new (Pitfall 5).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| HMAC signing | manual byte fiddling / a new key convention | `crypto.subtle` with raw-UTF-8 key, exactly as `cart-sig.ts` | Byte agreement with Stuscle is proven only for this convention (no hex-decode of token, no `xph_` strip) |
| Rate limiting | new counters | `rateLimit(...)` with the documented keys/failModes | R6/R7/R8/R11 semantics + fail-closed already shipped |
| Idempotency | per-executor dedup | `SIDE_EFFECTING_ACTIONS` + run-agent's `checkIdempotency`/`recordIdempotency` | The tool loop already caches by `sha256(invocationId:index)`; Stuscle add/remove are ALSO idempotent in-service |
| Owner lookup | new DB query | `loadPinnedContext` (single `conversations` read) | Returns sessionKey + commerce in one lookup; readers already established |
| Region resolution | — | not needed | Wishlist routes take no region; skip `resolveRegionId` entirely |

**Key insight:** Nothing in this phase is novel infrastructure — it is a fourth consumer of Phases 131–134's primitives. The only new surface is the `ts + "." + rawBody` message shape, and its correctness is a byte-comparison problem, not a design problem.

## Common Pitfalls

### Pitfall 1: Signed-message byte drift (SECURITY CRITICAL)
**What goes wrong:** 401 on every call, or worse, silent mismatch. Stuscle recomputes over `req.rawBody` (UTF-8) as `${ts}.${rawStr}`.
**Why it happens:** stringifying the body twice (different key order/whitespace), signing a `ts` different from the header value, or prepending/omitting the `v1=` tag inconsistently.
**How to avoid:** stringify once → keep the string → sign `ts + "." + string` → send the string; put `String(ts)` in the header; header value is `v1=` + bare hex. Confirmed against Stuscle `verify-hmac.ts` (line 26: `"v1=" + createHmac("sha256", secret).update(`${ts}.${rawStr}`).digest("hex")`) and `sign-xphere.ts`.
**Warning signs:** intermittent 401; tests pass in isolation but the E2E round trip fails.

### Pitfall 2: `v1=` scheme tag placement
**What goes wrong:** double `v1=` or missing tag → length-guarded `timingSafeEqual` returns 401.
**How to avoid:** `signAgentBody` returns BARE hex; `medusaAgentFetch` is the ONLY place that writes `v1=${sig}`. The vector test asserts bare hex; an integration/E2E asserts the header.

### Pitfall 3: "Exactly one" owner key
**What goes wrong:** 400 `invalid_body`. Stuscle `ownerSchema.refine(b => !!b.customer_id !== !!b.guest_ref)` rejects zero or two owner keys.
**How to avoid:** `resolveWishlistOwner` returns exactly one key or `null`; spread only the resolved key. When it returns `null`, DO NOT call the store — return the "nothing saved yet" string.

### Pitfall 4: R11 budget must run BEFORE the fetch, on the shared org key
**What goes wrong:** wishlist calls bypass the org rate cap, or use a different key and double-count.
**How to avoid:** `medusaAgentFetch` calls `rateLimit('medusa:org:'+orgId, 120, 60, {failMode:'memory'})` first, identical to `medusaStoreFetch` — one shared R11 bucket per org.

### Pitfall 5: Cannot distinguish "already saved" vs "newly saved" / "was removed" vs "wasn't there"
**What goes wrong:** the CONTEXT "Specific Idea" of reflecting "already saved" vs "saved" is not supported by the actual Stuscle responses. `add` route returns `{ item }` (no created/existing flag; dedup is silent in `service.addItem`). `remove` returns `{ removed: true }` even when nothing matched.
**How to avoid:** use idempotent-safe wording: "Saved {title} to your wishlist." / "Removed that from your wishlist." Treat this as the locked reality; the discretion is only over exact phrasing.
**Warning signs:** a plan task that inspects a non-existent `existing`/`created` field.

### Pitfall 6: 409 mapping requires status on the error
**What goes wrong:** `wishlist_full` surfaces as a generic error string.
**How to avoid:** `medusaAgentFetch` throws `MedusaApiError(res.status, body)` on non-2xx (same as `medusaStoreFetch`); the add executor branches on `err instanceof MedusaApiError && err.status === 409`. Stuscle add route returns `409 {"error":"wishlist_full"}` (`WishlistFullError`, cap `MAX_WISHLIST_ITEMS = 100`).

### Pitfall 7: 401 = config/clock, not a user problem
**What goes wrong:** a genuine signing/skew/secret-unset failure (Stuscle `verify-hmac` returns uniform 401) gets a misleading user string.
**How to avoid:** map 401 to the neutral "I couldn’t reach the store just now." and log it (dev signal: check `XPHERE_CONNECTION_TOKEN` match + clock skew < 300s). Do not tell the user their wishlist failed for a reason implying their input.

## Code Examples

### Committed cross-repo signing vectors (put in `tests/medusa-wishlist.test.ts`)
Computed here with Node `createHmac` AND verified byte-identical with `crypto.subtle.sign` (raw-UTF-8 key). These are the exact values Stuscle's `sign-xphere.ts` produces for the same inputs.

```
// signAgentBody returns BARE hex (no v1= prefix). Header value = "v1=" + hex.

// VECTOR 1 (CONTEXT-mandated): secret="test-secret" ts="1750000000" body={"a":1}
rawBody      = '{"a":1}'
signAgentBody= '1f11cf9a5d34d98061ca60891c660610b83d4a229b90d9c84c4f47fd5bff50c4'
header value = 'v1=1f11cf9a5d34d98061ca60891c660610b83d4a229b90d9c84c4f47fd5bff50c4'

// VECTOR 2 (realistic add, reuses the established cross-repo secret):
// secret="xph_test_connection_token_abc123" ts="1750000000"
rawBody      = '{"customer_id":"cus_01ABC","product_id":"prod_01XYZ"}'
signAgentBody= 'f5817eb8b59e51a70825b9961d87899bfce8f74b043265d083b00cd5bdcf5474'

// VECTOR 3 (guest add with variant): same secret + ts
rawBody      = '{"guest_ref":"wl-ref-uuid-1","product_id":"prod_01XYZ","variant_id":"variant_01A"}'
signAgentBody= '960612a42f3fc98b6040abd815def3c717f26b8558f9d920e6c97d3a52c66742'
```
**Recommendation:** commit VECTOR 1 in xphere's unit test AND recommend Stuscle add the same literal assertion in a `verify-hmac`/`sign-xphere` unit test (Stuscle currently has only integration-level coverage in `integration-tests/http/agent-wishlists.spec.ts`, which is Docker-gated/E2E-deferred). A shared literal is the cheapest guard against future drift in either repo.

### Stuscle contract shapes (confirmed by reading route.ts)
```jsonc
// POST /agent/wishlists/list  body: { customer_id } | { guest_ref }  (exactly one)
{ "wishlist": { "id": "...", "items": [
  { "id":"...", "product_id":"...", "variant_id": "..."|null,
    "product": { "title":"...", "handle":"...", "thumbnail":"..." } | null } ] } }

// POST /agent/wishlists/add  body: owner + { product_id, variant_id? }
{ "item": { "id":"...", "product_id":"...", "variant_id":"..."|null,
            "product": { "title", "handle", "thumbnail" } | null } }   // 200; 409 {"error":"wishlist_full"}

// POST /agent/wishlists/remove  body: owner + { product_id, variant_id? }
{ "removed": true }   // 200 even when nothing matched (idempotent)
```

### List rendering (executor)
```typescript
const { wishlist } = await medusaAgentFetch<{ wishlist: { items: WishlistItem[] } }>(
  creds, '/agent/wishlists/list', ctx.organizationId, owner)
const items = wishlist.items ?? []
if (items.length === 0) return 'Your wishlist is empty.'
const lines = items.map((i) => i.product?.title ?? i.product_id)   // optional: append variant / handle
return `Your wishlist:\n${lines.join('\n')}`
// Discretion: if creds.storefrontUrl is set, a `/{country}/products/{handle}` URL may be appended.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `medusa_wishlist_*` stubbed → "not available yet" (execute-action.ts L501-505) | real dispatch to executors | this phase | remove wishlist cases from the stub group; leave `medusa_get_order_status` |
| store-only client (`medusaStoreFetch`, publishable-key header) | + `medusaAgentFetch` (HMAC-signed, connection-token) | this phase | `client.ts` header comment already anticipates this ("Phase 135 uses a different signing scheme") |

**Deprecated/outdated:** none. The `connectionToken` field on `MedusaCredentials` was added in Phase 132 "used in Phase 135" — now consumed.

## Open Questions

1. **Do wishlist writes count toward the per-turn cap (`COMMERCE_WRITE_ACTIONS` / `checkCommerceWritesPerTurn`, 3/turn) and the 25/conversation `bumpConversationWriteCount`?**
   - What we know: CONTEXT locks only "R7/R8 + `SIDE_EFFECTING_ACTIONS`". The per-turn cap and 25/conversation cap are CRT-02 cart guardrails, not mentioned for WSL.
   - What's unclear: whether wishlist saves should share those caps.
   - Recommendation: FOLLOW CONTEXT — add wishlist add/remove to `SIDE_EFFECTING_ACTIONS` only; do NOT add to `COMMERCE_WRITE_ACTIONS` and do NOT call `bumpConversationWriteCount`. R7/R8 (shared session/day keys) already bound write volume. If the planner wants defense-in-depth, adding to `COMMERCE_WRITE_ACTIONS` is a one-line change but expands locked scope — flag before doing it.

2. **Shared vs separate R6/R7/R8 keys with cart executors.**
   - Recommendation: SHARED (contract §7 is per-session, tool-agnostic). Documented in Pattern 4. Alternative (separate `com:write:wishlist:` keys) would let a burst of cart writes not starve wishlist saves, but diverges from the contract wording — not recommended without a contract note.

3. **Signing helper location** (`cart-sig.ts` extension vs new `agent-sig.ts`) — cosmetic; either is fine. Prefer a dedicated exported `signAgentBody` so the vector test targets it directly.

4. **List URL enrichment** (CONTEXT discretion) — requires `creds.storefrontUrl` (+ country code from `commerce.country_code`). Nice-to-have; safe to defer or gate on presence.

## Environment Availability

The xphere-side deliverable (client + executors + wiring + unit tests) is **pure code/config** and Docker-free. External dependencies apply only to the deferred E2E round trip.

| Dependency | Required By | Available (xphere unit work) | Version | Fallback |
|------------|------------|------------------------------|---------|----------|
| Node `crypto.subtle` | signing | ✓ (global) | Node ≥ 20 | — |
| vitest | unit tests | ✓ | 4.1.2 | — |
| Running Stuscle backend (:9000) + `/agent/*` routes | E2E round trip | n/a for this phase's tests | — | Mock `medusaAgentFetch`/fetch in unit tests |
| Postgres + Docker + `XPHERE_CONNECTION_TOKEN` in `.env.test` | Stuscle integration spec (`agent-wishlists.spec.ts`) | ✗ (E2E-deferred, Stuscle side) | — | Deferred to the cross-repo E2E gate; xphere unit tests mock the transport |

**Missing dependencies with no fallback:** none for this phase's scope.
**Missing dependencies with fallback:** the live Stuscle `/agent` round trip — covered by mocking the fetch/`medusaAgentFetch` in unit tests; real round trip is the shared E2E gate (both repos have the specs authored: Stuscle `integration-tests/http/agent-wishlists.spec.ts`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | `vitest.config.ts` (include `tests/**/*.test.ts`, env `node`, alias `@`→`src`) |
| Quick run command | `npx vitest run tests/medusa-wishlist.test.ts` |
| Full suite command | `npm test` (i.e. `vitest run`) — **NOTE: ~58 pre-existing failures unrelated to this phase; scope to touched files** |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WSL-02 | `signAgentBody` matches committed vector (bare hex) | unit | `npx vitest run tests/medusa-wishlist.test.ts -t "signing vector"` | ❌ Wave 0 |
| WSL-01/02 | `medusaAgentFetch` sends `X-Xphere-Timestamp`/`X-Xphere-Signature: v1=…`, signs the exact sent bytes, POST, R11 before fetch | unit (mock fetch) | `npx vitest run tests/medusa-wishlist.test.ts -t "medusaAgentFetch"` | ❌ Wave 0 |
| WSL-01 | owner = `cus` else `wishlist_ref` else null; exactly one key in body | unit | `npx vitest run tests/medusa-wishlist.test.ts -t "owner"` | ❌ Wave 0 |
| WSL-01 | add/remove/list executors: happy path, no-owner "nothing saved" string, 409 full, idempotent-safe wording, never-throw | unit (mock `medusaAgentFetch` + pinned ctx) | `npx vitest run tests/medusa-wishlist.test.ts` | ❌ Wave 0 |
| WSL-02 | add/remove R7/R8 fail-closed (no call on deny); list R6 memory | unit (mock `rateLimit`) | `npx vitest run tests/medusa-wishlist.test.ts -t "R7\|R8\|R6"` | ❌ Wave 0 |
| WSL-01 | dispatch: `execute-action` routes 3 wishlist actions; friendly strings on missing ctx/creds | unit | `npx vitest run tests/medusa-dispatch.test.ts` | ⚠️ extend existing |
| WSL-01 | wiring: `ACTION_DESCRIPTIONS` + `spec.ts` NODES include 3 wishlist keys; `SIDE_EFFECTING_ACTIONS` has add/remove | unit (source-text + import) | `npx vitest run tests/medusa-wiring.test.ts tests/medusa-spec.test.ts` | ⚠️ extend existing |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/medusa-wishlist.test.ts` (+ the specific existing test file a task edits).
- **Per wave merge:** run all touched medusa specs: `npx vitest run tests/medusa-wishlist.test.ts tests/medusa-dispatch.test.ts tests/medusa-wiring.test.ts tests/medusa-spec.test.ts`.
- **Phase gate:** the touched-file set green before `/gsd:verify-work`. Do NOT gate on full `npm test` (pre-existing failures); optionally record `npx tsc --noEmit` clean for the new files.

### Wave 0 Gaps
- [ ] `tests/medusa-wishlist.test.ts` — signing vector + `medusaAgentFetch` (mock fetch) + owner resolution + 3 executors (mock `medusaAgentFetch` + Supabase pinned-context stub, `mockRateLimit`). Model on `tests/medusa-cart-write.test.ts` (same `buildSupabase`, `mockMedusaStoreFetch`, `mockRateLimit` idioms).
- [ ] Extend `tests/medusa-dispatch.test.ts` — add SENTINEL routing tests for `medusa_wishlist_add/remove/list` (mirror the cart-write dispatch tests) and drop them from the "not available yet" assertion.
- [ ] Extend `tests/medusa-wiring.test.ts` — `ACTION_DESCRIPTIONS` contains the 3 wishlist keys.
- [ ] Extend `tests/medusa-spec.test.ts` — NODES contain the 3 wishlist nodes with `integration_required:['medusa']` and no owner params.
- [ ] Assert `SIDE_EFFECTING_ACTIONS.has('medusa_wishlist_add'/'medusa_wishlist_remove')` (in the wishlist test or the idempotency test).
- Framework install: none (vitest present).

## Sources

### Primary (HIGH confidence — read directly)
- xphere: `src/lib/medusa/{client,cart-sig,context,credentials,pinned-context,format}.ts`, `actions/{get-cart,get-product,add-to-cart,update-cart-item}.ts`
- xphere: `src/lib/action-engine/execute-action.ts`, `src/lib/agent-runtime/{run-agent,idempotency}.ts`, `src/lib/workflows/spec.ts`, `src/lib/rate-limit.ts`
- xphere tests: `tests/medusa-{cart-write,context,dispatch,wiring}.test.ts`, `vitest.config.ts`, `.planning/config.json`
- Stuscle: `apps/backend/src/api/agent/_utils/{verify-hmac,schemas}.ts`, `wishlists/{add,list,remove}/route.ts`, `src/api/middlewares.ts`, `src/modules/wishlist/service.ts`, `integration-tests/utils/sign-xphere.ts`, `integration-tests/http/agent-wishlists.spec.ts`
- Contract: `.planning/research/INTEGRATION-CONTRACT.md` §2/§3/§4.2/§7 (FROZEN v1.1)
- CONTEXT: `135-CONTEXT.md`; REQUIREMENTS `WSL-01/WSL-02`

### Verified by computation
- `signAgentBody` vectors computed with Node `createHmac` AND cross-checked byte-identical against `crypto.subtle.sign` (raw-UTF-8 key) for message `ts + "." + rawBody` — matching Stuscle `sign-xphere.ts` / `verify-hmac.ts`.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all primitives shipped and read.
- Architecture: HIGH — executor/wiring patterns are a 4th copy of Phases 132–134; both repos' contract surfaces read directly.
- Signing/byte-agreement: HIGH — reference signer read on the Stuscle side and reproduced by computation on both Node and Web Crypto paths.
- Pitfalls: HIGH — each derived from actual code (Stuscle refine, idempotent responses, 409 shape, verify-hmac message).

**Research date:** 2026-07-17
**Valid until:** 2026-08-16 (stable — gated by the FROZEN contract; revisit only if the contract §4.2 or Stuscle `verify-hmac.ts` changes).

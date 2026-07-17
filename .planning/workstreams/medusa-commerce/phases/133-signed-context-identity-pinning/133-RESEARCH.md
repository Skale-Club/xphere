# Phase 133: Signed Context & Identity Pinning - Research

**Researched:** 2026-07-17
**Domain:** HMAC token verification (anti-IDOR identity binding), JSONB pinning, embeddable widget token forwarding
**Confidence:** HIGH (every recommendation is grounded in existing, shipped xphere code + the FROZEN contract §3)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Verification (`src/lib/medusa/context.ts`)**
- `verifyCommerceContext(token, secret): Claims | null` — split on ".", recompute `HMAC_SHA256(secret, payloadB64)` with `crypto.timingSafeEqual` (Web Crypto or node:crypto — match repo convention in `src/lib/crypto.ts` which is Web Crypto/Edge-safe; the chat route runs nodejs runtime, node:crypto acceptable), check `exp > now`, parse claims `{v, org, cart, cus, email, wishlist_ref, country_code, region_id, iat, exp}`.
- Org binding: caller passes the org resolved from the widget token; claims.org must equal it (cross-org replay barrier).
- Secret = decrypted medusa `integrations.encrypted_api_key` for the org (`getMedusaCredentialsForOrg` from Phase 132).

**Pinning (`src/lib/medusa/context.ts` read/write helpers)**
- `writeCommerceContext(supabase, conversationId, claims)`: merge into `conversations.memory.commerce` = `{cart_id, customer_id, email, wishlist_ref, country_code, region_id, verified_at}`. Merge, don't clobber other `memory` keys.
- `readCommerceContext(supabase, conversationId)` for executors.
- Re-pin rules: a NEW verified token may change cart_id/customer_id (legit rotation post-checkout/login) — log `[commerce-ctx] repinned` with old→new. NEVER write from message text or model output. If an incoming verified token's cart differs from pinned without rotation semantics, overwrite (it IS a fresh verified token) — verified tokens are the sole authority.

**Chat route changes**
- `ChatRequestSchema += commerce_context: z.string().max(2048).optional()`.
- After org resolution + session ensure (needs the conversation row id): if `commerce_context` present → load medusa creds → verify → write pinned context. ALL failure paths fail-soft: log warn, continue chat without commerce context. No extra DB round trips when the token is absent (org without medusa integration pays nothing).

**Widget (`src/widget/index.ts` — then `npm run build:widget`)**
- Capture `data-context-endpoint` from `document.currentScript` at load (sync, like the token capture).
- Lazy fetch: before sending a message, if no cached token or cached `exp` passed (decode payload locally to read exp — no verification client-side), `fetch(contextEndpoint, {credentials:'same-origin'})` → `{token}` → cache. Failure → send message without context (never block chat).
- Include `commerce_context` in the POST body when available; re-fetch after receiving a `commerce` SSE event with `action:'cart_created'` (cart cookie changed server-side — Phase 134 emits it; guard by event name string now).
- Public API: `Opps.setContext(token: string)` replaces the cached token.
- Widget has no test harness — keep changes minimal and manually verifiable via `public/widget-test.html`.

### Claude's Discretion
- Exact log wording; whether claims get a zod schema (recommended) in context.ts; unit-test organization (vitest: valid/expired/bad-sig/wrong-org/malformed + pinning merge semantics with mocked supabase).

### Deferred Ideas (OUT OF SCOPE)
- Rich context UI in the dashboard (show "visitor has cart X") — later milestone.

### Specific Ideas (from CONTEXT.md)
- Token claims parse must be tolerant of nulls (cart/cus/email/wishlist_ref can each be null per contract §3).
- Store `verified_at` (ISO) in memory.commerce so later phases can log token freshness.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CTX-01 | `verifyCommerceContext` — HMAC timing-safe + exp + org check per contract §3, fail-soft on invalid | `src/lib/email/unsubscribe-token.ts` is the **exact** `base64url(payload).base64url(sig)` format already shipped in this repo — copy its structure; only the HMAC key source changes (see Pitfall 2). `crypto.subtle.verify` gives constant-time compare for free. |
| CTX-02 | Chat route accepts `commerce_context` (≤2048), merges verified claims into `conversations.memory.commerce`; re-pin only from newly verified token | Insertion point is after `createNewSession`/session-resume (line ~179 of the chat route; `ctx.dbSessionId` = conversation row id). `org.id` (line 108-116) is the org-claim to match. JSONB read-merge-write pattern is established at `src/app/(dashboard)/contacts/actions.ts:1298`. |
| CTX-03 | Widget fetches token from `data-context-endpoint` (cache until exp), sends on every POST, exposes `Opps.setContext`; widget rebuilt | Capture pattern mirrors `_token`/`_apiBase` at `src/widget/index.ts:473`. POST body built in `sendMessage` at line 626. `window.Opps` API at line 1070. Build: `npm run build:widget` → commit `public/widget.js`. |
</phase_requirements>

## Summary

This phase is almost entirely **wiring together primitives that already exist in the xphere repo**, not building anything novel. The token format specified by FROZEN contract §3 — `base64url(payloadJson) + "." + base64url(HMAC_SHA256(secret, base64url(payloadJson)))` — is **byte-for-byte identical** to the token already shipped in `src/lib/email/unsubscribe-token.ts`. That file is the canonical pattern to copy for `verifyCommerceContext`. The chat route (Phase 131-hardened) already resolves the org and the conversation row id in scope; the JSONB read-merge-write pattern for `memory` is established in the contacts server action. Phase 132 already shipped `getMedusaCredentialsForOrg` (the HMAC secret source), `loadPinnedContext` (the reader), and the vitest mock idioms for both.

There are **two critical byte/key-level agreement risks** that must be nailed or the whole IDOR barrier silently no-ops: (1) the HMAC key is the raw **UTF-8 bytes of the `xph_...` connection-token string**, NOT a hex-decoded 32-byte key — unlike `crypto.ts`/`unsubscribe-token.ts` which hex-decode `ENCRYPTION_SECRET`; and (2) a **naming mismatch between what CONTEXT.md says to write (`cart_id`) and what the already-shipped Phase 132 executor reads (`commerce.cart`)** — if unreconciled, the pinned cart never reaches `medusa_get_cart` and the visitor's cart appears "not connected." Both are surfaced below with concrete recommendations.

The widget change is small but has a subtle trap: `data-context-endpoint` is a **storefront-relative path** (`/api/chat-context`) that must be fetched against the **host page origin (the storefront), not xphere's `apiBase`** — the storefront mints the token by reading its own httpOnly cookies. Never prefix it with `apiBase`.

**Primary recommendation:** Create `src/lib/medusa/context.ts` by cloning the `unsubscribe-token.ts` verify structure with two changes — the HMAC key = `new TextEncoder().encode(connectionToken)` (raw string bytes) and post-verify claim/exp/org checks. Pin using the **key names the Phase 132 executors already read** (`cart`, `region_id`, `country_code`) plus forward-looking `customer_id`/`email`/`wishlist_ref`/`verified_at`. Thread `data-context-endpoint` through the widget, fetch same-origin against the page, and add `commerce_context` to the POST body only when a token is available.

## Standard Stack

No new dependencies. Everything needed is already installed and idiomatic in-repo.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Web Crypto (`crypto.subtle`) | platform (Node ≥20 / Edge) | HMAC-SHA256 sign/verify, constant-time compare via `subtle.verify` | Repo convention: `src/lib/crypto.ts`, `src/lib/email/unsubscribe-token.ts`, `src/lib/notion/webhook.ts` all use Web Crypto; Edge-safe and identical output to node's `createHmac` |
| `node:crypto` (`createHmac`, `timingSafeEqual`) | Node ≥20 | Acceptable alternative (chat route is `runtime = 'nodejs'`) | Already used in `src/lib/twilio/webhook-signature.ts`, `src/lib/vapi/verify-signature.ts` |
| `zod` | 3.25.76 (installed) | `ChatRequestSchema` extension; optional `ClaimsSchema` | Already used across the repo; the chat route already imports it |
| `vitest` | 4.1.2 (installed) | Unit tests for verify + pinning | The repo's only test runner (`npm test` → `vitest run`) |
| `esbuild` | 0.28.0 (installed, devDep) | Widget bundle (`npm run build:widget`) | Existing build step; output committed to `public/widget.js` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@supabase/supabase-js` | 2.101.1 (installed) | Service-role client for the `memory` read-merge-write | The chat route already has `createServiceRoleClient()` in scope (line 107) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `crypto.subtle.verify` (Web Crypto, constant-time built in) | `node:crypto` `createHmac` + `timingSafeEqual` | Both produce identical HMAC bytes. `subtle.verify` handles length-mismatch + timing safety in one call and matches the in-repo `unsubscribe-token.ts` precedent; `timingSafeEqual` **throws on unequal buffer length** so you must length-guard first. Recommend `subtle.verify`. |
| A JWT library | Hand-verified compact HMAC blob | Contract §3 explicitly says "no JWT lib". The blob is deliberately not a JWT. Do not add `jose`/`jsonwebtoken`. |

**Installation:** None required.

**Version verification:** All packages above are already pinned in `package.json` (verified 2026-07-17). No `npm view` needed — no new installs.

## Architecture Patterns

### Recommended file layout
```
src/lib/medusa/
├── context.ts        # NEW — verifyCommerceContext + writeCommerceContext + readCommerceContext + ClaimsSchema
├── credentials.ts    # Phase 132 — getMedusaCredentialsForOrg (HMAC secret source)
├── pinned-context.ts # Phase 132 — loadPinnedContext (reader used by executors; reads commerce.cart)
├── client.ts         # Phase 132 — MedusaCredentials, MedusaExecCtx types
└── actions/          # Phase 132 executors that CONSUME the pinned shape
src/app/api/chat/[token]/route.ts  # extend ChatRequestSchema + verify/pin block
src/widget/index.ts                # capture data-context-endpoint + lazy fetch + Opps.setContext
tests/medusa-context.test.ts       # NEW — verify + pinning unit tests (follows tests/medusa-*.test.ts convention)
```

### Pattern 1: HMAC token verify (clone of the shipped `unsubscribe-token.ts`)
**What:** Split on `.`, recompute HMAC over the base64url payload **string** (ASCII bytes), constant-time compare, then decode+parse+validate claims.
**When to use:** `verifyCommerceContext`.
**Byte-agreement contract:** stuscle mints with `token = base64url(payloadJson) + "." + base64url(createHmac('sha256', SECRET).update(base64url(payloadJson)).digest())`. The three things that MUST match xphere's verify:
1. HMAC is computed over the **base64url payload string** (`.update(base64url(payloadJson))`), not the decoded JSON. `unsubscribe-token.ts` already does `encoder.encode(payloadB64)` — correct.
2. Node's `createHmac('sha256', SECRET)` with a **string** key uses that string's **UTF-8 bytes** as the key. So xphere must `importKey('raw', new TextEncoder().encode(connectionToken), …)` — NOT hex-decode. (See Pitfall 2.)
3. `.digest()` (no encoding) → raw 32 bytes → base64url. Web Crypto `subtle.sign`/`subtle.verify` operate on the same raw bytes. Match.

**Example:**
```typescript
// src/lib/medusa/context.ts
// Source: mirrors src/lib/email/unsubscribe-token.ts (shipped) + contract §3.
const encoder = new TextEncoder()

function b64urlDecode(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4))
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad)
  return Uint8Array.from(bin, (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>
}

// CRITICAL: key = raw UTF-8 bytes of the xph_... connection token, NOT hex-decoded.
async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),                       // matches node createHmac('sha256', secret)
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
}

export interface CommerceClaims {
  v: number
  org: string
  cart: string | null
  cus: string | null
  email: string | null
  wishlist_ref: string | null
  country_code: string
  region_id: string | null
  iat: number
  exp: number
}

export async function verifyCommerceContext(
  token: string,
  secret: string,
  expectedOrg: string,
): Promise<CommerceClaims | null> {
  try {
    const dot = token.indexOf('.')
    if (dot === -1) return null
    const payloadB64 = token.slice(0, dot)
    const sigB64 = token.slice(dot + 1)
    const key = await hmacKey(secret)
    // subtle.verify recomputes HMAC over payloadB64 bytes and compares in constant time.
    const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), encoder.encode(payloadB64))
    if (!ok) return null
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64))) as CommerceClaims
    if (claims.v !== 1) return null
    if (typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) return null  // exp is UNIX SECONDS
    if (claims.org !== expectedOrg) return null                                                     // cross-org replay barrier
    return claims
  } catch {
    return null  // malformed base64/JSON → treat as invalid (fail-soft)
  }
}
```
> A zod `ClaimsSchema.safeParse` after decode is recommended (Claude's discretion) to harden null-tolerance and reject malformed shapes cleanly.

### Pattern 2: Pinning — JSONB read-merge-write (established repo pattern)
**What:** Read current `memory`, spread-merge a fresh `commerce` sub-object, write the whole `memory` back. PostgREST has no clean `jsonb_set` for non-existent paths (documented at `contacts/actions.ts:1298`).
**When to use:** `writeCommerceContext`.
**Example:**
```typescript
// src/lib/medusa/context.ts — pinning writer
export async function writeCommerceContext(
  supabase: SupabaseClient,
  conversationId: string,
  orgId: string,
  claims: CommerceClaims,
): Promise<{ repinnedFrom?: string } | null> {
  const { data: row } = await supabase
    .from('conversations')
    .select('memory')
    .eq('id', conversationId)
    .eq('org_id', orgId)
    .maybeSingle()
  const memory = (row?.memory as Record<string, unknown> | null) ?? {}
  const prev = (memory.commerce as Record<string, unknown> | undefined) ?? {}

  const commerce = {
    cart: claims.cart,                 // ⚠ see Pitfall 1 — key MUST match what executors read
    customer_id: claims.cus,
    email: claims.email,
    wishlist_ref: claims.wishlist_ref,
    country_code: claims.country_code,
    region_id: claims.region_id,
    verified_at: new Date().toISOString(),
  }
  const nextMemory = { ...memory, commerce }   // preserves every other memory key

  await supabase.from('conversations').update({ memory: nextMemory }).eq('id', conversationId).eq('org_id', orgId)
  const oldCart = typeof prev.cart === 'string' ? prev.cart : undefined
  return oldCart && oldCart !== claims.cart ? { repinnedFrom: oldCart } : null
}
```

### Pattern 3: Chat route insertion point
**What:** Verify + pin sits **after** the session block (conversation id known) and **before** `runAgent`.
**Where exactly:** In `src/app/api/chat/[token]/route.ts`, after line ~179 (`;({ ctx, sessionId } = await createNewSession(org.id))`) and before line 196 (`runAgent`). At that point `org.id` (the expected org), `supabase` (service-role, line 107), and `ctx.dbSessionId` (the conversation row id) are all in scope.
**Fail-soft + zero-cost-when-absent:**
```typescript
// after ctx/sessionId are settled, before runAgent
const { commerce_context } = parsed.data
if (commerce_context) {
  try {
    const creds = await getMedusaCredentialsForOrg(org.id, supabase)   // null if org has no medusa integration
    if (creds) {
      const claims = await verifyCommerceContext(commerce_context, creds.connectionToken, org.id)
      if (claims) {
        const repin = await writeCommerceContext(supabase, ctx.dbSessionId, org.id, claims)
        if (repin?.repinnedFrom) log.info('commerce_ctx_repinned', { from: repin.repinnedFrom, to: claims.cart })
      } else {
        log.warn('commerce_ctx_invalid', { orgId: org.id })
      }
    }
  } catch (err) {
    log.warn('commerce_ctx_error', { error: err, orgId: org.id })  // never throw — chat must continue
  }
}
```
> Add `commerce_context: z.string().max(2048).optional()` to `ChatRequestSchema` (line 34) and destructure it (line 84). When absent, the whole block is skipped — an org without a medusa integration pays **zero** extra DB round trips.

### Pattern 4: Widget threading
**What:** Capture the endpoint synchronously, thread it through init → panel → send, cache the token, decode-only for exp locally.
**Captures (near line 473-475):**
```typescript
const _script = document.currentScript as HTMLScriptElement | null
const _token = _script?.dataset.token ?? ''
const _apiBase = _script?.src ? new URL(_script.src).origin : location.origin
const _contextEndpoint = _script?.dataset.contextEndpoint ?? ''   // NEW — data-context-endpoint
// initWidget(_token, _apiBase, _contextEndpoint)
```
**Lazy fetch + local exp decode (no client-side HMAC verify):**
```typescript
let cachedToken: string | null = null
let cachedExp = 0   // unix seconds

function b64urlToJson(b64: string): { exp?: number } | null {
  try {
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4))
    return JSON.parse(atob(b64.replace(/-/g, '+').replace(/_/g, '/') + pad))
  } catch { return null }
}

async function ensureContext(): Promise<string | null> {
  if (!_contextEndpoint) return null
  const now = Math.floor(Date.now() / 1000)
  if (cachedToken && cachedExp > now + 5) return cachedToken   // small skew buffer
  try {
    // NOTE: fetch against the PAGE origin (storefront) — do NOT prefix apiBase. See Pitfall 3.
    const res = await fetch(_contextEndpoint, { credentials: 'same-origin' })
    if (!res.ok) return null
    const { token } = await res.json() as { token?: string }
    if (!token) return null
    const payload = b64urlToJson(token.split('.')[0] ?? '')
    cachedToken = token
    cachedExp = typeof payload?.exp === 'number' ? payload.exp : now + 60
    return cachedToken
  } catch { return null }   // never block chat
}
```
**POST body (in `sendMessage`, line 626) — conditional only:**
```typescript
body: JSON.stringify({
  message, pageUrl: location.href,
  ...(sessionId ? { sessionId } : {}),
  ...(commerceContext ? { commerce_context: commerceContext } : {}),   // omit when absent (see Pitfall 5)
}),
```
**`Opps.setContext` + re-fetch on SSE:** expose a `setContext(token)` from `buildPanel`'s return object that sets `cachedToken`/`cachedExp` (decode exp locally); wire `Opps.setContext` (near line 1070) to it. In the `submitMessage` `onEvent` handler (line 792), add:
```typescript
} else if (evt.event === 'commerce' && evt.action === 'cart_created') {
  cachedToken = null; cachedExp = 0   // force re-fetch on next send (Phase 134 emits this event)
}
```
Extend the `SSEEvent` interface (line 571) with optional `action?: string` (and `cartId?: string` if you re-dispatch later — CRT-04, a different phase).

### Anti-Patterns to Avoid
- **Hex-decoding the connection token as the HMAC key.** It is an opaque `xph_...` string used as UTF-8 key bytes by stuscle. (Pitfall 2)
- **Writing `commerce.cart_id` while executors read `commerce.cart`.** (Pitfall 1)
- **Prefixing `data-context-endpoint` with `apiBase`.** It's fetched from the storefront, same-origin. (Pitfall 3)
- **Always adding `commerce_context` to the POST body.** Keep it conditional — an always-on field breaks the exact-body assertion in the existing `tests/widget.test.ts`. (Pitfall 5)
- **Trusting the token client-side.** The widget only decodes the payload to read `exp`; it never verifies the HMAC and never reads `cus`/`email` from it.
- **Re-pinning from message text or model output.** Only a freshly VERIFIED token may change the pin.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| base64url encode/decode | A new helper with padding bugs | Copy the exact `b64urlEncode`/`b64urlDecode` from `src/lib/email/unsubscribe-token.ts` | Padding + `+//-_` translation is where cross-repo byte mismatches hide |
| Constant-time HMAC compare | A hand-rolled loop | `crypto.subtle.verify` (constant-time, no length-throw) | `unsubscribe-token.ts` precedent; `timingSafeEqual` throws on length mismatch and needs a guard |
| Token format | A JWT or a new scheme | The `payload.sig` blob per contract §3 (already in `unsubscribe-token.ts`) | Contract is FROZEN and cross-repo; any deviation breaks stuscle's minted tokens |
| JSONB partial update | `jsonb_set` via PostgREST | Read-merge-write (`{...memory, commerce}`) | Documented at `contacts/actions.ts:1298` — no clean PostgREST `jsonb_set` for missing paths |
| Loading org creds | A new query | `getMedusaCredentialsForOrg(org.id, supabase)` (Phase 132) | Already returns the decrypted `connectionToken` = the HMAC secret |

**Key insight:** This phase should feel like *assembly*, not invention. The single most valuable thing the plan can do is force byte-for-byte reuse of `unsubscribe-token.ts` so the HMAC agrees with stuscle's `node:crypto` mint.

## Common Pitfalls

### Pitfall 1: `cart_id` (CONTEXT.md) vs `cart` (shipped executor) — the pin silently no-ops  ⚠ CRITICAL
**What goes wrong:** CONTEXT.md says write `memory.commerce = {cart_id, ...}`. But the **already-shipped** Phase 132 executor reads the cart under a **different key**:
- `src/lib/medusa/actions/get-cart.ts:33` → `commerce.cart` (the cart id)
- `src/lib/medusa/actions/search-products.ts:41` and `get-product.ts:54` → `commerce.region_id`, `commerce.country_code`

`region_id` and `country_code` already agree. But if `writeCommerceContext` writes `cart_id`, `get-cart.ts` reads `commerce.cart` → `undefined` → tells the visitor "No cart is connected to this chat yet." The entire IDOR-binding goal of the phase would compile, pass its own isolated unit tests, and still fail end-to-end.
**Why it happens:** CONTEXT.md's write-shape (`cart_id`, `customer_id`) was written forward-looking, but the reader shipped in Phase 132 uses the raw claim key `cart`. The contract §3 claim key is `cart` (not `cart_id`).
**How to avoid:** Pick ONE and make reader + writer agree in the SAME phase:
- **Option A (recommended, least risk):** Write the cart under `cart` — `memory.commerce = { cart, customer_id, email, wishlist_ref, country_code, region_id, verified_at }`. Zero changes to already-merged Phase 132 executors; `region_id`/`country_code` already match. Downside: mild key-name inconsistency (`cart` vs `customer_id`).
- **Option B:** Write `cart_id` as CONTEXT.md literally states AND patch `get-cart.ts:33` to read `commerce.cart_id ?? commerce.cart`. Consistent shape, but touches shipped Phase-132 code and needs a regression check.
**Warning signs:** `medusa_get_cart` returns "No cart is connected" even though a valid token was pinned; a `tests/medusa-context.test.ts` pinning test passes but no test asserts `get-cart.ts` reads what `writeCommerceContext` wrote.
**Recommendation:** Option A. The planner should also add a cross-check test that feeds `writeCommerceContext`'s output into `loadPinnedContext`/`get-cart.ts`'s read key to lock the contract. Flag to user since CONTEXT.md's literal `cart_id` is overridden.

### Pitfall 2: HMAC key is UTF-8 string bytes, NOT hex-decoded  ⚠ CRITICAL (cross-repo)
**What goes wrong:** `src/lib/crypto.ts` and `src/lib/email/unsubscribe-token.ts` both take `ENCRYPTION_SECRET` (a 64-char hex string) and **hex-decode it to 32 key bytes**. If you copy that key-derivation for the commerce token, every HMAC will mismatch stuscle's.
**Why it happens:** Stuscle mints with `createHmac('sha256', XPHERE_CONNECTION_TOKEN)` where `XPHERE_CONNECTION_TOKEN` is the plaintext `xph_...` string. Node uses that **string's UTF-8 bytes** as the key (the whole `xph_` prefix included). xphere's `getMedusaCredentialsForOrg` returns the same plaintext `xph_...` string as `connectionToken`.
**How to avoid:** `importKey('raw', new TextEncoder().encode(connectionToken), {name:'HMAC', hash:'SHA-256'}, false, ['verify'])`. Do NOT hex-decode. Do NOT strip the `xph_` prefix.
**Warning signs:** Every real token fails verification while a token minted by an in-test helper using the same key-derivation passes (false confidence). Mitigate by adding a test vector minted with **`node:crypto` exactly as stuscle does** (see Validation Architecture).

### Pitfall 3: `data-context-endpoint` is fetched from the storefront, not xphere
**What goes wrong:** The natural instinct (copied from `fetchWidgetConfig`, which does `${apiBase}/api/...`) is to prefix `apiBase`. That points the token fetch at xphere (`:4267`/`xphere.app`), which has no storefront cookies and no `/api/chat-context` route.
**Why it happens:** Every other widget fetch goes to `apiBase` (xphere). This one is the exception.
**How to avoid:** `data-context-endpoint="/api/chat-context"` is a page-relative path; `fetch(_contextEndpoint, { credentials: 'same-origin' })` resolves against the **host page origin (storefront :8000)**, which is exactly where contract §3 says the token is minted (reading httpOnly `_medusa_cart_id`/`_medusa_jwt`). `credentials:'same-origin'` is required so the cookies are sent.
**Warning signs:** 404s or CORS errors on the context fetch; tokens never appear.

### Pitfall 4: `exp`/`iat` are UNIX seconds, not milliseconds
**What goes wrong:** Comparing `claims.exp` against `Date.now()` (ms) makes every token look ~1000× not-yet-expired (or, inverted, always expired).
**Why it happens:** Contract §3 shows `iat`/`exp` as 10-digit unix seconds (`1750000000`). `Date.now()` is ms.
**How to avoid:** Compare against `Math.floor(Date.now() / 1000)` on both server (verify) and widget (local exp decode).

### Pitfall 5: Always-on `commerce_context` breaks the existing widget test
**What goes wrong:** `tests/widget.test.ts:265` asserts the POST body is **exactly** `{ message: 'Hello there' }`. If the widget adds `commerce_context` unconditionally (or adds any always-present field), that assertion fails.
**Why it happens:** The test snapshots the full JSON body.
**How to avoid:** Only include `commerce_context` when a token is actually cached/fetched. In the existing test no `data-context-endpoint` is set → `ensureContext` returns null → body unchanged → test still green. Keep it conditional.

### Pitfall 6: JSONB merge clobbers other `memory` keys / race window
**What goes wrong:** `update({ memory: { commerce } })` overwrites the entire column, dropping any other memory keys.
**Why it happens:** Supabase-js `.update()` replaces the whole JSONB value.
**How to avoid:** Read `memory` first, spread `{ ...memory, commerce }`. The read-modify-write has a small race window (two concurrent messages), acceptable per the established `contacts/actions.ts` precedent and because verified tokens are the sole authority (last writer wins is fine). Always scope both the read and the update by `org_id` (RLS-consistent) as `loadPinnedContext` does.

### Pitfall 7: Null-tolerant claim parsing
**What goes wrong:** `cart`, `cus`, `email`, `wishlist_ref`, `region_id` can each be `null` (guest visitor, no cart yet). Strict non-null parsing rejects legitimate guest tokens.
**How to avoid:** Type them as `string | null`; only `v`, `org`, `country_code`, `iat`, `exp` are always present. A zod schema should use `.nullable()` for the optional-identity claims.

## Code Examples

### Reference: the shipped token this phase clones (verify half)
```typescript
// Source: src/lib/email/unsubscribe-token.ts (in-repo, HIGH confidence)
export async function verifyUnsubscribeToken(token: string) {
  const dot = token.indexOf('.')
  if (dot === -1) return null
  const payloadB64 = token.slice(0, dot)
  const sigB64 = token.slice(dot + 1)
  const key = await hmacKey()  // ← the ONE thing that changes: key = utf8(connectionToken), not hex(ENCRYPTION_SECRET)
  const ok = await crypto.subtle.verify('HMAC', key, b64urlDecode(sigB64), encoder.encode(payloadB64))
  if (!ok) return null
  // ...decode + parse payloadB64...
}
```

### Reference: stuscle's mint (the byte-for-byte target — for the test vector)
```typescript
// Source: contract §3 + additional_context (stuscle docs/INTEGRATION-XPHERE.md §3)
// token = base64url(payloadJson) + "." + base64url(HMAC_SHA256(SECRET, base64url(payloadJson)))
import { createHmac } from 'node:crypto'
function b64url(b: Buffer | string) {
  return Buffer.from(b).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'')
}
function mint(payload: object, secret: string) {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload)))
  const sig = createHmac('sha256', secret).update(payloadB64).digest()  // raw bytes
  return `${payloadB64}.${b64url(sig)}`
}
// Use THIS exact function in tests to generate the "valid" vector, so a green test proves cross-repo agreement.
```

### Existing vitest supabase mock idiom (copy for pinning tests)
```typescript
// Source: tests/medusa-credentials.test.ts (in-repo)
const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
const chain = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle, update: vi.fn().mockReturnThis() }
const from = vi.fn().mockReturnValue(chain)
const supabase = { from } as unknown as SupabaseClient
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Per-send DB row for signed links | Stateless `payload.sig` HMAC blob | `unsubscribe-token.ts` (shipped) | This phase reuses the same stateless pattern — no new table |
| `timingSafeEqual` manual length guard | `crypto.subtle.verify` (constant-time + length-safe) | `notion/webhook.ts`, `unsubscribe-token.ts` | Prefer `subtle.verify` for HMAC checks |

**Deprecated/outdated:** None relevant. Do not introduce a JWT lib (contract forbids it).

## Environment Availability

Step 2.6: The xphere side of this phase is **code/config only** — no new external tools, runtimes, or services are required at plan/execution time (vitest, esbuild, zod, supabase-js all installed; verified in `package.json` 2026-07-17).

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| vitest | CTX-01/02 unit tests | ✓ | 4.1.2 | — |
| esbuild (`npm run build:widget`) | CTX-03 widget rebuild | ✓ | 0.28.0 | — |
| zod | schema extension | ✓ | 3.25.76 | — |
| Stuscle `/api/chat-context` mint (cross-repo) | End-to-end token, not unit tests | ✗ (built in the **stuscle** repo, separate GSD project) | — | Unit tests mint their own vectors with the `node:crypto` function above; live e2e deferred to dev wiring (contract §9) |

**Missing dependencies with no fallback:** None for this phase's coded scope.
**Missing dependencies with fallback:** The live storefront mint is not needed to build/test the xphere verify — tests generate byte-identical vectors locally. Full cross-repo e2e happens at the §9 dev-wiring step (out of this phase's scope; stuscle-side code is explicitly Out of Scope per REQUIREMENTS.md).

## Validation Architecture

Nyquist validation is **enabled** (`.planning/config.json` → `workflow.nyquist_validation: true`).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 4.1.2 |
| Config file | `vitest.config.ts` (environment `node`, `globals: true`, include `tests/**/*.test.ts(x)`, alias `@`→`src`, `server-only` stub) |
| Quick run command | `npx vitest run tests/medusa-context.test.ts` |
| Full suite command | `npm test` (→ `vitest run`) |
| Phase gate | `npm test` green **and** `npm run build` (CLAUDE.md requires build after changes; also runs `build:widget`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CTX-01 | Valid token → claims returned | unit | `npx vitest run tests/medusa-context.test.ts -t "valid"` | ❌ Wave 0 |
| CTX-01 | Expired token (`exp <= now`) → null | unit | `… -t "expired"` | ❌ Wave 0 |
| CTX-01 | Tampered signature → null | unit | `… -t "bad sig"` | ❌ Wave 0 |
| CTX-01 | `org` mismatch → null (cross-org replay) | unit | `… -t "wrong org"` | ❌ Wave 0 |
| CTX-01 | Malformed / non-`v1` / bad base64 → null (no throw) | unit | `… -t "malformed"` | ❌ Wave 0 |
| CTX-01 | Byte-agreement: vector minted with `node:crypto` (stuscle-identical) verifies | unit | `… -t "cross-repo vector"` | ❌ Wave 0 |
| CTX-02 | `writeCommerceContext` merges `commerce` without clobbering other `memory` keys (mock supabase) | unit | `… -t "merge preserves"` | ❌ Wave 0 |
| CTX-02 | Re-pin from new token overwrites cart + returns `repinnedFrom` (old→new) | unit | `… -t "repin"` | ❌ Wave 0 |
| CTX-02 | Written key is read back by the executor's read key (guards Pitfall 1) | unit | `… -t "read-back"` | ❌ Wave 0 |
| CTX-02 | Route accepts `commerce_context` ≤2048; absent → no creds lookup (fail-soft path) | unit (extend chat route test) | `npx vitest run tests/chat-api.test.ts -t "commerce"` | ⚠ extend existing |
| CTX-03 | Widget includes `commerce_context` in POST when token cached; omits when absent | manual + optional jsdom | manual via `public/widget-test.html`; optional `npx vitest run tests/widget.test.ts` | manual (see note) |
| CTX-03 | `Opps.setContext` replaces cached token | manual | `public/widget-test.html` console | manual |

### Sampling Rate
- **Per task commit:** `npx vitest run tests/medusa-context.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` green + `npm run build` (includes `build:widget`) before `/gsd:verify-work`

### Widget testing note (reconciling CONTEXT.md "no test harness")
CONTEXT.md states the widget has no test harness and should be verified manually via `public/widget-test.html`. **A jsdom harness does in fact exist** (`tests/widget.test.ts`) — it evaluates the built `public/widget.js` and even asserts the exact chat POST body (line 265). Honest reconciliation:
- **Honor the locked decision:** primary CTX-03 verification is manual via `public/widget-test.html` (extend its checklist with: token fetched from `data-context-endpoint`, `commerce_context` present on POST, `Opps.setContext` updates it, re-fetch after a `commerce`/`cart_created` event).
- **Optional low-cost automation available:** the existing jsdom test could be extended to assert `commerce_context` appears in the POST body when `data-context-endpoint` is set. This is at the planner's discretion; it is NOT required by the locked decision. If pursued, note that adding an always-on field would break the existing exact-body assertion — keep `commerce_context` conditional (Pitfall 5).
- `public/widget-test.html` today is a Phase-4 checklist; its `data-token` is a real dev token but it has **no** `data-context-endpoint` — add one pointing at a storefront mint (or a stub) for manual context verification.

### Wave 0 Gaps
- [ ] `tests/medusa-context.test.ts` — new; covers CTX-01 (verify matrix + cross-repo vector) and CTX-02 (pinning merge/repin/read-back). Include a `node:crypto` mint helper as the source of the "valid" vector.
- [ ] Extend `tests/chat-api.test.ts` — add a case that posts `commerce_context` and asserts fail-soft (invalid token → chat still streams) and that absent context skips the creds lookup. (Route already has a mock harness; mock `getMedusaCredentialsForOrg`/context module.)
- [ ] Extend `public/widget-test.html` — add `data-context-endpoint` + a manual context checklist.
- No framework install needed (vitest + esbuild present).

## Open Questions

1. **`cart` vs `cart_id` pinned key (blocks correct wiring).**
   - What we know: Phase 132's shipped executor reads `commerce.cart` (`get-cart.ts:33`); CONTEXT.md's write-shape says `cart_id`. `region_id`/`country_code` already agree.
   - What's unclear: whether to change the write to match the reader (Option A) or change the reader to match CONTEXT.md (Option B).
   - Recommendation: **Option A** — write `cart` (+ `customer_id`/`email`/`wishlist_ref`/`country_code`/`region_id`/`verified_at`). Zero changes to shipped code, immediate wiring. Add a read-back test. Surface to the user because it overrides CONTEXT.md's literal `cart_id`.

2. **Zod schema for claims (Claude's discretion).**
   - What we know: CONTEXT.md permits a zod `ClaimsSchema`.
   - Recommendation: add one with `.nullable()` optional-identity fields; it cleanly enforces null-tolerance (Pitfall 7) and rejects malformed payloads post-decode.

3. **`readCommerceContext` vs existing `loadPinnedContext`.**
   - What we know: CONTEXT.md asks for a `readCommerceContext(supabase, conversationId)`; Phase 132 already has `loadPinnedContext(ctx)` that returns `{ sessionKey, commerce }`.
   - What's unclear: whether the new reader is redundant.
   - Recommendation: reuse `loadPinnedContext` where a `MedusaExecCtx` is available; only add a thin `readCommerceContext` if a caller has just `(supabase, conversationId)` and no `ctx`. Avoid two divergent readers of the same shape.

## Sources

### Primary (HIGH confidence — in-repo, read directly)
- `src/lib/email/unsubscribe-token.ts` — the exact `payload.sig` HMAC token pattern this phase clones (Web Crypto, base64url)
- `src/lib/crypto.ts` — Edge-safe Web Crypto idioms; shows the hex-decode key derivation to NOT copy for the connection token
- `src/lib/medusa/credentials.ts` — `getMedusaCredentialsForOrg` returns decrypted `connectionToken` (the HMAC secret)
- `src/lib/medusa/pinned-context.ts` + `src/lib/medusa/actions/{get-cart,search-products,get-product}.ts` — the reader keys (`commerce.cart`/`region_id`/`country_code`) that dictate the write shape (Pitfall 1)
- `src/app/api/chat/[token]/route.ts` — insertion point, `ChatRequestSchema`, org resolution, `ctx.dbSessionId`
- `src/widget/index.ts` — currentScript capture (473), `sendMessage` POST body (626), `submitMessage` onEvent (776-820), `window.Opps` (1070)
- `src/app/(dashboard)/contacts/actions.ts:1298` — the JSONB read-merge-write precedent
- `tests/medusa-credentials.test.ts`, `tests/widget.test.ts`, `tests/chat-api.test.ts`, `vitest.config.ts`, `package.json` — test framework + mock idioms + build script
- `src/lib/{notion/webhook,vapi/verify-signature,twilio/webhook-signature}.ts` — repo HMAC/timing-safe conventions
- `.planning/research/INTEGRATION-CONTRACT.md` §2, §3, §6, §8, §9 — FROZEN token/claims/verification/mint/env spec
- `.planning/config.json` — nyquist enabled

### Secondary (MEDIUM confidence)
- `additional_context` from the orchestrator prompt: stuscle mint uses `node:crypto` `createHmac('sha256', SECRET).update(base64url(payloadJson)).digest()` → cross-referenced against contract §3 (agree).

### Tertiary (LOW confidence)
- None. No web sources needed — this phase is fully constrained by in-repo code and the frozen contract.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; every primitive read directly in-repo.
- Architecture (verify/pin/route/widget): HIGH — insertion points and reader keys read from shipped code.
- Byte-level HMAC agreement: HIGH — the mint and verify formulas were compared symbol-by-symbol (key = utf8 string bytes; HMAC over base64url string; raw digest → base64url).
- `cart` vs `cart_id` reconciliation: HIGH on the *finding* (grep-confirmed), decision is a user-facing choice (recommended Option A).
- Widget test-harness status: HIGH — jsdom harness exists; reconciled honestly against CONTEXT.md's "no harness" framing.

**Research date:** 2026-07-17
**Valid until:** 2026-08-16 (30 days — stable; contract is FROZEN and the code is in-repo). Re-check only if Phase 132's pinned-memory key names change or the contract is amended.

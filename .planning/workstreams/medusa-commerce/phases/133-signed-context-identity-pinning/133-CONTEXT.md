# Phase 133: Signed Context & Identity Pinning - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Mode:** Derived from user-approved integration plan + security design (plan-mode session 2026-07-17); discuss not needed

<domain>
## Phase Boundary

Bind the webchat conversation to the visitor's real commerce identity: verify the storefront-minted HMAC context token, pin claims onto the conversation, and teach the widget to fetch/forward the token. This is the anti-IDOR core. Contract: `.planning/research/INTEGRATION-CONTRACT.md` §3.

</domain>

<decisions>
## Implementation Decisions

### Verification (`src/lib/medusa/context.ts`)
- `verifyCommerceContext(token, secret): Claims | null` — split on ".", recompute `HMAC_SHA256(secret, payloadB64)` with `crypto.timingSafeEqual` (Web Crypto or node:crypto — match repo convention in `src/lib/crypto.ts` which is Web Crypto/Edge-safe; the chat route runs nodejs runtime, node:crypto acceptable), check `exp > now`, parse claims `{v, org, cart, cus, email, wishlist_ref, country_code, region_id, iat, exp}`.
- Org binding: caller passes the org resolved from the widget token; claims.org must equal it (cross-org replay barrier).
- Secret = decrypted medusa `integrations.encrypted_api_key` for the org (`getMedusaCredentialsForOrg` from Phase 132).

### Pinning (`src/lib/medusa/context.ts` read/write helpers)
- `writeCommerceContext(supabase, conversationId, claims)`: merge into `conversations.memory.commerce` = `{cart_id, customer_id, email, wishlist_ref, country_code, region_id, verified_at}`. Merge, don't clobber other `memory` keys.
- `readCommerceContext(supabase, conversationId)` for executors.
- Re-pin rules: a NEW verified token may change cart_id/customer_id (legit rotation post-checkout/login) — log `[commerce-ctx] repinned` with old→new. NEVER write from message text or model output. If an incoming verified token's cart differs from pinned without rotation semantics, overwrite (it IS a fresh verified token) — verified tokens are the sole authority.

### Chat route changes
- `ChatRequestSchema += commerce_context: z.string().max(2048).optional()`.
- After org resolution + session ensure (needs the conversation row id): if `commerce_context` present → load medusa creds → verify → write pinned context. ALL failure paths fail-soft: log warn, continue chat without commerce context. No extra DB round trips when the token is absent (org without medusa integration pays nothing).

### Widget (`src/widget/index.ts` — then `npm run build:widget`)
- Capture `data-context-endpoint` from `document.currentScript` at load (sync, like the token capture).
- Lazy fetch: before sending a message, if no cached token or cached `exp` passed (decode payload locally to read exp — no verification client-side), `fetch(contextEndpoint, {credentials:'same-origin'})` → `{token}` → cache. Failure → send message without context (never block chat).
- Include `commerce_context` in the POST body when available; re-fetch after receiving a `commerce` SSE event with `action:'cart_created'` (cart cookie changed server-side — Phase 134 emits it; guard by event name string now).
- Public API: `Opps.setContext(token: string)` replaces the cached token.
- Widget has no test harness — keep changes minimal and manually verifiable via `public/widget-test.html`.

### Claude's Discretion
- Exact log wording; whether claims get a zod schema (recommended) in context.ts; unit-test organization (vitest: valid/expired/bad-sig/wrong-org/malformed + pinning merge semantics with mocked supabase).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/chat/persist.ts` — `ensureDbSession` (conversation row creation; route already has the conversation id in scope).
- `src/lib/crypto.ts` — Web Crypto HMAC/encryption patterns (Edge-safe idioms).
- `src/widget/index.ts` — currentScript capture ~line 473, POST body build in sendMessage ~line 626, `window.Opps` API ~line 1070.
- Phase 132's `getMedusaCredentialsForOrg`.

### Established Patterns
- Conversations: `memory` JSONB NOT NULL DEFAULT '{}' (migration 015). Service-role supabase client in the chat route.

### Integration Points
- Chat route `src/app/api/chat/[token]/route.ts`; esbuild widget build (`npm run build:widget`) — commit the rebuilt `public/widget.js`.

</code_context>

<specifics>
## Specific Ideas

- Token claims parse must be tolerant of nulls (cart/cus/email/wishlist_ref can each be null per contract §3).
- Store `verified_at` (ISO) in memory.commerce so later phases can log token freshness.

</specifics>

<deferred>
## Deferred Ideas

- Rich context UI in the dashboard (show "visitor has cart X") — later milestone.

</deferred>

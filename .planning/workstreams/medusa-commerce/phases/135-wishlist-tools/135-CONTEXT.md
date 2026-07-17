# Phase 135: Wishlist Tools - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Mode:** Derived from user-approved integration plan (plan-mode session 2026-07-17); discuss not needed

<domain>
## Phase Boundary

Wishlist add/remove/list tools calling Stuscle's HMAC-guarded `/agent/wishlists/*` surface. Contract: §4.2 (request/response shapes + signing). The Medusa-side routes are built in the stuscle repo (its Phase 3) — these executors must be testable against a mock server.

</domain>

<decisions>
## Implementation Decisions

### Signed client (`src/lib/medusa/client.ts` — add `medusaAgentFetch`)
- `medusaAgentFetch<T>(creds, path, body)`: `ts = Math.floor(Date.now()/1000)`; `sig = hex(HMAC_SHA256(connectionToken, ts + "." + rawBodyString))`; headers `X-Xphere-Timestamp: ts`, `X-Xphere-Signature: v1=<sig>`, `Content-Type: application/json`; POST only; 8s timeout; R11 shared budget.
- rawBodyString is EXACTLY the string passed to fetch body — stringify once, sign that string, send that string (byte-identical; this is what stuscle verifies).
- Unit test with a fixed reference vector (secret `test-secret`, ts `1750000000`, body `{"a":1}`) — document expected hex in the test so the stuscle side can assert the same vector.

### Executors (`src/lib/medusa/actions/`)
- Owner resolution (all three): pinned `customer_id` if present, else pinned `wishlist_ref`, else return a friendly explanation that nothing can be saved yet (and that browsing the store creates the link). NO owner params in tool schemas.
- `wishlist-add.ts` — params `{ product_id: string, variant_id?: string }` → `POST /agent/wishlists/add`. 409 `wishlist_full` → friendly "wishlist is full (100 items)" string.
- `wishlist-remove.ts` — params `{ product_id: string, variant_id?: string }` → `/agent/wishlists/remove`.
- `wishlist-list.ts` — no params → `/agent/wishlists/list`; render items (title, variant) as a short list.
- Budgets: add/remove → R7/R8 write budgets (fail-closed) + `SIDE_EFFECTING_ACTIONS`; list → R6 read budget.

### Wiring
- `execute-action.ts` cases, `ACTION_DESCRIPTIONS`, `spec.ts` NODES (all three; `integration_required: ['medusa']`).

### Claude's Discretion
- Error-string wording; whether list result includes product URLs (needs storefront_url from config — nice-to-have).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phases 131–134 infra: creds, limiter failModes, pinned-context readers, SIDE_EFFECTING_ACTIONS registration pattern.
- Contract §4.2 tables — exact request/response bodies.

### Established Patterns
- vitest with mocked fetch; executor error-string convention.

### Integration Points
- `src/lib/medusa/client.ts` (extend), `execute-action.ts`, `spec.ts`.

</code_context>

<specifics>
## Specific Ideas

- Add/remove are idempotent server-side (stuscle returns 200 with existing/removed:true) — reflect that in tool result strings ("already saved" vs "saved").

</specifics>

<deferred>
## Deferred Ideas

- "Move wishlist item to cart" composite tool — later (agent can chain add_to_cart today).

</deferred>

# Phase 134: Cart Write Tools - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Mode:** Derived from user-approved integration plan + security design (plan-mode session 2026-07-17); discuss not needed

<domain>
## Phase Boundary

The agent modifies the visitor's REAL cart — bounded, idempotent, streamed back to the storefront. Adds `emitStructured` to the action pipeline, the two write executors, commerce write budgets, and the widget's `commerce`-event re-dispatch. Contract: §4.1 (calls), §6 (SSE events), §7 (limits).

</domain>

<decisions>
## Implementation Decisions

### emitStructured plumbing
- `ActionContext += emitStructured?: (obj: Record<string, unknown>) => void`.
- `run-agent.ts` streaming path passes the SSE `emit` function through; blocking path omits it (executors must null-check). Events flow through the existing NDJSON encoder untouched.

### Executors (`src/lib/medusa/actions/`)
- `add-to-cart.ts` — params `{ product_id?: string, variant_id?: string, quantity?: number }` (product/variant ids allowed; visitor-scoped ids NEVER). Flow: clamp qty to 1–10 → resolve pinned cart from `memory.commerce` → if none: `POST /store/carts {region_id}` (region from context; else resolve per Phase 132 fallback) → `POST /store/carts/:id` update `metadata.xphere_sig = hex(HMAC_SHA256(connectionToken, cart_id))` → `writeCommerceContext` pin → emit `{event:'commerce', action:'cart_created', cartId, itemCount, sig}` → then `POST /store/carts/:id/line-items {variant_id, quantity}`. If product_id given without variant_id: fetch product, use its single variant or ask the user to pick (return option list string). Check line-item count ≤50 after add (read cart) — if exceeded, remove the just-added item and return a friendly limit message.
- `update-cart-item.ts` — params `{ item_title_or_variant?: string, quantity: number }`: resolve the line item by fuzzy title/variant match within the PINNED cart only; `quantity 0` → DELETE line item; else clamp 1–10 and update. Emit `{event:'commerce', action:'cart_updated', cartId, itemCount}` on success (both tools).
- Both return natural-language summaries including the new cart total.

### Budgets & guardrails (contract §7)
- R7 `com:write:{sessionId}` 10/60s failMode 'closed'; R8 `com:write:day:{convId}` 60/24h 'closed' — enforced at the top of both executors.
- `src/lib/agent-runtime/guardrails.ts`: commerce write caps — max 3 side-effecting commerce calls per TURN, 25 per conversation. Turn counter can live in the run-agent tool loop (in-memory per invocation); conversation counter via Redis or a memory.commerce counter — planner's choice, but breaches must return a clean tool-result string, not throw.
- `src/lib/agent-runtime/idempotency.ts`: add `medusa_add_to_cart`, `medusa_update_cart_item` to `SIDE_EFFECTING_ACTIONS`.

### Widget re-dispatch (`src/widget/index.ts` + rebuild)
- Handle `commerce` SSE events in the stream consumer: `window.dispatchEvent(new CustomEvent('xphere:commerce', { detail: { action, cartId, itemCount, sig } }))`. Also trigger the Phase 133 context re-fetch on `cart_created`.

### Claude's Discretion
- Fuzzy line-item matching approach; cart-total formatting; where the per-turn write counter lives; test structure (vitest, mocked fetch + mocked rate-limit: clamps, no-cart create+sign+pin+emit sequence order, R7 closed behavior when Redis down, 51st line item rollback).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 132: `medusaStoreFetch`, credentials, region fallback; Phase 133: `readCommerceContext`/`writeCommerceContext`, HMAC helpers; Phase 131: failMode limiter.
- `src/lib/agent-runtime/idempotency.ts` — `SIDE_EFFECTING_ACTIONS` (~line 23) + `tool_idempotency` infra.
- `src/lib/agent-runtime/guardrails.ts` — existing caps structure to extend.
- SSE emit: `runAgentStreaming` in `src/lib/agent-runtime/run-agent.ts` (emit closures), encoder `src/lib/chat/stream/encoder.ts`.

### Established Patterns
- Executors never throw into the tool loop — return error strings. Demo-org guard already blocks side effects.

### Integration Points
- `execute-action.ts` cases; `ACTION_DESCRIPTIONS`; `workflows/spec.ts` NODES; widget stream consumer (`consumeStream`/`submitMessage` onEvent ~line 792).

</code_context>

<specifics>
## Specific Ideas

- Event ORDER matters for the storefront bridge: `cart_created` must be emitted only AFTER the sig metadata write succeeded (else adoption fails verification).
- The `sig` in `cart_created` is what the stuscle bridge verifies — hex HMAC over the raw cart_id string with the shared connection token. Add one unit test asserting the exact test vector so both repos agree (document vector in the test).

</specifics>

<deferred>
## Deferred Ideas

- Max-cart-value knob (org-configurable) — v2 (CRT-05).
- promotions/discount application via chat — later.

</deferred>

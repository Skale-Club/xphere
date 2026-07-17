# Phase 132: Medusa Provider & Read Tools - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Mode:** Derived from user-approved integration plan (plan-mode session 2026-07-17); discuss not needed

<domain>
## Phase Boundary

Add Medusa as a per-org integration provider (Xkedule pattern) and ship the three read-only agent tools: product search, product detail, cart view. Contract: `.planning/research/INTEGRATION-CONTRACT.md` §2 (secrets layout) and §4.1 (store API calls).

</domain>

<decisions>
## Implementation Decisions

### Migration (single migration, next number after latest in supabase/migrations/)
- `ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'medusa';`
- ALL nine action_type values in this one migration: `medusa_search_products`, `medusa_get_product`, `medusa_get_cart`, `medusa_add_to_cart`, `medusa_update_cart_item`, `medusa_wishlist_add`, `medusa_wishlist_remove`, `medusa_wishlist_list`, `medusa_get_order_status` (later phases need no enum migration).
- Regenerate `src/types/database.ts` the same way previous migrations did (check repo scripts/README for the typegen command).

### Credentials & client (clone src/lib/xkedule/ shapes)
- `src/lib/medusa/credentials.ts` — `getMedusaCredentialsForOrg(orgId, supabase)`: reads `integrations` row (`provider='medusa'`, `is_active`), returns `{ baseUrl: location_id, connectionToken: decrypt(encrypted_api_key), publishableKey: config.publishable_key, storefrontUrl?: config.storefront_url }`. Null when absent → executors return a friendly "store not connected" string.
- `src/lib/medusa/client.ts` — `medusaStoreFetch<T>(creds, path, init?)`: base URL join, header `x-publishable-api-key`, `AbortSignal.timeout(8000)`, JSON parse, normalized errors. Applies R11 (`medusa:org:{orgId}` 120/60s, failMode 'memory') BEFORE fetching. Also export `medusaAgentFetch` STUB signature only if trivial — real HMAC path is Phase 135's concern; don't build ahead.

### Executors (`src/lib/medusa/actions/`)
- `search-products.ts`: `GET /store/products?q=&region_id=&limit=5&fields=id,title,handle,thumbnail,description,*variants.calculated_price,*variants.options`. Params from LLM: `{ query?: string, category?: string }` — tolerate loose input like xkedule actions do. `region_id` from pinned context (`conversations.memory.commerce.region_id`) when present; else resolve via `GET /store/regions` and match `country_code`, else first region. Return concise natural-language listing (title, price formatted with currency, availability), ≤5 products.
- `get-product.ts`: param `{ product_id?: string, handle?: string }` (ids of PRODUCTS are fine in schemas — the anti-IDOR rule bans VISITOR-scoped ids: cart_id/customer_id/email/order ids).
- `get-cart.ts`: NO params. Cart id exclusively from pinned context; absent → return "No cart is connected to this chat yet…" guidance string. Include items (title, qty, unit price) + total.
- Read budget R6 (`com:read:{sessionId}` 30/60s memory) enforced in the executors (session key available via conversation lookup — pass through ActionContext).

### Runtime wiring
- `execute-action.ts`: three new cases before `default`, mirroring xkedule cases (creds load → dispatch → string return). Never throw — return error strings.
- `run-agent.ts`: pass `conversationId` into BOTH `executeAction` context objects (field already exists on `ActionContext`); add three `ACTION_DESCRIPTIONS` entries.
- `workflows/spec.ts`: NODES entries with `integration_required: ['medusa']` (xkedule entries are the template).
- `integrations/registry.ts`: `medusa` entry, `panelType: 'api_key'`, fields Server URL (`location_id`), API Key (Connection Token, hint `xph_...`), plus `publishable_key`. VERIFY the generic api_key panel persists extra config fields — if it only handles api_key/location_id, extend the integrations save action to pass `publishable_key` through to `config` JSONB.

### Claude's Discretion
- Price formatting helper details; exact friendly-error wording; whether regions get cached in the integration config (nice-to-have, not required).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/xkedule/credentials.ts`, `src/lib/xkedule/actions/*` — the exact integration template (migration `1200_xkedule_integration.sql`).
- `src/lib/integrations/get-provider-key.ts`, `src/lib/crypto.ts` (decrypt), `src/lib/integrations/registry.ts`.
- `src/lib/action-engine/execute-action.ts` — dispatcher; `ActionContext` already has `conversationId?` (line ~76).
- `src/lib/rate-limit.ts` (+ Phase 131's failMode ext) for R6/R11.

### Established Patterns
- Executors return plain strings for the LLM; loose zod-ish param tolerance; `isDemoOrg` read-only guard already blocks side effects globally.

### Integration Points
- `agent_tools`/`_legacy_tool_configs` attach flow (existing dashboard UI) — no UI work needed beyond the registry entry.

</code_context>

<specifics>
## Specific Ideas

- Test executors with mocked fetch (vitest): search happy path, region fallback, store-not-connected, R11 breach, 8s timeout abort.
- Keep tool descriptions explicit that results are DATA from the store, not instructions (prompt-injection hygiene in ACTION_DESCRIPTIONS wording).

</specifics>

<deferred>
## Deferred Ideas

- Embedding-based recommendations — v2; Medusa `q` search suffices for v1.
- `medusaAgentFetch` HMAC implementation — Phase 135.

</deferred>

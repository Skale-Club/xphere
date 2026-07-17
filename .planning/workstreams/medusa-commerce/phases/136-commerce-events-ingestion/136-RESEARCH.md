# Phase 136: Commerce Events Ingestion - Research

**Researched:** 2026-07-17
**Domain:** Inbound webhook ingestion (Bearer API key) · idempotent receipt table · contact find-or-create · conversation annotation · workflow event dispatch (xphere / Next.js 16 + Supabase)
**Confidence:** HIGH — every pattern this phase needs already ships in-repo (`/api/v1/leads`, `emitLeadCaptured`, `lead_ingestions`, `event_dispatches`, `spec.ts` TRIGGERS). This is a near-mechanical clone with three commerce-specific twists (documented as pitfalls).

## Summary

Phase 136 is a **clone-and-adapt** phase, not a greenfield one. Every ingredient exists:
`src/app/api/v1/leads/route.ts` is the end-to-end skeleton (64KB cap → `verifyApiKey` → zod → `Idempotency-Key === event_id` → dedupe insert → emit → stamp `last_used_at`); `src/lib/leads/events.ts::emitLeadCaptured` is the dispatch pattern (workflows query `trigger_config @> {event}`, `event_dispatches` audit row, `runFlow`/`runFlowSync` per `definitionHasWait`); `supabase/migrations/1214_websites_lead_ingestions.sql` is the receipts-table + RLS template; `tests/leads-*.test.ts` are the Docker-free mock-supabase test templates. The work is to reproduce these for `commerce_event_receipts` + `POST /api/v1/commerce/events` + `emitCommerceEvent`, mapped to contract §5.

**Three commerce-specific twists that will bite if copied blindly:**
1. **The pinned cart key is `cart`, NOT `cart_id`.** The locked CONTEXT decision says annotate the conversation where `memory.commerce->>'cart_id' = data.cart_id`. That is **wrong against shipped code** — Phase 133/134 write and read the key as `commerce.cart` (verified in `context.ts`, `get-cart.ts`, `add-to-cart.ts`). The annotation filter MUST be `memory->commerce->>cart`. See Pitfall 1.
2. **Money is MAJOR units** — the zod schema must never coerce/divide `total` or `unit_price`. See Pitfall 2.
3. **Event-name mapping:** the webhook body `type` is `order.placed` / `customer.created`; the workflow trigger event is `commerce.order.placed` / `commerce.customer.created`. Map explicitly. See Pitfall 3.

**Primary recommendation:** Split the work exactly as leads is split — a thin route, a receipt-insert service (`insertCommerceReceipt`, catches Postgres `23505` → duplicate), and an `emitCommerceEvent` emitter — so each unit is mock-testable Docker-free. Do NOT invent new libraries, new dedupe schemes, or new HMAC; the contract's HMAC upgrade is explicitly deferred (EVI-04).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Scope + endpoint**
- `src/lib/api-keys/scopes.ts`: add `commerce:events` (label "Commerce — events", description "Ingest e-commerce events via POST /api/v1/commerce/events").
- `src/app/api/v1/commerce/events/route.ts` — CLONE the `/api/v1/leads/route.ts` skeleton: 64KB body cap → `verifyApiKey(request, supabase, 'commerce:events')` → zod schema per contract §5 → `Idempotency-Key` header must equal `event_id` (422 otherwise) → receipt insert → emit → stamp `api_keys.last_used_at`. Responses exactly: 201 `{receipt_id}`, 200 `{duplicate:true}`, 401/403, 422. R12 rate limit 600/min/org failMode 'open'.

**Receipts migration (next number)**
- `commerce_event_receipts`: `id uuid pk default gen_random_uuid()`, `org_id uuid references organizations`, `event_id text`, `type text`, `payload jsonb`, `created_at timestamptz default now()`, `UNIQUE(org_id, event_id)`, RLS org-isolation read (service-role writes) — mirror an existing receipts-style table's RLS.
- Duplicate detection: rely on the unique violation on insert → 200 duplicate (no re-dispatch).

**Event emission (`src/lib/commerce/events.ts`)**
- `emitCommerceEvent(supabase, orgId, receiptId, type, data)` modeled 1:1 on `src/lib/leads/events.ts::emitLeadCaptured`:
  - Find-or-create contact by `data.email` (reuse the ingestLead contact upsert helper if extractable; else same logic). Set source appropriately (add nothing to enums — use existing closest source value or metadata).
  - `order.placed` with `data.cart_id`: find conversation where `memory.commerce->>'cart_id' = data.cart_id` (org-scoped) → merge `memory.commerce.last_order_display_id = data.display_id`; if the conversation lacks `contact_id`, set it to the found/created contact.
  - Dispatch workflows: `trigger_type='event'`, `trigger_config @> {event: 'commerce.order.placed'|'commerce.customer.created'}`, `health_blocked=false` → `event_dispatches` audit row → `runFlow`/`runFlowSync` per `definitionHasWait` (copy the leads dispatch block).
- `src/lib/workflows/spec.ts`: TRIGGERS entries for both events with variable namespaces (`order.*` → display_id, email, total, currency_code, items; `customer.*` → email, first_name, last_name; plus `contact.*`, `trigger.fired_at`).

> ⚠️ **RESEARCH CORRECTION TO A LOCKED DECISION:** the decision above says filter on `memory.commerce->>'cart_id'`. Shipped code (Phases 133/134) pins the cart under the key **`cart`**, not `cart_id`. Use `memory->commerce->>cart = data.cart_id` (the webhook payload field is `cart_id`; the stored conversation key is `cart`). This is a naming mismatch between the two sides, not a value mismatch — both hold the same Medusa `cart_...` id. See Pitfall 1. Flagged per the phase brief's explicit instruction.

### Claude's Discretion
- Whether contact timeline note is written (nice, if a lightweight existing helper exists — do not build new UI).
- Test structure: vitest route tests with mocked supabase (201/duplicate 200/bad scope 403/mismatched Idempotency-Key 422) + emit dispatch query shape test.

### Deferred Ideas (OUT OF SCOPE)
- HMAC+timestamp upgrade and replay cache (EVI-04/v2); cart.updated + fulfillment events (contract change first).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **EVI-01** | `commerce:events` scope + `POST /api/v1/commerce/events` per contract §5 (64KB, Bearer, `Idempotency-Key === event_id`, zod; 201/200/401/403/422) | Scope: add one entry to `API_KEY_SCOPES` in `scopes.ts` (§ Architecture Pattern 1). Route: byte-for-byte clone of `leads/route.ts` (§ Pattern 2) with the commerce zod schema (§ Code Examples) and R12 rate limit (§ Pattern 2). `verifyApiKey` already returns 401 (no/invalid key) and 403 (missing scope) — no change to `verify.ts` needed. |
| **EVI-02** | `commerce_event_receipts` migration (`UNIQUE(org_id, event_id)`, RLS); duplicates → 200 no re-dispatch | Migration `1260_commerce_event_receipts.sql`, RLS copied verbatim from `1214_websites_lead_ingestions.sql` (§ Pattern 3). Dedupe = insert-then-catch Postgres `23505` (confirmed in `tests/leads-ingest-service.test.ts` line 59). `database.ts` gets a hand-written table block mirroring `lead_ingestions` (§ Don't Hand-Roll / Code Examples). |
| **EVI-03** | `emitCommerceEvent` — contact find-or-create by email, conversation annotation via cart match, workflow dispatch `commerce.order.placed`/`commerce.customer.created` + `event_dispatches` audit + `spec.ts` TRIGGERS | `emitCommerceEvent` mirrors `emitLeadCaptured` verbatim except event names + payload shape (§ Pattern 4). Conversation annotation query (§ Pattern 5) uses the corrected `cart` key. TRIGGERS entries (§ Pattern 6) mirror `event:lead.captured`. Contact find-or-create reuses the `ingestLead` logic shape (`contacts` upsert by `email_normalized`, `source: 'api'`). |
</phase_requirements>

## Standard Stack

**No new dependencies.** Everything is already in `package.json` / in-repo. This phase is pure composition of existing modules.

### Core (existing in-repo modules to compose)
| Module | Path | Purpose in this phase |
|--------|------|-----------------------|
| `verifyApiKey` | `src/lib/api-keys/verify.ts` | Bearer auth + scope check → returns `{ok, status:401\|403, code}` or `{ok:true, key:{keyId, orgId, scopes}}`. Enforces 403 on missing scope. Use unchanged. |
| `API_KEY_SCOPES` | `src/lib/api-keys/scopes.ts` | Add `commerce:events`. `ApiKeyScope` is derived from this array, so `verifyApiKey(req, sb, 'commerce:events')` type-checks automatically once added. |
| `createServiceRoleClient` | `src/lib/supabase/admin.ts` | Service-role client (bypasses RLS) for the hash lookup, receipt insert, and emit. Same as leads route. |
| `rateLimit` | `src/lib/rate-limit.ts` | R12: `rateLimit('commerce:evt:'+orgId, 600, 60, { failMode: 'open' })`. failMode `'open'` = never denies when Redis down (matches contract §7 R12). |
| `emitLeadCaptured` (template) | `src/lib/leads/events.ts` | Copy the dispatch block verbatim into `emitCommerceEvent`. |
| `runFlow`, `definitionHasWait` | `src/lib/flows/engine.ts` | Async workflow run when the definition has a wait node. |
| `runFlowSync` | `src/lib/workflows/run-flow-sync.ts` | Synchronous run for wait-free definitions. |
| `resumeMatchingWaits` | `src/lib/flows/resume-waits.ts` | Fire to resume suspended runs (mirror leads). |
| `zod` | dependency (already used by `leadIngestionSchema`) | Body validation. Mirror `ingestion-schema.ts` conventions (`.strict()`, `nullableText`, `z.string().datetime({offset:true})`). |

### Supporting (data model touchpoints)
| Table | Migration | Role |
|-------|-----------|------|
| `commerce_event_receipts` (NEW) | `1260_*` (next number) | Idempotency ledger. `UNIQUE(org_id, event_id)`. |
| `api_keys` | `1147_public_api_keys.sql` | Bearer creds; `scopes text[]`; stamp `last_used_at`. |
| `event_dispatches` | `086_event_dispatches.sql` | Audit row per emit. Columns: `org_id, event_type, source_table, source_id, workflow_ids uuid[], payload jsonb`. |
| `workflows` | (existing) | Query: `org_id`, `trigger_type='event'`, `is_active=true`, `health_blocked=false`, `trigger_config @> {event}`. |
| `contacts` | `051` + `1147` | Find-or-create by `email_normalized`; `source` CHECK allows `api` (closest existing value — do NOT add a new enum value). |
| `conversations` | (existing) | Annotate `memory.commerce.last_order_display_id`; set `contact_id` if null. Has `memory Record<string,unknown>` and `contact_id string|null`. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Insert-then-catch `23505` dedupe | SELECT-first (like `ingestLead` does) | CONTEXT explicitly chose insert-then-catch (simpler, one round-trip, no payload-hash conflict logic needed — commerce has no "same id different payload = 409" requirement). Keep insert-then-catch. |
| Discriminated-union zod on `type` | Single object with all `data` fields optional + `.refine` | Discriminated union gives precise per-type validation and better 422s. Recommended. |
| Extract `insertCommerceReceipt` service | Inline insert in the route | Extracting mirrors the leads split and makes the route mock-testable (route test mocks the service, not raw supabase). Recommended (see Validation Architecture). |

## Architecture Patterns

### Recommended file layout (mirrors leads exactly)
```
src/
├── app/api/v1/commerce/events/route.ts   # NEW — clone of leads/route.ts
├── lib/
│   ├── api-keys/scopes.ts                 # EDIT — add commerce:events
│   ├── commerce/                          # NEW dir (does not exist yet)
│   │   ├── events.ts                      # NEW — emitCommerceEvent (mirror leads/events.ts)
│   │   ├── receipts.ts                    # NEW — insertCommerceReceipt (dedupe via 23505)
│   │   └── ingestion-schema.ts            # NEW — commerceEventSchema (mirror leads/ingestion-schema.ts)
│   └── workflows/spec.ts                  # EDIT — add 2 TRIGGERS entries
├── types/database.ts                      # EDIT — add commerce_event_receipts block
supabase/migrations/1260_commerce_event_receipts.sql   # NEW
tests/
├── commerce-events-schema.test.ts         # NEW — zod contract (mirror leads-ingestion.test.ts)
├── commerce-receipts-service.test.ts      # NEW — dedupe (mirror leads-ingest-service.test.ts)
├── commerce-events-route.test.ts          # NEW — status mapping (mirror leads-route-events.test.ts)
└── commerce-events-emit.test.ts           # NEW — dispatch query shape
```

### Pattern 1: Add the scope
`API_KEY_SCOPES` (`scopes.ts`) is a `const` array of `{key, label, description}`. `ApiKeyScope` is `(typeof API_KEY_SCOPES)[number]['key']`, so adding an entry immediately makes `'commerce:events'` a valid scope everywhere (settings UI, key generation, and the `verifyApiKey` scope param) with zero other edits.
```ts
{
  key: 'commerce:events',
  label: 'Commerce — events',
  description: 'Ingest e-commerce events via POST /api/v1/commerce/events',
},
```
`verifyApiKey` already returns `{ok:false, status:403, code:'insufficient_scope'}` when the key lacks the required scope, and `{ok:false, status:401, code:'invalid_api_key'}` for missing/invalid Bearer. **No change to `verify.ts`.**

### Pattern 2: The route (clone of `leads/route.ts`)
Order of operations (each maps to a contract response):
1. `content-length > 64*1024` → 413 (mirrors leads; see Pitfall 6 re: contract).
2. `verifyApiKey(request, supabase, 'commerce:events')` → 401 / 403.
3. **R12 rate limit** (new vs leads): `rateLimit('commerce:evt:'+auth.key.orgId, 600, 60, { failMode: 'open' })` → 429 if `!allowed`. Keyed by org, so it must come **after** auth.
4. `await request.text()`, re-check byte length → 413; `commerceEventSchema.parse(JSON.parse(rawText))` → 422 on `ZodError`.
5. `Idempotency-Key` header (trimmed) must equal `payload.event_id` → 422 mismatch.
6. `insertCommerceReceipt(...)` → on `23505` return **200 `{duplicate:true}`** (no emit); else continue with `receiptId`.
7. `await emitCommerceEvent(supabase, orgId, receiptId, payload.type, payload.data)` — never throws (internal try/catch like `emitLeadCaptured`).
8. `supabase.from('api_keys').update({ last_used_at: new Date().toISOString() }).eq('id', auth.key.keyId)`.
9. Return **201 `{receipt_id: receiptId}`**.

`export const runtime = 'nodejs'` (Bearer/API-key routes are Node runtime — matches leads and CLAUDE.md).

### Pattern 3: The receipts table + RLS (verbatim from `1214`)
`lead_ingestions` is the canonical receipts-style table. Copy its RLS clause verbatim (org-isolation, `FOR ALL TO authenticated`, `get_current_org_id()`), swap the table name and columns. Service-role writes bypass RLS; the policy exists so dashboard reads stay org-scoped.
```sql
-- Migration 1260: idempotency ledger for inbound Medusa commerce events (§5).
CREATE TABLE IF NOT EXISTS public.commerce_event_receipts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id   text        NOT NULL,
  type       text        NOT NULL,
  payload    jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_event_receipts_org_event_unique UNIQUE (org_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_event_receipts_org_created
  ON public.commerce_event_receipts (org_id, created_at DESC);

ALTER TABLE public.commerce_event_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commerce_event_receipts_org_isolation ON public.commerce_event_receipts;
CREATE POLICY commerce_event_receipts_org_isolation ON public.commerce_event_receipts
  FOR ALL TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.commerce_event_receipts IS
  'Immutable receipts for inbound Medusa commerce webhooks (order.placed, customer.created). UNIQUE(org_id,event_id) makes sender retries idempotent.';
```
Migration is applied to the remote DB with `npx supabase db push` (per CLAUDE.md). **Never edit an existing migration** — this is `1260`, next after `1259_medusa_integration.sql`.

### Pattern 4: `emitCommerceEvent` (mirror of `emitLeadCaptured`)
Same five moves as `emitLeadCaptured`, wrapped in one try/catch that never throws:
1. **Find-or-create contact** by `data.email` (reuse the `findContact`/insert logic shape from `ingestLead`: match `contacts.email_normalized = normaliseEmail(email)` scoped by org and `identity_status != 'archived_duplicate'`; on miss, insert with `source:'api'`, `lifecycle_stage:'lead'` (or `'customer'` for `order.placed` — discretionary), `source_type:'medusa'` or metadata; for `customer.created` also set `first_name`/`last_name`/`name`). Optionally fire `emitContactEvent(orgId,'contact.created',contactId,{supabase})` when newly created, mirroring the leads route.
2. **Query matching workflows:** `.from('workflows').select('id, current_version_id').eq('org_id',orgId).eq('trigger_type','event').eq('is_active',true).eq('health_blocked',false).contains('trigger_config',{event: WF_EVENT})` where `WF_EVENT` is `commerce.order.placed` or `commerce.customer.created`.
3. **Insert `event_dispatches` audit row:** `{org_id, event_type: WF_EVENT, source_table:'commerce_event_receipts', source_id: receiptId, workflow_ids: matched.map(w=>w.id), payload: {event: WF_EVENT, receipt_id, contact_id}}`; keep `dispatchId`.
4. **Conversation annotation** (order.placed only, if `data.cart_id`) — see Pattern 5.
5. **Run each workflow:** load `workflow_versions.definition` for the matched `current_version_id`s; per definition, `definitionHasWait(def)` ? `runFlow({workflowId, versionId, definition, orgId, triggerType:'event', triggerPayload: triggerInput, supabase})` : `runFlowSync({workflowId, definition, triggerInput, context:{orgId}})`. Also `void resumeMatchingWaits(supabase,{orgId, eventType: WF_EVENT, contactId, payload: triggerInput})`.

`triggerInput` shape (exposes the `order.*` / `customer.*` / `contact.*` namespaces):
```ts
// order.placed
{ event: 'commerce.order.placed', contact,
  order: { order_id, display_id, email, currency_code, total, cart_id, items, occurred_at } }
// customer.created
{ event: 'commerce.customer.created', contact,
  customer: { customer_id, email, first_name, last_name } }
```

### Pattern 5: Conversation annotation (the corrected `cart` key)
```ts
// order.placed only, and only when data.cart_id is present.
const { data: convo } = await supabase
  .from('conversations')
  .select('id, contact_id, memory')
  .eq('org_id', orgId)
  .eq('memory->commerce->>cart', data.cart_id)   // ← key is `cart`, NOT `cart_id`
  .order('last_active_at', { ascending: false })
  .limit(1)
  .maybeSingle()

if (convo) {
  const memory = (convo.memory as Record<string, unknown>) ?? {}
  const commerce = (memory.commerce as Record<string, unknown>) ?? {}
  const update: Record<string, unknown> = {
    memory: { ...memory, commerce: { ...commerce, last_order_display_id: data.display_id } },
  }
  if (!convo.contact_id) update.contact_id = contactId
  await supabase.from('conversations').update(update).eq('id', convo.id).eq('org_id', orgId)
}
```
`.eq('memory->commerce->>cart', value)` is PostgREST's nested-JSON text filter (equivalent SQL: `WHERE memory->'commerce'->>'cart' = $1`). Read-merge-write preserves other `memory` keys (`cus`, `region_id`, `write_count`, …) — do NOT overwrite the whole `commerce` object. `.limit(1)` guards against `maybeSingle()` throwing if two conversations ever share a cart.

### Pattern 6: `spec.ts` TRIGGERS
Registration is a static entry in the `TRIGGERS: TriggerSpec[]` array. The `type` field carries the `event:` prefix; the runtime `trigger_config.event` value does NOT (note the two forms — `event:lead.captured` in the spec vs `{event:'lead.captured'}` in the query). Add, mirroring `event:lead.captured`:
```ts
{
  type: 'event:commerce.order.placed',
  description: 'A Medusa order was placed and pushed from the connected store. Exposes order totals, line items, and the resolved contact.',
  variables: ['order.*', 'contact.*', 'trigger.fired_at'],
},
{
  type: 'event:commerce.customer.created',
  description: 'A new Medusa customer was created and pushed from the connected store.',
  variables: ['customer.*', 'contact.*', 'trigger.fired_at'],
},
```
Optionally extend `VARIABLE_NAMESPACES` with `order:` and `customer:` descriptions (nice for Copilot; not load-bearing). These are platform-level triggers (no `integration_required` filtering — TRIGGERS are static, unlike NODES which are org-filtered).

### Anti-Patterns to Avoid
- **Overwriting `memory.commerce` wholesale** on annotation — clobbers the pinned cart/cus/region. Always spread-merge.
- **Dividing money by 100** — see Pitfall 2.
- **Adding a `commerce`/`medusa` value to `contacts.source` CHECK** — CONTEXT forbids new enum values; use `'api'`.
- **Re-implementing dedupe with a manual SELECT + payload-hash 409** — commerce has no "same id, different payload → conflict" rule (unlike leads). Insert-then-catch-`23505` is the chosen, simpler path.
- **Emitting workflows on a duplicate** — 200 duplicates must NOT re-dispatch (the whole point of the ledger).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Idempotency / dedupe | Custom in-memory or hash-based replay cache | `UNIQUE(org_id,event_id)` + catch `23505` | DB-enforced, survives restarts, race-safe. Replay cache is explicitly deferred (EVI-04). |
| Bearer auth + scope | New token parsing | `verifyApiKey(req, sb, 'commerce:events')` | Already handles 401/403, SHA-256 hash lookup, revoked filter. |
| Workflow dispatch | New event bus | `emitLeadCaptured`'s block (workflows query + `event_dispatches` + `runFlow`/`runFlowSync`) | Wait-node handling, audit trail, resume-waits are all subtle and already correct. |
| RLS policy wording | New policy from scratch | Copy `lead_ingestions_org_isolation` verbatim | `get_current_org_id()` SECURITY-DEFINER pattern is the repo standard. |
| Contact matching | New matcher | `ingestLead`'s `findContact` (by `email_normalized`, org-scoped, skip `archived_duplicate`) | Identity dedupe logic already tuned. |
| DB types | `supabase gen types` for one table | Hand-add a `commerce_event_receipts` block to `database.ts` mirroring `lead_ingestions` | `database.ts` is hand-maintained (8,122 lines); a full regen risks churn. Add the one block. |

**Key insight:** the phase's entire value is *fidelity to existing patterns*. The riskiest thing an executor can do is "improve" the clone.

## Common Pitfalls

### Pitfall 1: The pinned cart key is `cart`, not `cart_id` (CONTRADICTS THE LOCKED DECISION)
**What goes wrong:** Following the CONTEXT decision literally (`memory.commerce->>'cart_id'`) makes the annotation query match **zero** conversations — every order.placed silently fails to link back, and `last_order_display_id` is never written. Tests that mock the query would also encode the wrong key and pass, hiding the bug until live.
**Why it happens:** Phase 133 renamed the pinned key to `cart` (contract §3 claim name). Confirmed in shipped code:
- `src/lib/medusa/context.ts` L119: `cart: claims.cart, // key actions/get-cart.ts reads (commerce.cart) — keep this exact key.`
- `src/lib/medusa/actions/get-cart.ts` L33: `const cartId = typeof commerce.cart === 'string' ? commerce.cart : undefined`
- `src/lib/medusa/actions/add-to-cart.ts` L117 and `pinCartId` L175 both use `commerce.cart`.
**How to avoid:** Filter on `memory->commerce->>cart`. The webhook payload field is still `cart_id` (contract §5) — the mismatch is key-name only; the value is the same `cart_...` id. Document this in the code with a comment.
**Warning signs:** annotation never fires in a live smoke test; conversation `memory.commerce` shows a `cart` key but the query used `cart_id`.

### Pitfall 2: Money is in MAJOR units — never divide by 100
**What goes wrong:** Treating `total`/`unit_price` as cents (a reflex from Stripe/older Medusa) and dividing by 100 corrupts every figure surfaced to workflows/contacts.
**Why it happens:** Contract v1.1 correction: Medusa v2 returns `total`/`items.unit_price` in major units (`35` = €35.00, `123.45` = €123.45). The stuscle sender passes them through unconverted.
**How to avoid:** zod types them as `z.number()` with **no transform**. Store and forward verbatim. Add a code comment: `// MAJOR units — contract §5 v1.1; do NOT divide by 100`.

### Pitfall 3: Body `type` ≠ workflow event name
**What goes wrong:** Querying `workflows` with `{event:'order.placed'}` matches nothing — the workflow trigger event is `commerce.order.placed`.
**Why it happens:** The webhook body `type` (`order.placed`/`customer.created`) and the workflow trigger event (`commerce.order.placed`/`commerce.customer.created`) are different namespaces.
**How to avoid:** One explicit map: `const WF_EVENT = { 'order.placed':'commerce.order.placed', 'customer.created':'commerce.customer.created' }[type]`. Use `WF_EVENT` for the workflows query, `event_dispatches.event_type`, `trigger_config @> {event}`, and `spec.ts` (as `event:${WF_EVENT}`).

### Pitfall 4: `maybeSingle()` throws on >1 row
**What goes wrong:** If two conversations ever pin the same cart, `.maybeSingle()` rejects, and (if unguarded) bubbles into the emit try/catch as a swallowed error — annotation silently skipped.
**How to avoid:** `.order('last_active_at',{ascending:false}).limit(1).maybeSingle()`.

### Pitfall 5: Duplicate must not re-dispatch
**What goes wrong:** Calling `emitCommerceEvent` before checking the insert result re-fires workflows on every sender retry.
**How to avoid:** `insertCommerceReceipt` returns `{duplicate:true}` on `23505`; the route returns 200 and **skips emit entirely**. Only the first (accepted) insert emits. This is verified in the route test (`emit` NOT called on duplicate — mirror `leads-route-events.test.ts` L75-87).

### Pitfall 6: 413 / 429 are extra-contractual (minor)
**What goes wrong:** The contract §5 enumerates only 201/200/401/403/422. The cloned skeleton adds **413** (oversize body) and this phase adds **429** (R12). These are harmless — the trusted stuscle sender never sends >64KB and R12 failMode `'open'` never denies when Redis is down — but note the divergence.
**How to avoid:** Keep 413 (mirrors leads, cheap guard) and 429 (R12 is a locked decision + §7 requirement). The sender treats any non-2xx as retryable; dedupe makes retries safe. Flagged as an accepted, documented divergence — do not "fix" by removing R12.

### Pitfall 7: zod `.strict()` vs forward-compat
**What goes wrong:** `.strict()` on `data` rejects a body carrying a future field (e.g. a v2 addition), 422-ing legitimate events.
**Why it happens:** The contract is FROZEN with a "change the contract first" rule, so strict is defensible — but a mid-flight contract bump would break until both sides deploy.
**How to avoid:** Recommend `.strict()` on the **envelope** (`event_id`/`type`/`occurred_at`/`data`) to catch producer-controlled identity injection (mirrors the leads test that rejects a stray `org_id`), and `.strip()`/default (non-strict) on the inner `data` object for forward-compat. Minor decision — flag for the planner.

## Code Examples

### `commerceEventSchema` (mirror `leads/ingestion-schema.ts`)
```ts
// src/lib/commerce/ingestion-schema.ts
import { z } from 'zod'

const nullableText = (max: number) => z.string().trim().max(max).nullable().optional()

const orderData = z.object({
  order_id: z.string().trim().min(1).max(100),
  display_id: z.number().int(),
  email: z.string().trim().min(1).max(320),          // loose, like leads — no .email()
  currency_code: z.string().trim().min(1).max(10),
  total: z.number(),                                  // MAJOR units — no transform, never /100
  cart_id: z.string().trim().min(1).max(100).nullable(), // may be null for non-cart orders
  items: z.array(z.object({
    title: z.string().trim().max(500),
    variant_id: nullableText(100),
    quantity: z.number().int().min(0),
    unit_price: z.number(),                           // MAJOR units
  })).max(200),
})

const customerData = z.object({
  customer_id: z.string().trim().min(1).max(100),
  email: z.string().trim().min(1).max(320),
  first_name: nullableText(200),
  last_name: nullableText(200),
})

export const commerceEventSchema = z.discriminatedUnion('type', [
  z.object({
    event_id: z.string().trim().min(1).max(300),
    type: z.literal('order.placed'),
    occurred_at: z.string().datetime({ offset: true }),
    data: orderData,
  }).strict(),
  z.object({
    event_id: z.string().trim().min(1).max(300),
    type: z.literal('customer.created'),
    occurred_at: z.string().datetime({ offset: true }),
    data: customerData,
  }).strict(),
])

export type CommerceEventPayload = z.infer<typeof commerceEventSchema>
```

### `insertCommerceReceipt` (dedupe via `23505`)
```ts
// src/lib/commerce/receipts.ts
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database, Json } from '@/types/database'
import type { CommerceEventPayload } from './ingestion-schema'

type ServiceClient = SupabaseClient<Database>
export type CommerceReceiptResult = { receiptId: string; duplicate: false } | { duplicate: true }

export async function insertCommerceReceipt(
  supabase: ServiceClient, orgId: string, payload: CommerceEventPayload,
): Promise<CommerceReceiptResult> {
  const { data, error } = await supabase
    .from('commerce_event_receipts')
    .insert({
      org_id: orgId,
      event_id: payload.event_id,
      type: payload.type,
      payload: payload as unknown as Json,
    })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') return { duplicate: true }  // UNIQUE(org_id,event_id) — replay
    throw error
  }
  return { receiptId: data!.id, duplicate: false }
}
```
(Postgres unique-violation code `23505` confirmed in `tests/leads-ingest-service.test.ts` L59.)

### `database.ts` block (hand-add, mirror `lead_ingestions`)
```ts
commerce_event_receipts: {
  Row:    { id: string; org_id: string; event_id: string; type: string; payload: Json; created_at: string }
  Insert: { id?: string; org_id: string; event_id: string; type: string; payload: Json; created_at?: string }
  Update: { payload?: Json }
  Relationships: [{
    foreignKeyName: 'commerce_event_receipts_org_id_fkey'
    columns: ['org_id']; isOneToOne: false
    referencedRelation: 'organizations'; referencedColumns: ['id']
  }]
}
```

## Runtime State Inventory

Not applicable — this is an additive feature phase (new table, new route, new module). No rename/refactor/migration of existing runtime state. The only new stored state is the `commerce_event_receipts` table this phase creates.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `cart_id` as the pinned conversation key | `cart` (contract §3 claim name) | Phase 133 (in-repo) | Annotation query must use `memory->commerce->>cart`. See Pitfall 1. |
| Medusa money in minor units (cents) | Major units (decimal) for `total`/`unit_price` | Contract v1.1 correction | Never divide by 100. See Pitfall 2. |

**Deprecated/outdated:** none relevant. The HMAC-signed webhook + replay cache is a *future* upgrade (EVI-04), not a current standard to adopt.

## Open Questions

1. **`contacts.lifecycle_stage` for order.placed contacts** — `'lead'` (mirrors `ingestLead`) or `'customer'` (semantically truer for a paid order)?
   - What we know: `contacts.lifecycle_stage` accepts `prospect|lead|opportunity|customer|lost|archived` (per `update_contact` node enum in `spec.ts`).
   - Recommendation: `'customer'` for `order.placed`, `'lead'` for `customer.created` (a created-but-not-purchased customer). Low risk; planner's call.

2. **Fire generic `contact.created` too?** The leads route fires `emitContactEvent(orgId,'contact.created',...)` in addition to the domain event when a contact is newly created.
   - Recommendation: mirror it (fire `contact.created` on new-contact creation) for consistency — a commerce-created contact is still a new contact and any `contact.created` workflow should see it. Discretionary; flag that it means two dispatches for a brand-new customer.

3. **`.strict()` on inner `data`?** — see Pitfall 7. Recommend strict envelope, lenient `data`. Planner decision.

4. **Optional expression index** for the cart lookup: `CREATE INDEX ... ON conversations ((memory->'commerce'->>'cart')) WHERE ...`. Not required (org-scoped conversation counts are modest), but note it if annotation latency ever matters. Out of scope unless the planner wants it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js + npm | build/test | ✓ (repo runs `npm run build`/`npm test`) | Next.js 16 / TS5 | — |
| vitest | Docker-free unit tests | ✓ (`tests/`, `vitest.config.ts`) | configured | — |
| zod | schema | ✓ (already a dep) | — | — |
| Supabase CLI | apply migration `1260` to remote (`npx supabase db push`) | Assumed (used repo-wide per CLAUDE.md) | — | Apply SQL via MCP `apply_migration` if CLI unavailable |
| Live Supabase Postgres | real UNIQUE/RLS enforcement, real workflow run | Not needed for this phase's tests | — | Mock supabase (all Phase 136 tests are mock-based; live checks deferred to a manual smoke) |

**Missing dependencies with no fallback:** none — the entire phase is unit-testable with a mocked supabase client. No Docker, no Redis (R12 uses failMode `'open'`), no live DB required to land + verify the phase.

## Validation Architecture

*(Nyquist enabled — all tests are Docker-free / mock-supabase.)*

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (node env, `globals:true`) |
| Config file | `vitest.config.ts` (include `tests/**/*.test.ts`; `@` → `src`; `server-only` stubbed) |
| Quick run command | `npx vitest run tests/commerce-events-route.test.ts tests/commerce-events-schema.test.ts` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| EVI-01 | zod accepts valid order.placed & customer.created; rejects unknown envelope field; rejects wrong `type`; money stays major (no /100) | unit | `npx vitest run tests/commerce-events-schema.test.ts` | ❌ Wave 0 |
| EVI-01 | 201 `{receipt_id}` on new event (emit called once) | unit (mock supabase+service) | `npx vitest run tests/commerce-events-route.test.ts` | ❌ Wave 0 |
| EVI-01 | 401 (no/invalid Bearer) & 403 (missing scope) via mocked `verifyApiKey` | unit | same file | ❌ Wave 0 |
| EVI-01 | 422 on invalid body & 422 on `Idempotency-Key !== event_id` | unit | same file | ❌ Wave 0 |
| EVI-02 | duplicate (`23505`) → 200 `{duplicate:true}`, emit NOT called | unit | `tests/commerce-events-route.test.ts` (route) + `tests/commerce-receipts-service.test.ts` (in-memory dedupe) | ❌ Wave 0 |
| EVI-02 | migration file exists & contains `UNIQUE (org_id, event_id)` + RLS policy | unit (file-content assert) | `npx vitest run tests/commerce-events-schema.test.ts` (or a `migration-presence` test) | ❌ Wave 0 |
| EVI-03 | emit issues workflows query with `trigger_type='event'`, `health_blocked=false`, `trigger_config @> {event: commerce.*}`; inserts `event_dispatches`; order.placed runs annotation query filtered on `memory->commerce->>cart`; customer.created does NOT | unit (spy supabase) | `npx vitest run tests/commerce-events-emit.test.ts` | ❌ Wave 0 |
| EVI-03 | `spec.ts` TRIGGERS include `event:commerce.order.placed` & `event:commerce.customer.created` | unit | `tests/commerce-events-emit.test.ts` (import TRIGGERS) or extend `tests/event-types-actions.test.ts` | ❌ Wave 0 |

**Mock patterns to copy:**
- Route test → `tests/leads-route-events.test.ts` (`vi.hoisted` + `vi.mock('@/lib/supabase/admin')`, `vi.mock('@/lib/api-keys/verify')`, `vi.mock('@/lib/commerce/receipts')`, `vi.mock('@/lib/commerce/events')`, then `import { POST }`). Assert status + that emit mock is/ isn't called.
- Dedupe service test → `tests/leads-ingest-service.test.ts` in-memory `Query` client (already emits `{error:{code:'23505'}}` on duplicate insert — reuse the exact harness).
- Schema test → `tests/leads-ingestion.test.ts` (parse valid, `.toThrow()` on stray field / bad type).
- Emit query-shape test → spy client that records `.eq`/`.contains` filter args; assert the workflows query and the annotation query use the corrected `cart` key.

### Sampling Rate
- **Per task commit:** `npx vitest run tests/commerce-*.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm run build` (type-check, catches the `database.ts` block + scope type) **and** full vitest green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `tests/commerce-events-schema.test.ts` — EVI-01 (zod) + EVI-02 (migration presence)
- [ ] `tests/commerce-receipts-service.test.ts` — EVI-02 (23505 dedupe, org isolation)
- [ ] `tests/commerce-events-route.test.ts` — EVI-01 (201/401/403/422/422-mismatch) + EVI-02 (200 dup, no emit)
- [ ] `tests/commerce-events-emit.test.ts` — EVI-03 (dispatch query shape, annotation `cart` key, TRIGGERS)
- No framework install needed — vitest is configured.

**Deferred to a live-DB smoke (not Docker-free, out of automated scope):** real `UNIQUE(org_id,event_id)` enforcement under concurrency; real RLS; real `runFlow`/`runFlowSync` execution; the end-to-end stuscle→xphere retry-with-same-event_id path (contract §5). Verify manually per the §9 dev-wiring checklist.

## Sources

### Primary (HIGH confidence — in-repo, read directly)
- `src/app/api/v1/leads/route.ts` — route skeleton (auth order, 64KB cap, idempotency compare, response codes, `last_used_at` stamp).
- `src/lib/leads/events.ts` — `emitLeadCaptured` dispatch pattern (workflows query, `event_dispatches`, `runFlow`/`runFlowSync`, `resumeMatchingWaits`).
- `src/lib/leads/ingest.ts` — `ingestLead` find-or-create contact + dedupe logic; `findContact` by `email_normalized`.
- `src/lib/leads/ingestion-schema.ts` — zod conventions (`.strict()`, `nullableText`, `datetime({offset})`).
- `src/lib/api-keys/verify.ts` + `scopes.ts` — `verifyApiKey` 401/403 behavior; `API_KEY_SCOPES` shape.
- `src/lib/medusa/context.ts` (L119) + `actions/get-cart.ts` (L33) + `actions/add-to-cart.ts` (L117) — **prove the pinned key is `cart`**.
- `src/lib/medusa/pinned-context.ts` — `memory.commerce` read shape.
- `supabase/migrations/1214_websites_lead_ingestions.sql` — receipts table + RLS template.
- `supabase/migrations/086_event_dispatches.sql`, `1147_public_api_keys.sql`, `1259_medusa_integration.sql` (latest → next is `1260`).
- `src/types/database.ts` (L532 `lead_ingestions`, L4918 `event_dispatches`, L2507 `conversations` has `memory` + `contact_id`) — hand-maintained type template.
- `src/lib/workflows/spec.ts` — TRIGGERS registration (`event:lead.captured` etc.), `event:` prefix convention.
- `src/lib/rate-limit.ts` — `rateLimit(key,limit,window,{failMode:'open'})`.
- `tests/leads-route-events.test.ts`, `tests/leads-ingest-service.test.ts` (23505 at L59), `tests/leads-ingestion.test.ts`, `vitest.config.ts` — Docker-free mock-supabase test templates.
- `.planning/research/INTEGRATION-CONTRACT.md` §5 (frozen v1.1) — body/headers/responses/money-units.
- `136-CONTEXT.md`, `REQUIREMENTS.md` (EVI-01/02/03), `CLAUDE.md`.

### Secondary (MEDIUM confidence)
- PostgREST nested-JSON filter syntax `.eq('memory->commerce->>cart', v)` — standard PostgREST/supabase-js; corroborated by the repo's own JSONB reads. Verify once against a live query during Wave 0 if any doubt.

### Tertiary (LOW confidence)
- None. No external/unverified claims — the phase is fully specified by in-repo code and the frozen contract.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new deps; all modules read directly.
- Architecture: HIGH — every pattern has a shipped in-repo template.
- Pitfalls: HIGH — the three commerce twists are each verified against shipped code / the frozen contract (not inferred).
- The one MEDIUM item (PostgREST JSON filter string) is low-risk and Wave-0 verifiable.

**Research date:** 2026-07-17
**Valid until:** ~2026-08-16 (30 days — internal patterns are stable; the only churn risk is a contract change, which by rule updates this file first).

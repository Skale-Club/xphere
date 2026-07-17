# Phase 136: Commerce Events Ingestion - Context

**Gathered:** 2026-07-17
**Status:** Ready for planning
**Mode:** Derived from user-approved integration plan (plan-mode session 2026-07-17); discuss not needed

<domain>
## Phase Boundary

Receive `order.placed` / `customer.created` from Medusa idempotently, create/annotate CRM contacts, link back to the originating conversation, and dispatch workflow events. Contract: §5 (exact body/headers/responses).

</domain>

<decisions>
## Implementation Decisions

### Scope + endpoint
- `src/lib/api-keys/scopes.ts`: add `commerce:events` (label "Commerce — events", description "Ingest e-commerce events via POST /api/v1/commerce/events").
- `src/app/api/v1/commerce/events/route.ts` — CLONE the `/api/v1/leads/route.ts` skeleton: 64KB body cap → `verifyApiKey(request, supabase, 'commerce:events')` → zod schema per contract §5 → `Idempotency-Key` header must equal `event_id` (422 otherwise) → receipt insert → emit → stamp `api_keys.last_used_at`. Responses exactly: 201 `{receipt_id}`, 200 `{duplicate:true}`, 401/403, 422. R12 rate limit 600/min/org failMode 'open'.

### Receipts migration (next number)
- `commerce_event_receipts`: `id uuid pk default gen_random_uuid()`, `org_id uuid references organizations`, `event_id text`, `type text`, `payload jsonb`, `created_at timestamptz default now()`, `UNIQUE(org_id, event_id)`, RLS org-isolation read (service-role writes) — mirror an existing receipts-style table's RLS.
- Duplicate detection: rely on the unique violation on insert → 200 duplicate (no re-dispatch).

### Event emission (`src/lib/commerce/events.ts`)
- `emitCommerceEvent(supabase, orgId, receiptId, type, data)` modeled 1:1 on `src/lib/leads/events.ts::emitLeadCaptured`:
  - Find-or-create contact by `data.email` (reuse the ingestLead contact upsert helper if extractable; else same logic). Set source appropriately (add nothing to enums — use existing closest source value or metadata).
  - `order.placed` with `data.cart_id`: find conversation where `memory.commerce->>'cart_id' = data.cart_id` (org-scoped) → merge `memory.commerce.last_order_display_id = data.display_id`; if the conversation lacks `contact_id`, set it to the found/created contact.
  - Dispatch workflows: `trigger_type='event'`, `trigger_config @> {event: 'commerce.order.placed'|'commerce.customer.created'}`, `health_blocked=false` → `event_dispatches` audit row → `runFlow`/`runFlowSync` per `definitionHasWait` (copy the leads dispatch block).
- `src/lib/workflows/spec.ts`: TRIGGERS entries for both events with variable namespaces (`order.*` → display_id, email, total, currency_code, items; `customer.*` → email, first_name, last_name; plus `contact.*`, `trigger.fired_at`).

### Claude's Discretion
- Whether contact timeline note is written (nice, if a lightweight existing helper exists — do not build new UI).
- Test structure: vitest route tests with mocked supabase (201/duplicate 200/bad scope 403/mismatched Idempotency-Key 422) + emit dispatch query shape test.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/api/v1/leads/route.ts` — the end-to-end skeleton (auth, cap, zod, idempotency, emit).
- `src/lib/leads/events.ts::emitLeadCaptured` — dispatch pattern (workflows query, event_dispatches, runFlow/runFlowSync).
- `src/lib/api-keys/verify.ts` + `scopes.ts`.
- `event_dispatches` table (migration 086).

### Established Patterns
- Service-role client; RLS org-isolation policy phrasing from recent migrations.

### Integration Points
- Workflows spec TRIGGERS; conversations `memory.commerce` (Phase 133 shape).

</code_context>

<specifics>
## Specific Ideas

- The stuscle sender retries with the SAME event_id — the unique constraint makes retries safe; never 5xx on duplicates.
- Keep payload stored verbatim in receipts (audit/debug value).

</specifics>

<deferred>
## Deferred Ideas

- HMAC+timestamp upgrade and replay cache (EVI-04/v2); cart.updated + fulfillment events (contract change first).

</deferred>

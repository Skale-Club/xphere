---
phase: 136
slug: commerce-events-ingestion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-17
---

# Phase 136 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (repo standard; mock-supabase, Docker-free — mirrors tests/leads-*.test.ts) |
| **Quick run command** | `CI=true npx vitest run tests/commerce-events-route.test.ts tests/commerce-events-emit.test.ts --reporter=dot` |
| **Full suite** | `npm test` (~58 pre-existing unrelated failures — do NOT gate on it) |
| **Type/build gate** | `npm run build` (also catches the hand-maintained database.ts edit for the new table) |
| **Estimated runtime** | quick < 10s |

---

## CRITICAL facts (from research + contract v1.1)

1. **Route = clone of `src/app/api/v1/leads/route.ts`**: 64KB cap → `verifyApiKey(req, sb, 'commerce:events')` → zod (§5) → `Idempotency-Key === event_id` (422 mismatch) → dedupe insert → emit → stamp `api_keys.last_used_at`. Responses EXACTLY: 201 {receipt_id} / 200 {duplicate:true} / 401 / 403 (missing scope) / 422.
2. **Dedupe** = Postgres `23505` unique-violation on `commerce_event_receipts` UNIQUE(org_id, event_id) → catch → 200 {duplicate:true}, NO re-dispatch (mirror leads-ingest-service dedupe test).
3. **Migration 1260** (next after 1259): `commerce_event_receipts (id uuid pk, org_id uuid fk, event_id text, type text, payload jsonb, created_at)` + UNIQUE(org_id, event_id) + RLS org-isolation (copy 1214_websites_lead_ingestions phrasing). Hand-edit database.ts.
4. **ANNOTATION KEY = `cart`, not `cart_id`**: the payload field is `data.cart_id` but the pinned conversation key is `memory->commerce->>cart` (Phase 133 renamed it). The annotation query filters `memory->commerce->>cart == data.cart_id` (org-scoped), sets `memory.commerce.last_order_display_id` (+ contact_id if null). This CORRECTS 136-CONTEXT's `cart_id` wording.
5. **type → workflow event**: body `type` "order.placed" maps to workflow event `commerce.order.placed` (prefix `commerce.`). `emitCommerceEvent` mirrors `emitLeadCaptured` (trigger_config @> {event}, event_dispatches audit, runFlow/runFlowSync per definitionHasWait, find-or-create contact by data.email).
6. **Money MAJOR units** — receipts store payload verbatim; no /100 anywhere.
7. `commerce:events` scope added to `src/lib/api-keys/scopes.ts` (verifyApiKey already 401/403s — no verify change). R12 600/min/org 'open'.

---

## Sampling Rate

- **After every task commit:** quick run command
- **After every wave:** quick run + `npm run build`
- **Before verify-work:** scoped tests + `npm run build` green
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task | Requirement | Type | Automated Command | Status |
|------|-------------|------|-------------------|--------|
| commerce:events scope + migration 1260 + database.ts | EVI-01, EVI-02 | static+build | grep scope; migration file; `npm run build` | ⬜ |
| route (clone leads: cap/verifyApiKey/zod/idempotency/dedupe → 201/200/401/403/422) | EVI-01, EVI-02 | unit | `vitest run tests/commerce-events-route.test.ts` (mock supabase, 23505 dedupe) | ⬜ |
| emitCommerceEvent (contact find-or-create, cart annotation via `cart` key, workflow dispatch) + spec TRIGGERS | EVI-03 | unit | `vitest run tests/commerce-events-emit.test.ts` (dispatch query shape + annotation filter string) | ⬜ |

*Status: ⬜ pending · ✅ green · ❌ red*

---

## Wave 0 Requirements

- [ ] `tests/commerce-events-route.test.ts` (new) — route responses + dedupe
- [ ] `tests/commerce-events-emit.test.ts` (new) — emit dispatch + `memory->commerce->>cart` annotation filter

---

## Manual-Only / E2E-Deferred

| Behavior | Requirement | Why deferred | Instructions |
|----------|-------------|--------------|--------------|
| Live event → contact + workflow fire + conversation annotation | EVI-01..03 | Needs live Supabase + a real order from stuscle | E2E pass: checkout on stuscle → POST lands → commerce_event_receipts row + event_dispatches + a test workflow fires; replay same event_id → 200 no re-dispatch |

---

## Validation Sign-Off

- [ ] route + emit + migration fully unit-tested Docker-free (mock supabase; 201/200-dup/401/403/422; dedupe; annotation filters `cart` key)
- [ ] MAJOR units preserved (no /100); type→commerce.<type> event mapping
- [ ] No <automated> requires a live DB/Redis
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending

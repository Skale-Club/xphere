---
phase: 136-commerce-events-ingestion
verified: 2026-07-17T20:46:33Z
status: passed
score: 9/9 must-haves verified
requirements:
  - id: EVI-01
    status: satisfied
  - id: EVI-02
    status: satisfied
  - id: EVI-03
    status: satisfied
human_verification:
  - test: "Live event → contact → workflow round trip"
    expected: "Checkout on stuscle → POST lands in commerce_event_receipts → event_dispatches row + test workflow fires + conversation annotated; replay same event_id → 200 duplicate, no re-dispatch"
    why_human: "Requires live Supabase (real UNIQUE constraint + RLS enforcement) and a real Medusa order — E2E-deferred per 136-VALIDATION.md Manual-Only table. All automated (mock-supabase) checks pass."
---

# Phase 136: Commerce Events Ingestion Verification Report

**Phase Goal:** Orders + new customers from Medusa land in xphere idempotently, create/annotate contacts, fire CRM workflows.
**Verified:** 2026-07-17T20:46:33Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | A scoped public endpoint accepts Medusa commerce webhooks behind Bearer auth | ✓ VERIFIED | `route.ts:20` `verifyApiKey(request, supabase, 'commerce:events')`; `scopes.ts:32` registers `commerce:events` |
| 2 | Oversized bodies are rejected before any work (64KB cap) | ✓ VERIFIED | `route.ts:11-17` content-length pre-check + `:33-35` byte re-check, both 413 |
| 3 | Bodies are validated against contract §5 with money in MAJOR units | ✓ VERIFIED | `ingestion-schema.ts` discriminated union, strict envelope, `total`/`unit_price` bare `z.number()` (no transform) |
| 4 | Idempotency-Key must equal event_id or request is rejected | ✓ VERIFIED | `route.ts:48-54` trims header, 422 on missing/mismatch |
| 5 | Events persist idempotently — replays return 200 with no re-dispatch | ✓ VERIFIED | `receipts.ts:22-23` catches 23505 → `{duplicate:true}`; `route.ts:58` emit only on `!result.duplicate`; migration UNIQUE(org_id,event_id) |
| 6 | Contract-exact status map (201/200/401/403/422) | ✓ VERIFIED | `route.ts` returns 201 `{receipt_id}`, 200 `{duplicate:true}`, 401/403 from verifyApiKey, 422 (body + idempotency); tests cover all 9 cases |
| 7 | Contacts are found-or-created by email on ingest | ✓ VERIFIED | `events.ts:73-118` maybeSingle by `email_normalized`, insert + `emitContactEvent('contact.created')` |
| 8 | Originating conversation is annotated via the pinned `cart` key | ✓ VERIFIED | `events.ts:156` filters `memory->commerce->>cart` == `order.cart_id`; sets `last_order_display_id` + `contact_id` if null; `>>cart_id` NOT present anywhere |
| 9 | Matching CRM workflows dispatch with an event_dispatches audit trail | ✓ VERIFIED | `events.ts:121-146` `trigger_config @> {event}` + event_dispatches insert; `spec.ts:84,89` TRIGGERS for both commerce events |

**Score:** 9/9 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `src/lib/api-keys/scopes.ts` | `commerce:events` scope | ✓ VERIFIED | Line 32, imported by route + settings UI |
| `src/app/api/v1/commerce/events/route.ts` | Full ingestion route | ✓ VERIFIED | 82 lines; wired end-to-end; registered in build as `ƒ /api/v1/commerce/events` |
| `src/lib/commerce/ingestion-schema.ts` | §5 zod validator, MAJOR units | ✓ VERIFIED | Discriminated union, strict envelope, no /100 |
| `src/lib/commerce/receipts.ts` | insert-then-catch-23505 dedupe | ✓ VERIFIED | One-round-trip, no SELECT-first |
| `supabase/migrations/1260_commerce_event_receipts.sql` | UNIQUE + RLS | ✓ VERIFIED | UNIQUE(org_id,event_id) + org-isolation RLS + FK cascade |
| `src/types/database.ts` | Hand-maintained table types | ✓ VERIFIED | Row/Insert/Update/Relationships block at 2507; build type-checks clean |
| `src/lib/commerce/events.ts` | emitCommerceEvent dispatcher | ✓ VERIFIED | 246 lines; mirrors emitLeadCaptured; never throws |
| `src/lib/workflows/spec.ts` | commerce TRIGGERS | ✓ VERIFIED | `event:commerce.order.placed` + `event:commerce.customer.created` |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| route.ts | verifyApiKey | `verifyApiKey(request, supabase, 'commerce:events')` | ✓ WIRED | 401/403 forwarded verbatim |
| route.ts | insertCommerceReceipt | `await insertCommerceReceipt(...)` | ✓ WIRED | result.duplicate branches responses |
| route.ts | emitCommerceEvent | `await emitCommerceEvent(...)` on fresh insert only | ✓ WIRED | Skipped on duplicate (no re-dispatch) |
| receipts.ts | commerce_event_receipts | `.insert().select('id').single()` + 23505 catch | ✓ WIRED | DB-unique dedupe |
| events.ts | conversations | `.eq('memory->commerce->>cart', order.cart_id)` | ✓ WIRED | Correct `cart` key (NOT cart_id) |
| events.ts | workflows | `.contains('trigger_config', { event: WF_EVENT })` | ✓ WIRED | `commerce.<type>` mapping via WF_EVENT_MAP |
| events.ts | event_dispatches | `.insert({ event_type, source_table, workflow_ids, payload })` | ✓ WIRED | Audited regardless of match count |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| route.ts | `payload` | `commerceEventSchema.parse(JSON.parse(rawText))` from request body | Yes — verbatim webhook body, MAJOR units | ✓ FLOWING |
| receipts.ts | `result.receiptId` | Supabase insert returning `id` | Yes — real row id | ✓ FLOWING |
| events.ts | `matchedRows` | `workflows` query filtered on org + trigger_config | Yes — real org workflows | ✓ FLOWING |
| events.ts | annotation `memory` | conversations row spread-merged with `last_order_display_id` | Yes — no clobber of pinned keys | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Route + dedupe + auth/scope/413/429/422 status map | `vitest run tests/commerce-events-route.test.ts` | 9 cases pass | ✓ PASS |
| Emit dispatch + `cart` annotation filter + TRIGGERS | `vitest run tests/commerce-events-emit.test.ts` | 12 assertions pass | ✓ PASS |
| §5 schema (MAJOR units, strict envelope) | `vitest run tests/commerce-events-schema.test.ts` | pass | ✓ PASS |
| 23505 dedupe + org isolation | `vitest run tests/commerce-receipts-service.test.ts` | pass | ✓ PASS |
| All four files together | `CI=true npx vitest run <4 files> --reporter=dot` | 4 files, 33 tests passed | ✓ PASS |
| Type/build gate (hand-maintained database.ts) | `npm run build` | Compiled successfully; route registered | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| EVI-01 | 136-01, 136-03 | `commerce:events` scope + route (64KB, Bearer, Idempotency===event_id, zod, 201/200/401/403/422) | ✓ SATISFIED | scopes.ts + route.ts + 9 passing route tests |
| EVI-02 | 136-01 | `commerce_event_receipts` migration (UNIQUE, RLS); duplicates → 200 no re-dispatch | ✓ SATISFIED | migration 1260 + receipts.ts 23505 catch + database.ts types |
| EVI-03 | 136-02 | `emitCommerceEvent` — contact find-or-create, conversation annotation, workflow dispatch + audit + spec.ts TRIGGERS | ✓ SATISFIED | events.ts + spec.ts TRIGGERS + 12 passing emit tests |

No orphaned requirements — REQUIREMENTS.md maps EVI-01/02/03 to Phase 136 and all three are claimed by the plans and marked `[x]`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None | — | No TODO/FIXME/placeholder/stub; no money division (`/100`) anywhere in commerce lib or route |

### Human Verification Required

**1. Live event → contact → workflow round trip**

**Test:** Checkout on stuscle → `POST /api/v1/commerce/events` with a real order → confirm a `commerce_event_receipts` row, an `event_dispatches` row, and a test workflow firing; confirm the originating conversation is annotated with `last_order_display_id`. Then replay the same `event_id`.
**Expected:** First call 201 `{receipt_id}`; replay 200 `{duplicate:true}` with NO second dispatch.
**Why human:** Requires live Supabase (real Postgres UNIQUE-constraint + RLS enforcement) and a real Medusa order. E2E-deferred by design per 136-VALIDATION.md Manual-Only table — migration 1260 has not been applied to any remote DB in this environment. All automated (mock-supabase) equivalents pass.

### Gaps Summary

No gaps. All 9 observable truths verified against the actual codebase, all 8 artifacts pass levels 1-4 (exist, substantive, wired, data-flowing), all 7 key links wired, and all 33 mock-supabase tests plus the `npm run build` type/build gate pass. The critical annotation-key check confirmed: the filter uses `memory->commerce->>cart` (the Phase-133-pinned key) and the incorrect `>>cart_id` appears nowhere. Money stays in MAJOR units throughout (no `/100`). The only outstanding item is the live end-to-end round trip, which is intentionally E2E-deferred (needs live Supabase + a real stuscle order) and routed to human verification — not a defect.

---

_Verified: 2026-07-17T20:46:33Z_
_Verifier: Claude (gsd-verifier)_

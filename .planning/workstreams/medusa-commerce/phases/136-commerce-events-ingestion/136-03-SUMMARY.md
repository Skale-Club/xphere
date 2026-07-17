---
phase: 136-commerce-events-ingestion
plan: 03
subsystem: api
tags: [zod, supabase, rate-limit, idempotency, medusa, webhooks, rest-api]

# Dependency graph
requires:
  - phase: 136-commerce-events-ingestion (136-01)
    provides: commerce:events scope, commerce_event_receipts ledger, commerceEventSchema, insertCommerceReceipt
  - phase: 136-commerce-events-ingestion (136-02)
    provides: emitCommerceEvent dispatch layer + spec.ts TRIGGERS
provides:
  - "POST /api/v1/commerce/events route (contract §5): 64KB cap, Bearer + commerce:events scope, R12 rate limit, zod validation, Idempotency-Key===event_id, dedupe, workflow dispatch"
affects: [137-product-cards-order-status]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Route composition mirrors leads/route.ts skeleton exactly (413 guard -> auth -> rate-limit -> parse -> idempotency -> persist/dispatch -> stamp -> respond), diverging only at the dedupe/response branch (no 409 conflict path — commerce dedupe is DB-unique-only)"

key-files:
  created:
    - src/app/api/v1/commerce/events/route.ts
    - tests/commerce-events-route.test.ts
  modified: []

key-decisions:
  - "Cast payload.data to CommerceOrderData | CommerceCustomerData at the emitCommerceEvent call site — zod's items[].variant_id (nullable().optional()) infers as string|null|undefined, but the events.ts CommerceOrderItem interface (deliberately kept independent of ingestion-schema.ts per 136-02) declares it as string|null (required, non-optional key). The value itself is never actually undefined once the envelope parses (the field is always present in the validated shape); the cast is a type-only widening, not a runtime risk. Verified with npx tsc --noEmit before and after (error present pre-cast, gone post-cast) and confirmed npm run build is clean."

patterns-established:
  - "Public REST API routes composing a Wave-1 data layer + Wave-2 dispatch layer follow: content-length guard -> verifyApiKey(scope) -> org-keyed rate limit -> byte-recheck + zod parse -> Idempotency-Key===event_id -> persist (dedupe) -> dispatch only on fresh insert -> stamp last_used_at -> contract-exact status/body."

requirements-completed: [EVI-01, EVI-02]

# Metrics
duration: 14min
completed: 2026-07-17
---

# Phase 136 Plan 03: Commerce Events Route Composition Summary

**`POST /api/v1/commerce/events` — a clone of the leads route skeleton composing the 136-01 scope/schema/receipts and 136-02 emitter behind Bearer auth, an org-keyed R12 rate limit, and an Idempotency-Key===event_id guard, returning contract-exact 201/200-duplicate/401/403/422.**

## Performance

- **Duration:** 14 min
- **Started:** 2026-07-17T20:20:19Z
- **Completed:** 2026-07-17T20:34:11Z
- **Tasks:** 2
- **Files modified:** 2 (2 created)

## Accomplishments
- Built `src/app/api/v1/commerce/events/route.ts`: 64KB body cap (content-length pre-check + byte re-check after read) → `verifyApiKey(request, supabase, 'commerce:events')` (401/403 forwarded verbatim) → R12 rate limit (`commerce:evt:{orgId}` 600/60, `failMode: 'open'`, gated AFTER auth) → `commerceEventSchema.parse` (422 with zod details on failure) → `Idempotency-Key` header trimmed and compared against `payload.event_id` (422 on missing/mismatch) → `insertCommerceReceipt` (insert-then-catch-23505 dedupe from 136-01) → `emitCommerceEvent` (136-02) called ONLY on a fresh, non-duplicate insert → `api_keys.last_used_at` stamped → `runtime = 'nodejs'`
- Proved the full contract status map with a mock-supabase test suite (9 cases): 201 new event (emit called once with the exact contact/type/data arguments), 200 duplicate (emit NOT called — the no-re-dispatch guarantee), 422 invalid body, 422 idempotency mismatch, 422 missing idempotency header, 401 invalid/missing Bearer, 403 insufficient scope, 429 R12 exhausted, 413 oversized content-length (guard runs before `verifyApiKey` is ever invoked)
- Full Phase 136 mock-supabase suite (33 tests across `tests/commerce-events-route.test.ts`, `tests/commerce-events-emit.test.ts`, `tests/commerce-events-schema.test.ts`, `tests/commerce-receipts-service.test.ts`) green; `npm run build` clean

## Task Commits

Each task was committed atomically (Task 1 was TDD: `test` → `feat`):

1. **Task 1 RED: failing test for core status/dedupe cases** - `f27c5c01` (test)
1. **Task 1 GREEN: implement the route** - `06cf391a` (feat)
2. **Task 2: auth/scope/rate-limit/413 route cases + phase build gate** - `fe06eb53` (test)

**Plan metadata:** (pending — see final commit)

## Files Created/Modified
- `src/app/api/v1/commerce/events/route.ts` - `POST` handler composing verifyApiKey + R12 + commerceEventSchema + insertCommerceReceipt + emitCommerceEvent; exports `POST` and `runtime`
- `tests/commerce-events-route.test.ts` - mock-supabase route status map: 201 / 200-dup(no emit) / 401 / 403 / 422(body) / 422(idempotency mismatch) / 422(idempotency missing) / 429 / 413

## Decisions Made
- Kept R12's rate-limit key as `commerce:evt:{orgId}` exactly as specified in the plan's `<interfaces>` (org-keyed, not per-key or per-IP), gated strictly after auth so an invalid Bearer never consumes budget.
- No 409/conflict branch exists in this route (unlike leads' `LeadIngestionConflictError`) — commerce dedupe is entirely DB-unique-violation-based (136-01's `insertCommerceReceipt`), so the only non-2xx persistence-layer outcome is the generic `500 ingestion_failed` catch-all mirrored from leads' pattern.
- Cast `payload.data` to `CommerceOrderData | CommerceCustomerData` at the `emitCommerceEvent` call site (see Deviations) rather than modifying either 136-01's zod schema or 136-02's interfaces, keeping both Wave-1 files untouched and the fix scoped to this plan's one new file.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] `npm run build` failed on payload.data → emitCommerceEvent argument type mismatch**
- **Found during:** Task 2 (phase build gate — `npm run build`)
- **Issue:** `commerceEventSchema`'s `items[].variant_id` is `z.string().trim().max(100).nullable().optional()`, which zod infers as `string | null | undefined`. `events.ts`'s `CommerceOrderItem.variant_id` (136-02, deliberately independent of `ingestion-schema.ts`) declares the same field as `string | null` — required key, no `undefined` allowed. Calling `emitCommerceEvent(supabase, auth.key.orgId, result.receiptId, payload.type, payload.data)` verbatim, as the plan's `<interfaces>` order-of-operations specifies, failed `tsc`/`next build` type-checking with TS2345 (`payload.data` union not assignable to `CommerceOrderData | CommerceCustomerData`) even though `vitest` (which doesn't type-check) passed cleanly.
- **Fix:** Imported `CommerceOrderData`/`CommerceCustomerData` as types from `@/lib/commerce/events` and cast `payload.data as CommerceOrderData | CommerceCustomerData` at the call site, with an inline comment explaining the cast is type-only (the field is always present post-parse; only its value may be `null`, never `undefined`).
- **Files modified:** src/app/api/v1/commerce/events/route.ts
- **Verification:** `npx tsc --noEmit` showed the TS2345 error at `route.ts(59,89)` before the fix and zero errors on that file after; `npm run build` exits 0 with `/api/v1/commerce/events` listed in the route output.
- **Committed in:** 06cf391a (Task 1 GREEN commit — caught and fixed before the commit, so the fix is baked into the single feat commit, not a separate one)

---

**Total deviations:** 1 auto-fixed (1 bug — type-only mismatch between two Wave-1 plans' independently-declared shapes for the same wire data, surfaced only by the strict `npm run build` type-check, not by the vitest suite).
**Impact on plan:** No scope creep — the fix is a single local cast plus a `type`-only import in the one new file this plan owns; neither 136-01's schema nor 136-02's interfaces were touched, preserving both Wave-1 plans' "structurally independent" design intent.

## Issues Encountered
None beyond the documented deviation above.

## User Setup Required
None - no external service configuration required. This route is fully testable with mocked supabase/rate-limit/receipts/emit modules; the live end-to-end path (real Postgres unique-constraint enforcement, real RLS, real workflow fire, real conversation annotation) remains E2E-deferred per 136-VALIDATION.md's Manual-Only table, to be exercised once xphere + stuscle run together against a real database.

## Next Phase Readiness
- **Phase 136 (Commerce Events Ingestion) is complete** — EVI-01, EVI-02, and EVI-03 are all satisfied end-to-end: the `commerce:events` scope, the `commerce_event_receipts` idempotency ledger + RLS, `commerceEventSchema`, `insertCommerceReceipt`, `emitCommerceEvent`, the `spec.ts` TRIGGERS, and now this route composing all of it behind contract-exact HTTP semantics.
- Migration 1260 has still NOT been applied to any remote database in this environment (`npx supabase db push` remains a manual/E2E step, unchanged from 136-01).
- Ready for Phase 137 (Product Cards & Order Status), which depends on both Phase 134 and Phase 136.

---
*Phase: 136-commerce-events-ingestion*
*Completed: 2026-07-17*

## Self-Check: PASSED

Both created files verified present on disk (`src/app/api/v1/commerce/events/route.ts`, `tests/commerce-events-route.test.ts`); all 3 task commit hashes (f27c5c01, 06cf391a, fe06eb53) verified present in git log.

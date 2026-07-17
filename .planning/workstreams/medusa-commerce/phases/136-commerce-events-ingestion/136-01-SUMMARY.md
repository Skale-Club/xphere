---
phase: 136-commerce-events-ingestion
plan: 01
subsystem: api
tags: [zod, supabase, rls, idempotency, medusa, webhooks]

# Dependency graph
requires:
  - phase: 135-medusa-agent-surface
    provides: XPHERE_CONNECTION_TOKEN / integrations row / commerce tool wiring
provides:
  - commerce:events API key scope
  - commerce_event_receipts idempotency ledger (migration 1260, UNIQUE(org_id,event_id) + RLS)
  - commerceEventSchema zod validator (contract §5, discriminated union, MAJOR units)
  - insertCommerceReceipt service (insert-then-catch-23505 dedupe)
affects: [136-02-emit-dispatch, 136-03-route]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Insert-then-catch-23505 dedupe (no SELECT-first, no payload-hash 409)"
    - "Strict envelope / lenient inner-data zod schema for forward-compat webhook contracts"

key-files:
  created:
    - src/lib/commerce/ingestion-schema.ts
    - src/lib/commerce/receipts.ts
    - supabase/migrations/1260_commerce_event_receipts.sql
    - tests/commerce-events-schema.test.ts
    - tests/commerce-receipts-service.test.ts
  modified:
    - src/lib/api-keys/scopes.ts
    - src/types/database.ts

key-decisions:
  - "Reworded the plan's suggested '/100' code comments to avoid literal-string collision with the plan's own forbidden-pattern grep (grep -niE \"/ ?100|/100\" would have matched the comment text itself); intent (never divide money) preserved."
  - "commerce_event_receipts placed immediately before the conversations block in database.ts per the plan's alphabetical-placement instruction (the file is not globally alphabetized, but this keeps the instruction's intent)."

patterns-established:
  - "Commerce event ingestion data layer mirrors the leads ingestion data layer 1:1, differing only in dedupe strategy (DB-unique-violation-only, no payload hash) and money-unit handling (MAJOR units, no cents conversion)."

requirements-completed: [EVI-01, EVI-02]

# Metrics
duration: 35min
completed: 2026-07-17
---

# Phase 136 Plan 01: Commerce Events Data & Persistence Layer Summary

**`commerce:events` API scope, `commerce_event_receipts` idempotency ledger (migration 1260 + RLS), a §5 zod contract validator that keeps money in MAJOR units, and an insert-then-catch-23505 dedupe service — the full data layer for inbound Medusa commerce webhooks.**

## Performance

- **Duration:** 35 min
- **Started:** 2026-07-17T15:51:00Z
- **Completed:** 2026-07-17T15:58:30Z
- **Tasks:** 3
- **Files modified:** 7 (2 modified, 5 created)

## Accomplishments
- Registered the `commerce:events` API key scope (zero changes needed to `verify.ts` — `ApiKeyScope` derives from the array automatically)
- Shipped migration `1260_commerce_event_receipts.sql`: `UNIQUE(org_id, event_id)` idempotency ledger with org-isolation RLS copied verbatim from the `lead_ingestions` template, plus a hand-added `database.ts` type block so `.from('commerce_event_receipts')` type-checks
- Built `commerceEventSchema`, a discriminated-union zod validator for contract §5's `order.placed` / `customer.created` envelopes — strict on the envelope (blocks producer-controlled field injection), lenient on inner `data` (forward-compat), and money (`total`, `unit_price`) typed as bare `z.number()` with no transform
- Built `insertCommerceReceipt`, a one-round-trip insert-then-catch-`23505` dedupe service (no SELECT-first, no payload-hash conflict logic — commerce has no "same id different payload" rule)

## Task Commits

Each task was committed atomically (TDD tasks produced RED + GREEN commits):

1. **Task 1: commerce:events scope + migration 1260 + database.ts type block** - `37f5807a` (feat)
2. **Task 2 RED: failing test for commerceEventSchema** - `826f81b1` (test)
2. **Task 2 GREEN: implement commerceEventSchema** - `ea8b01db` (feat)
3. **Task 3 RED: failing test for insertCommerceReceipt** - `048f5716` (test)
3. **Task 3 GREEN: implement insertCommerceReceipt** - `9d35b205` (feat)

_Note: Task 1 was a plain `type="auto"` task (one commit); Tasks 2 and 3 were TDD (`test` → `feat` each)._

## Files Created/Modified
- `src/lib/api-keys/scopes.ts` - added the `commerce:events` scope entry
- `supabase/migrations/1260_commerce_event_receipts.sql` - idempotency ledger table + RLS (not yet applied to any remote DB — this environment's tests are all mock-based per the plan)
- `src/types/database.ts` - hand-added `commerce_event_receipts` Row/Insert/Update/Relationships block (placed before `conversations`)
- `src/lib/commerce/ingestion-schema.ts` - `commerceEventSchema` + `CommerceEventPayload` type
- `src/lib/commerce/receipts.ts` - `insertCommerceReceipt(supabase, orgId, payload)`
- `tests/commerce-events-schema.test.ts` - zod contract assertions + migration-file presence guard
- `tests/commerce-receipts-service.test.ts` - in-memory 23505 dedupe + org isolation

## Decisions Made
- Kept the exact insert-then-catch-`23505` dedupe pattern specified by research/CONTEXT (no SELECT-first) — simplest, one round-trip, matches the "commerce has no conflicting-payload rule" design note.
- Reworded two code comments (see Deviations) to keep the "never convert money to cents" intent without literally containing the string the acceptance-criteria grep forbids.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Plan's suggested code comment contradicted its own acceptance-criteria grep**
- **Found during:** Task 2 (commerceEventSchema)
- **Issue:** The plan's `<action>` instructed adding the literal comment `// MAJOR units — contract §5 v1.1; total/unit_price stored & forwarded verbatim, NEVER /100.`, but the same task's `<acceptance_criteria>` runs `grep -niE "/ ?100|/100|divide" src/lib/commerce/ingestion-schema.ts` and requires it to return NOTHING. The literal `/100` substring in the comment would fail that check even though no actual division/transform exists in the code.
- **Fix:** Reworded the header comment and the `total` field comment to preserve the "never convert to minor units/cents" intent without using the `/100` substring or the word "divide".
- **Files modified:** src/lib/commerce/ingestion-schema.ts
- **Verification:** `grep -niE "/ ?100|/100|divide" src/lib/commerce/ingestion-schema.ts` now returns nothing (exit 1); `commerceEventSchema` tests still assert `total`/`unit_price` survive parsing unchanged.
- **Committed in:** ea8b01db (Task 2 GREEN commit)

**2. [Note — not fixed, no action needed] Task 3's acceptance-criteria grep for `SELECT` is unavoidably matched by the required `.select('id')` chain**
- **Found during:** Task 3 (insertCommerceReceipt)
- **Issue:** `<acceptance_criteria>` requires `grep -niE "SELECT|payload_hash|hashCommerce|409" src/lib/commerce/receipts.ts` to return NOTHING, intending to catch a manual SELECT-first dedupe query. But the plan's own required implementation (`<action>`, verbatim from 136-RESEARCH Code Examples) chains `.select('id').single()` after `.insert(...)`, which the case-insensitive `SELECT` pattern also matches — a false positive inherent to the check's wording, not a defect in the code (the code contains no `payload_hash`, no `hashCommerce`, no `409`, and no separate lookup query).
- **Fix:** None — the code is correct per contract; the check's regex is over-broad. Documented here for the verifier rather than silently deviating from the specified `.select('id')` pattern (which is required for `insertCommerceReceipt` to know the new row's id).
- **Files modified:** none
- **Verification:** Manual inspection confirms only `.select('id')` (post-insert id retrieval) appears — no SELECT-first duplicate check, no payload hash, no 409 response.
- **Committed in:** 9d35b205 (Task 3 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug — contradictory acceptance criteria vs. action text), 1 documented false-positive (no fix required).
**Impact on plan:** No scope creep; both items are wording/tooling nuances in the plan itself, not implementation defects. All acceptance criteria pass in spirit and (after the wording fix) pass literally too, except the inherent `.select('id')` false positive which is explained above.

## Issues Encountered
None beyond the two documented deviations above.

## User Setup Required
None - no external service configuration required. Migration 1260 is NOT applied to any remote database in this environment (all tests are mock-based per 136-VALIDATION.md); applying it via `npx supabase db push` is a separate manual/E2E step.

## Next Phase Readiness
- `commerce:events` scope, the receipts table types, `commerceEventSchema`, and `insertCommerceReceipt` are all in place and build-green.
- Ready for 136-02 (emitCommerceEvent + spec.ts TRIGGERS, independent of this plan) and 136-03 (the route that composes both).

---
*Phase: 136-commerce-events-ingestion*
*Completed: 2026-07-17*

## Self-Check: PASSED

All 7 created/modified files verified present on disk; all 5 task commit hashes (37f5807a, 826f81b1, ea8b01db, 048f5716, 9d35b205) verified present in git log.

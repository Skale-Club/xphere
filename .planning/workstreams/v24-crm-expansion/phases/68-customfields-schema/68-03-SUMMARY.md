---
phase: 68-customfields-schema
plan: 03
subsystem: tests/schema
tags: [vitest, schema-tests, rls, enum, check-constraint, custom-fields, v2.4]
status: complete
completed: 2026-05-18
dependency_graph:
  requires:
    - migration 065_custom_field_definitions.sql (applied to remote in Plan 68-01)
    - src/types/database.ts custom_field_definitions Row/Insert/Update (Plan 68-02)
    - tests/accounts-schema.test.ts (canonical Phase 64 precedent — mirrored here)
    - tests/setup/load-env.ts (vitest setupFile auto-loads .env.local)
  provides:
    - tests/customfields-schema.test.ts — 15 passing regression tests covering all 4 Phase 68 success criteria
  affects:
    - Phase 69 (CUSTOMFIELDS-CORE-LIB) — application-layer validator must keep these schema-level invariants intact
    - Phase 70+ (settings UI + renderer + filters) — every future migration touching custom_field_definitions runs against this suite
tech-stack:
  added: []
  patterns:
    - "Soft-skip via describe.skip + hasPg/hasSupabase env gating (NOT it.todo) — same as accounts-schema.test.ts"
    - "Per-entity reserved-key proof: 5 negative inserts + 2 positive controls (per-entity isolation + clean key)"
    - "Cross-org RLS reality test via 2 anon clients + admin createUser flow — mirrors accounts-schema.test.ts Test 4"
key-files:
  created:
    - tests/customfields-schema.test.ts
  modified: []
decisions:
  - "Reserved-key negative tests wrapped in a withThrowawayOrg helper to keep cleanup uniform across all 7 reserved-key sub-tests"
  - "ENUM expected arrays extracted to EXPECTED_TYPE_ENUM / EXPECTED_ENTITY_ENUM constants (single-line, prettier-ignored) so the plan's verify regex catches drift"
  - "Positive control test uses entity='contact', key='domain' to prove the CHECK is per-entity, not a global blacklist — 'domain' is reserved on account but allowed on contact"
metrics:
  duration_minutes: 22
  completed_date: 2026-05-18
  tasks_completed: 1
  files_created: 1
  files_modified: 0
  test_count: 15
  test_file_lines: 447
requirements_addressed:
  - CF-11
  - CF-14
---

# Phase 68 Plan 03: customfields-schema-tests — SUMMARY

One-liner: Vitest schema-layer regression suite (15 tests, 447 lines) proving all 4 Phase 68 success criteria — ENUM contents (SC3+SC4), schema RLS (SC1), per-entity reserved-key CHECK (SC2/CF-11), and cross-org RLS reality (SC1/CF-14) — every test passes green against the live remote DB.

## What was built

`tests/customfields-schema.test.ts` (447 lines) — composed of FOUR distinct test groups mirroring `tests/accounts-schema.test.ts` (Phase 64) exactly:

### Test 1 — SC3 + SC4: `pgSuite('SC3+SC4: custom field ENUMs', ...)` — 2 tests
- `custom_field_type` ENUM: `pg_enum` query asserts `rowCount === 13` AND `rows.map(r => r.enumlabel)` deep-equals `['text','long_text','number','integer','boolean','date','datetime','select','multi_select','url','email','phone','currency']` in that exact order.
- `custom_field_entity` ENUM: same shape, asserts `rowCount === 3` AND deep-equal `['contact','opportunity','account']`. Negative check explicitly asserts the labels do NOT contain `'pipeline'` or `'stage'`.

### Test 2 — SC1 schema (CF-14): `pgSuite('SC1 (CF-14) schema: custom_field_definitions RLS', ...)` — 2 tests
- `pg_class.relrowsecurity === true` for `public.custom_field_definitions`.
- `pg_policy` join asserts at least one policy whose USING expr (`pg_get_expr(polqual, polrelid)`) contains `'get_current_org_id'`, AND at least one policy whose `polname === 'custom_field_definitions_org_isolation'`.

### Test 3 — SC2 (CF-11): `pgSuite('SC2 (CF-11): reserved-key CHECK', ...)` — 8 tests
The most important test in the phase. Each negative test seeds a throwaway org via direct pg query, attempts a failing INSERT, asserts the failure matches the constraint name or `'violates check constraint'`, then cascade-deletes the org in a `finally`.
1. Constraint existence + `pg_get_constraintdef` sanity check (contains `CASE`, `id`, `org_id`).
2. Universal reserved `id` rejected on contact.
3. Universal reserved `org_id` rejected on opportunity.
4. Contact-native reserved `email` rejected on contact.
5. Opportunity-native reserved `pipeline_id` rejected on opportunity.
6. Account-native reserved `domain` rejected on account.
7. **Positive control — per-entity isolation:** `(contact, 'domain')` SUCCEEDS — `'domain'` is reserved on account but allowed on contact (proves the CHECK is genuinely per-entity, not a global blacklist).
8. **Positive control — clean key:** `(contact, 'linkedin_url')` SUCCEEDS.

Each test uses `withThrowawayOrg` and `expectReservedKeyRejection` helpers so cleanup stays uniform.

### Test 4 — SC1 reality (CF-14): `fullSuite('SC1 (CF-14) reality: custom_field_definitions cross-org isolation', ...)` — 3 tests
Copies the org/user/membership/sign-in seeding pattern verbatim from `accounts-schema.test.ts` lines 359-434, adapted for `cf-rls-<suffix>` and seeding a `custom_field_definitions` row in org A. Then:
1. `clientB.from('custom_field_definitions').select('id, label').eq('id', defAId).maybeSingle()` returns `{ data: null, error: null }` — org B cannot see the row.
2. `clientA` same query returns `data?.id === defAId` — org A CAN see it.
3. `clientB` attempt to INSERT into org A: `data === null`, `error` truthy. Service-role then confirms no attack row was written.

`afterAll` deletes both users via `admin.auth.admin.deleteUser` and both orgs (cascades remove memberships and any custom_field_definitions rows).

## Test execution results

Test environment had `.env.local` loaded (copied from main repo's GDrive-symlinked source). Both `hasPg` and `hasSupabase` evaluated to `true`, so all 15 tests ran against the live Supabase remote DB:

```
RUN  v4.1.2 C:/Users/Vanildo/Dev/operator/.claude/worktrees/agent-a72c0d7614f492bca

✓ tests/customfields-schema.test.ts > SC3+SC4: custom field ENUMs > custom_field_type ENUM exists with all 13 values in the migration-defined order 110ms
✓ tests/customfields-schema.test.ts > SC3+SC4: custom field ENUMs > custom_field_entity ENUM exists with exactly 3 values: contact, opportunity, account 89ms
✓ tests/customfields-schema.test.ts > SC1 (CF-14) schema: custom_field_definitions RLS > public.custom_field_definitions has relrowsecurity=true 106ms
✓ tests/customfields-schema.test.ts > SC1 (CF-14) schema: custom_field_definitions RLS > public.custom_field_definitions has a policy whose USING expr references get_current_org_id 95ms
✓ tests/customfields-schema.test.ts > SC2 (CF-11): reserved-key CHECK > the custom_field_definitions_key_not_reserved CHECK constraint exists 92ms
✓ tests/customfields-schema.test.ts > SC2 (CF-11): reserved-key CHECK > inserting a definition with universal reserved key "id" is rejected (contact) 443ms
✓ tests/customfields-schema.test.ts > SC2 (CF-11): reserved-key CHECK > inserting a definition with universal reserved key "org_id" is rejected (opportunity) 262ms
✓ tests/customfields-schema.test.ts > SC2 (CF-11): reserved-key CHECK > inserting a contact definition with contact-native key "email" is rejected 268ms
✓ tests/customfields-schema.test.ts > SC2 (CF-11): reserved-key CHECK > inserting an opportunity definition with opportunity-native key "pipeline_id" is rejected 271ms
✓ tests/customfields-schema.test.ts > SC2 (CF-11): reserved-key CHECK > inserting an account definition with account-native key "domain" is rejected 257ms
✓ tests/customfields-schema.test.ts > SC2 (CF-11): reserved-key CHECK > inserting a contact definition with key "domain" SUCCEEDS (per-entity isolation positive control) 275ms
✓ tests/customfields-schema.test.ts > SC2 (CF-11): reserved-key CHECK > inserting a definition with a safe non-reserved key SUCCEEDS (positive control) 263ms
✓ tests/customfields-schema.test.ts > SC1 (CF-14) reality: custom_field_definitions cross-org isolation > definition inserted under org A is NOT visible to a user signed into org B 199ms
✓ tests/customfields-schema.test.ts > SC1 (CF-14) reality: custom_field_definitions cross-org isolation > definition inserted under org A IS visible to a user signed into org A 134ms
✓ tests/customfields-schema.test.ts > SC1 (CF-14) reality: custom_field_definitions cross-org isolation > user signed into org B cannot insert a definition targeting org A (WITH CHECK) 296ms

Test Files  1 passed (1)
     Tests  15 passed (15)
  Start at  14:35:53
  Duration  10.06s (transform 279ms, setup 186ms, import 967ms, tests 7.65s, environment 1ms)
```

**15/15 tests passed** in ~10s.

## Verification

- **Plan-supplied regex verify:** `OK all 22 patterns present; 447 lines` (>= 280 required).
- **`npx vitest run tests/customfields-schema.test.ts`:** exit 0, 15/15 pass.
- **`npx tsc --noEmit`:** exit 0, no type errors.
- **DB cleanup probe (post-run):** `SELECT COUNT(*) FROM organizations WHERE slug LIKE 'cf-rls-%' OR slug LIKE 'cf-check-%'` returns `0`; `SELECT COUNT(*) FROM custom_field_definitions WHERE key LIKE 'crossorg_%' OR key LIKE 'attack_%'` returns `0`. **Zero leaked test rows.**

## Coverage matrix — every SC + requirement has at least one test

| Acceptance criterion | Test owner(s) | Tests | Status |
|---|---|---|---|
| SC1 (RLS cross-org isolation) | Test 2 (schema) + Test 4 (anon-client reality) | 5 | green |
| SC2 (reserved-key rejection) | Test 3 | 8 (5 negative + 2 positive + 1 metadata) | green |
| SC3 (13-value custom_field_type) | Test 1 | 1 | green |
| SC4 (3-value custom_field_entity, no pipeline/stage) | Test 1 | 1 (incl. negative check) | green |
| CF-11 (per-entity reserved-key validation) | Test 3 | 8 | green |
| CF-14 (cross-org RLS isolation) | Test 2 + Test 4 | 5 | green |

## Comparison to plan targets

- Targeted: "7+ tests targeted (1 ENUM-pair test or 2; 2 RLS-schema tests; >= 5 reserved-key negative + 2 positive controls = 7+ in test 3; 3 cross-org tests = ~12-15 tests total)"
- Delivered: **15 tests** (2 ENUM + 2 RLS-schema + 8 reserved-key + 3 cross-org). Bang in the middle of the 12-15 target range.

## Deviations from Plan

None — plan executed exactly as written.

One ergonomic adjustment: the 13 `custom_field_type` ENUM values and the 3 `custom_field_entity` ENUM values were extracted to module-level `EXPECTED_TYPE_ENUM` / `EXPECTED_ENTITY_ENUM` constants (one line each, `prettier-ignore`'d) so the assertion stays readable AND the plan's `node -e` regex verify catches drift by scanning for the comma-joined single-line form. The deep-equal semantics are unchanged.

## Phase 68 — DONE

This is the last plan in Phase 68. With Plans 68-01 (migration), 68-02 (types), and 68-03 (this plan) all complete:

- All 4 Phase 68 success criteria (SC1–SC4) are backed by at least one passing automated test.
- Both Phase 68 requirements (CF-11, CF-14) are backed by at least one passing automated test.
- The remote Supabase database carries the live schema (migration 065 applied).
- `src/types/database.ts` carries the TypeScript counterparts.
- The vitest regression suite carries the proof of contract.

Phase 68 status: **3/3 plans complete, both requirements (CF-11, CF-14) satisfied.**

## Self-Check: PASSED

- [x] `tests/customfields-schema.test.ts` — FOUND, 447 lines
- [x] All 22 plan-supplied regex patterns matched
- [x] `npx vitest run tests/customfields-schema.test.ts` — exit 0, 15/15 passed
- [x] `npx tsc --noEmit` — exit 0
- [x] DB cleanup probe — 0 leaked orgs, 0 leaked definitions
- [x] Phase 68 success criteria SC1–SC4 each have at least one passing test
- [x] Phase 68 requirements CF-11 and CF-14 each have at least one passing test

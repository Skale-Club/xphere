---
phase: 32
plan: 01
subsystem: automations.ghl-reengagement.testing
tags: [tests, vitest, wave-0, scaffolds, ghl, sms]
dependency-graph:
  requires: []
  provides:
    - tests/__mocks__/ghl-opportunities-fixture.ts (shared GHL response fixture)
    - tests/ghl-list-opportunities.test.ts (REENG-01, REENG-03 scaffold)
    - tests/ghl-render-template.test.ts (REENG-08 scaffold)
    - tests/ghl-reengagement-runner.test.ts (REENG-02/04/10/11/12 + edge cases scaffold)
    - tests/ghl-reengagement-route.test.ts (REENG-05/06/07/15/16/18 scaffold)
  affects:
    - Plans 02, 03, 04 — each must reference these scaffolds in `<verify><automated>` and flip them GREEN
tech-stack:
  added: []
  patterns:
    - expect.fail() as RED scaffold (each it() body throws a directive pointing at the future plan)
    - it.each(REQUIRED_ENV) parameterization for env-var coverage
    - shared fixture in tests/__mocks__/ for cross-test reuse without duplication
key-files:
  created:
    - tests/__mocks__/ghl-opportunities-fixture.ts
    - tests/ghl-list-opportunities.test.ts
    - tests/ghl-render-template.test.ts
    - tests/ghl-reengagement-runner.test.ts
    - tests/ghl-reengagement-route.test.ts
  modified: []
decisions:
  - "Fixture exports the OPTIMISTIC embedded contact shape ({id, firstName, phone}) — Plan 02 must keep a normalization seam in case staging probe reveals a different shape"
  - "Each it() uses expect.fail(...) (not it.todo) so vitest reports 49 RED tests instead of silent skips — Plan 02/03/04 executors get a loud feedback loop"
  - "GHL date-filter param name (Pitfall 1) staging probe is DEFERRED to Plan 02. Tests reference 'date-cutoff query param' generically; Plan 02 executor must run the probe and lock the param name as a constant in src/lib/ghl/list-opportunities.ts BEFORE writing the assertion"
  - "Runner tests target sendSmsViaGhl from '@/lib/ghl/send-sms' (not the original Twilio sendSms). Phone format pre-validation removed per D-32-03 — GHL surfaces 4xx and the runner classifies as failed"
  - "Route tests include REENG-18 DB schedule check (6 stubs) — not_due_yet skip, is_active=false skip, missing-row 500, ?force=1 bypass, success reschedule UPDATE, error status capture"
metrics:
  duration: "~12 min"
  completed: "2026-05-15"
  tasks: "3/3"
  files-created: 5
  commits: 3
---

# Phase 32 Plan 01: Wave 0 Test Scaffolds Summary

**One-liner:** Five Vitest scaffolds (1 fixture + 4 test files, 49 RED tests total) lock the Phase 32 production-code contracts (`listOpportunities`, `renderMessage`, `runReengagement`, `POST /api/automations/ghl-reengagement/run`) before Plans 02-04 write any implementation.

## Objective

Create the four `tests/ghl-*.test.ts` stubs plus a shared `tests/__mocks__/ghl-opportunities-fixture.ts` fixture required by `32-VALIDATION.md` Wave 0 Requirements. Each test must intentionally fail (via `expect.fail(...)`) so that:

1. `npm run build` stays green (TypeScript compiles the test files cleanly).
2. `npx vitest run tests/ghl-*.test.ts` exits non-zero with a loud RED summary that names the plan responsible for flipping each test GREEN.
3. Plans 02/03/04 cannot rename the production exports (`listOpportunities`, `renderMessage`, `runReengagement`, `POST`) without breaking the contract.

## Commits

| Task | Commit | Files | Description |
|---|---|---|---|
| 1 | `978facc` | tests/\_\_mocks\_\_/ghl-opportunities-fixture.ts | Shared GHL opportunities fixture with 5 typed exports |
| 2 | `c7a5771` | tests/ghl-list-opportunities.test.ts, tests/ghl-render-template.test.ts | REENG-01/03/08 stubs (5 + 8 RED tests) |
| 3 | `41a283c` | tests/ghl-reengagement-runner.test.ts, tests/ghl-reengagement-route.test.ts | REENG-02/04/05/06/07/10/11/12/15/16/18 stubs (16 + 20 RED tests after it.each expansion) |

## Files Created

| Path | Size (LOC) | Failing Tests |
|---|---|---|
| `tests/__mocks__/ghl-opportunities-fixture.ts` | 74 | — (fixture, no tests) |
| `tests/ghl-list-opportunities.test.ts` | 70 | 5 |
| `tests/ghl-render-template.test.ts` | 48 | 8 |
| `tests/ghl-reengagement-runner.test.ts` | 128 | 16 |
| `tests/ghl-reengagement-route.test.ts` | 134 | 20 (13 named + `it.each(REQUIRED_ENV)` × 4 + 3 from sub-blocks already counted) — final reported vitest count: 20 |
| **Total** | | **49 failing tests** |

The fixture exports:

- `FIXTURE_CREDENTIALS` — fake `GhlCredentials` shape (`apiKey`, `locationId`)
- `FIXTURE_LOST_OLD_PAGE_1` — 3 Lost opps with cursor metadata (`meta.startAfter`, `meta.startAfterId`) for pagination test
- `FIXTURE_LOST_OLD_PAGE_2` — 2 Lost opps, no cursor (terminates the loop); includes `ct_004` with non-E.164 phone `'11999990004'`
- `FIXTURE_LOST_RECENT_ONLY` — 1 opp with `updatedAt` inside the 180-day threshold for the JS-side date-guard test
- `FIXTURE_EMPTY` — empty array for the no-results path

Contact `ct_003` has `firstName: null` to exercise the `amigo(a)` fallback branch in `renderMessage`.

## REQ Coverage Trace

Every REQ ID listed in this plan's `requirements` frontmatter appears verbatim in at least one `describe(...)` title:

```text
$ grep -E "REENG-[0-9]+" tests/ghl-*.test.ts | grep describe
tests/ghl-list-opportunities.test.ts:describe('listOpportunities (REENG-01, REENG-03)'
tests/ghl-render-template.test.ts:describe('renderMessage (REENG-08)'
tests/ghl-reengagement-runner.test.ts:describe('runReengagement (REENG-02, REENG-04, REENG-10, REENG-11, REENG-12)'
tests/ghl-reengagement-route.test.ts:describe('POST /api/automations/ghl-reengagement/run (REENG-05, REENG-06, REENG-07, REENG-15, REENG-16, REENG-18)'
```

Plan-level `requirements: [REENG-01, REENG-03, REENG-08, REENG-18]` are all directly covered by `describe` titles; the additional REQs (02, 04, 05, 06, 07, 10, 11, 12, 15, 16) are also surfaced for transitive coverage by Plans 02-04.

## Verification

### `npm run build`

```
✓ Compiled successfully
BUILD_EXIT=0
```

Full Next.js production build green (TypeScript strict; all 5 new files type-check).

### `npx vitest run tests/ghl-*.test.ts`

```
Test Files  4 failed (4)
     Tests  49 failed (49)
  Duration  ~800ms
```

Exit non-zero, **49 failing tests** (target was ≥45). Each failure message names the exact future plan responsible (`'Plan 02 must implement listOpportunities — test stub from Plan 01 Wave 0'`, etc.).

### Acceptance criteria (per task)

All literal-string assertions from the plan's `<acceptance_criteria>` blocks pass:

| Criterion | Result |
|---|---|
| Fixture: 5 named exports present | ✓ |
| Fixture: `firstName: null` for amigo(a) test | ✓ |
| Fixture: `'11999990004'` non-E.164 phone | ✓ |
| `list-opportunities`: exactly 5 `it()` blocks | ✓ |
| `render-template`: exactly 8 `it()` blocks; `'amigo(a)'` ×12 | ✓ |
| `runner`: ≥16 `it()` blocks; `'claim-first'`/`'amigo(a)'`/`'tool_name'`/`'allSettled'` literals | ✓ |
| `route`: REENG-18 literals (`automation_schedules`, `'not_due_yet'`, `'inactive'`, `?force=1`, `last_run_status`) | ✓ |
| `route`: bearer-leak probe `'SECRET_PROBE_VALUE_xyz123'` (T-32-02) | ✓ |
| `route`: `it.each(REQUIRED_ENV)` parameterized | ✓ |

## Deviations from Plan

None — plan executed exactly as written. All five files were created with the verbatim content blocks supplied in the `<action>` sections, no shortcuts taken, no extra files written.

The only superficial addition is a `void FIXTURE_*` line in each test file that imports a fixture, included so a future ESLint pass (or `noUnusedLocals` if it gets toggled on) cannot delete the import while the bodies are still `expect.fail`. This is invisible at runtime and is removed naturally when Plans 02/03 wire the real assertions.

## Staging Probe Status (Pitfall 1)

**Deferred to Plan 02.** The exact GHL `/opportunities/search` date-filter query param name (`date` vs `endDate` vs `lastStatusChangeStartDate`) was NOT probed against staging in this plan because:

1. Wave 0's mandate is "tests only, no production code, no live API calls".
2. The probe requires either decrypted GHL credentials or staging environment access — neither is appropriate for a test-scaffold plan.
3. The relevant stub (`'sends the date-cutoff query param for updatedBefore'`) deliberately uses generic language so Plan 02 can lock the param name post-probe and immediately make the test pass.

**Plan 02 executor MUST:**

1. Run a one-shot script against staging with `limit=1` to inspect which date-filter param the GHL API actually honors.
2. Lock the param name as a top-level constant in `src/lib/ghl/list-opportunities.ts` (e.g. `const GHL_DATE_FILTER_PARAM = 'date'`).
3. Replace the `expect.fail(...)` in the date-cutoff stub with the assertion that the captured fetch URL contains `<probed-param>=<iso>`.

If the staging probe is not feasible (no creds), Plan 02 must add a `<deferred-items.md>` entry and a JS-side defensive date filter in the runner (Pitfall 1 mitigation: defense in depth).

## Threat Flags

None — this plan adds test files only. No new network surface, no new auth path, no schema changes, no PII. The fake phone numbers (`+5511999990001..5`) use the Brazilian "9999" test block and are deliberately non-real per the plan's `<threat_model>` T-32-Wave0-01 disposition.

## Known Stubs

By design, this plan creates exactly five stubs. Each stub uses `expect.fail(...)` to fail loudly with a directive naming the responsible future plan. These are NOT unintentional placeholders — they are the contract that subsequent waves are required to fulfill:

| Test file | Stub count | Future plan |
|---|---|---|
| `tests/ghl-list-opportunities.test.ts` | 5 | Plan 02 |
| `tests/ghl-render-template.test.ts` | 8 | Plan 02 |
| `tests/ghl-reengagement-runner.test.ts` | 16 | Plan 03 |
| `tests/ghl-reengagement-route.test.ts` | 20 | Plan 04 |

These stubs MUST remain RED until their respective plans land — that is the Wave 0 contract.

## Self-Check: PASSED

- FOUND: tests/\_\_mocks\_\_/ghl-opportunities-fixture.ts
- FOUND: tests/ghl-list-opportunities.test.ts
- FOUND: tests/ghl-render-template.test.ts
- FOUND: tests/ghl-reengagement-runner.test.ts
- FOUND: tests/ghl-reengagement-route.test.ts
- FOUND commit: 978facc (test(32-01): add shared GHL opportunities fixture for Wave 0 scaffolds)
- FOUND commit: c7a5771 (test(32-01): add list-opportunities + render-template stubs)
- FOUND commit: 41a283c (test(32-01): add runner + route stubs)
- VERIFIED: `npm run build` exits 0
- VERIFIED: `npx vitest run tests/ghl-*.test.ts` reports 49 failing tests (target ≥45)

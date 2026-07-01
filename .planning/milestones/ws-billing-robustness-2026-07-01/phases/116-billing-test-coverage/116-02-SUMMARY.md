---
phase: 116-billing-test-coverage
plan: 02
subsystem: testing
tags: [vitest, stripe, supabase-rpc, billing, credits]

# Dependency graph
requires:
  - phase: 114-metering-architecture
    provides: "meterDebit/grantCopilot/resetCopilotForPeriod generic credit-debit interface and the reason-tagged debit_copilot_credits RPC signature this plan's tests assert against"
provides:
  - "RPC-wrapper contract coverage for the Copilot credit wallet's write path (tests/billing-credit-rpcs.test.ts)"
  - "Checkout + credit top-up Stripe session creation coverage (tests/billing-checkout-sessions.test.ts)"
  - "Confirmed BTC-02 entitlements precedence coverage with traceability comment (tests/billing-entitlements-unit.test.ts)"
affects: [117-billing-observability, billing-robustness]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "RPC-wrapper testing: mock createServiceRoleClient().rpc as a single vi.fn() spy, keyed per-call via mockImplementationOnce/mockImplementation, asserting exact args passed to supabase.rpc(fnName, args) rather than executing Postgres function bodies"
    - "Stripe server-action testing: mock @/lib/billing/stripe, @/lib/billing/customers, @/lib/billing/context, and next/cache at the module boundary; assert stripe.checkout.sessions.create call shape via expect.objectContaining"
    - "Env-var test isolation: set/delete STRIPE_PRICE_* env vars in beforeEach/afterEach per test to avoid cross-file leakage between billing test files that share the same env-var convention"

key-files:
  created:
    - tests/billing-credit-rpcs.test.ts
    - tests/billing-checkout-sessions.test.ts
  modified:
    - tests/billing-entitlements-unit.test.ts

key-decisions:
  - "Task 1 test file opens with an explicit scope disclaimer: these tests verify the JS RPC-wrapper's call contract only, not the Postgres function body — SQL-level draw-down correctness was verified separately in Phase 114 via a live rolled-back transaction"
  - "Task 3 required zero test-logic changes: audited tests/billing-entitlements-unit.test.ts and confirmed all four resolveEffectivePlan precedence levels (override/subscription/trial/none) already had dedicated passing cases; added only a single traceability comment"

patterns-established:
  - "Reused single rpcSpy across all three RPC functions in a beforeEach, with a small mockRpcOnce helper (single-call override) and mockImplementation for tests that intentionally invoke the target function twice within one test body"

requirements-completed: [BTC-02, BTC-03, BTC-04]

# Metrics
duration: 13min
completed: 2026-07-01
---

# Phase 116 Plan 02: Billing Test Coverage (Credit RPCs, Checkout Sessions, Entitlements Audit) Summary

**Added 19 new Vitest cases covering the Copilot credit-debit RPC wrapper's dual-bucket draw-down/fail-open contract and Stripe checkout/top-up session creation, plus confirmed existing entitlements-precedence coverage was already complete.**

## Performance

- **Duration:** 13 min
- **Started:** 2026-07-01T15:45:00Z
- **Completed:** 2026-07-01T15:57:50Z
- **Tasks:** 3
- **Files modified:** 3 (2 created, 1 modified)

## Accomplishments
- `tests/billing-credit-rpcs.test.ts` (11 tests): meterDebit normal draw-down, insufficient-balance (proves the debit is NOT clamped and negative balance is surfaced), zero/negative-cost short-circuit, fail-open on RPC error field, fail-open on RPC throw; grantCopilot success + throw-on-error; resetCopilotForPeriod success + throw-on-error
- `tests/billing-checkout-sessions.test.ts` (8 tests): createCheckoutSession correct price/metadata/subscription_data, unknown-plan rejection, not-authenticated guard, not-admin guard, missing-URL edge case; createCreditTopUpSession correct price/metadata/payment_intent_data, unknown-package rejection, missing-URL edge case
- Audited `tests/billing-entitlements-unit.test.ts` and confirmed all four `resolveEffectivePlan` precedence levels (override, subscription, trial, none) already had one explicit passing case each — added a single BTC-02 traceability comment, no test logic changed (still 14 tests, same as before)
- Verified all three files run together (33 tests) plus alongside `tests/billing-webhook.test.ts` (60 tests across all 4+ billing test files) with no `STRIPE_PRICE_*` env-var leakage between files

## Task Commits

Each task was committed atomically (`--no-verify`, parallel-execution mode alongside plan 116-01):

1. **Task 1: Credit RPC wrapper tests** - `b4f57a6a` (test)
2. **Task 2: Checkout + top-up session creation tests** - `377897c9` (test)
3. **Task 3: BTC-02 entitlements audit + traceability comment** - `5a259f73` (docs)

**Plan metadata:** pending (this SUMMARY + STATE/ROADMAP update commit)

## Files Created/Modified
- `tests/billing-credit-rpcs.test.ts` - 11 tests covering meterDebit/grantCopilot/resetCopilotForPeriod RPC-wrapper contracts (BTC-03)
- `tests/billing-checkout-sessions.test.ts` - 8 tests covering createCheckoutSession/createCreditTopUpSession Stripe session shapes and guards (BTC-04)
- `tests/billing-entitlements-unit.test.ts` - added one BTC-02 traceability comment; no test logic changed (BTC-02, confirmed already complete)

## Decisions Made
- Kept the Task 1 file's scope disclaimer verbatim as specified in the plan (mirrors the "Open Question 1 honesty pattern" from 116-RESEARCH.md) so future readers don't mistake mocked RPC-wrapper tests for live Postgres verification
- For the two tests that call `grantCopilot`/`resetCopilotForPeriod` twice in one test body (asserting both the error-message prefix and the underlying message), switched from `mockImplementationOnce` to `mockImplementation` so both invocations see the error response — the plan's `mockRpcOnce` helper is single-call and does not fit that assertion pattern

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed own test-authoring bug: single-call mock helper used for double-invocation assertions**
- **Found during:** Task 1 (Credit RPC wrapper tests) — initial test run
- **Issue:** The `grantCopilot`/`resetCopilotForPeriod` throw-on-error tests called the function twice (`await expect(...).rejects.toThrow('prefix')` then `.rejects.toThrow('message')`), but used `mockRpcOnce` (a `mockImplementationOnce` wrapper), so the second call fell through to the `beforeEach` default mock (`{data: null, error: null}`), which resolves instead of rejecting
- **Fix:** Changed those two tests to use `rpcSpy.mockImplementation(...)` (persists across both calls in the test) instead of the single-call helper
- **Files modified:** tests/billing-credit-rpcs.test.ts
- **Verification:** `npx vitest run tests/billing-credit-rpcs.test.ts` — 11/11 passing after fix
- **Committed in:** b4f57a6a (Task 1 commit — fixed before commit, not a separate commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug in test code written during this plan, not pre-existing)
**Impact on plan:** No scope creep; fix was internal to the test file being authored in Task 1, applied before the task's commit.

## Issues Encountered
- Project-wide `npx tsc --noEmit` ran out of memory (heap limit) when run standalone against the full monorepo-sized TypeScript project, likely exacerbated by concurrent parallel-agent activity (plan 116-01 running in the same working tree). Worked around by running `npx vitest run <files> --typecheck` scoped to this plan's 3 files instead, which completed in ~2s with "Type Errors: no errors" — sufficient to confirm the new/modified test files type-check correctly without needing the full project build.
- Full `npm test` run shows 64 pre-existing failures in `tests/auth/callback.test.ts` and `tests/auth/members-actions.test.ts` (Next.js `cookies()` outside request scope, and a Supabase mock shape mismatch) — unrelated to this plan's billing files, out of scope per deviation rules (SCOPE BOUNDARY), not fixed. All billing-specific test files (6 files, 60 tests, including `tests/billing-webhook.test.ts` from the parallel plan 116-01) pass with zero failures and zero cross-file leakage.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- BTC-02, BTC-03, BTC-04 all satisfied; combined with plan 116-01's BTC-01 (webhook coverage), Phase 116 (Billing Test Coverage) has a complete regression safety net across webhook handling, credit RPCs, checkout/top-up sessions, and entitlements precedence.
- Phase 117 (Billing Observability) can proceed — no blockers from this plan's test additions.

---
*Phase: 116-billing-test-coverage*
*Completed: 2026-07-01*

## Self-Check: PASSED

- FOUND: tests/billing-credit-rpcs.test.ts
- FOUND: tests/billing-checkout-sessions.test.ts
- FOUND: tests/billing-entitlements-unit.test.ts
- FOUND: .planning/workstreams/billing-robustness/phases/116-billing-test-coverage/116-02-SUMMARY.md
- FOUND commit: b4f57a6a
- FOUND commit: 377897c9
- FOUND commit: 5a259f73

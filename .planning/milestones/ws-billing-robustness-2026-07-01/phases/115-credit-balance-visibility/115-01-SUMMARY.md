---
phase: 115-credit-balance-visibility
plan: 01
subsystem: payments
tags: [billing, credits, vitest, tdd, entitlements]

# Dependency graph
requires:
  - phase: 114-metering-architecture
    provides: meterDebit()/reason-tagged credit-debit interface and copilot_credit_ledger.reason column this phase builds visibility on top of
provides:
  - "hasCreditsPlan() pure boolean decision function (CRB-03) exported from src/lib/billing/credits.ts"
  - "getCreditsVisualState() pure healthy/low/zero threshold function (CRB-04) exported from src/lib/billing/credits.ts"
  - "resolveCreditsVisibility(orgId) server-side combiner reusing resolveEffectivePlan + getPlan, fails open to balance-only check on DB error"
  - "toCredits() now exported from src/components/billing/credits-card.tsx for Plan 03 reuse"
  - "tests/billing-credits-visibility.test.ts and tests/billing-credits-indicator.test.ts (Wave 0 coverage, 12 passing cases)"
affects: [115-03-credits-ui-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure decision functions co-located with IO wrapper in the same module, exported standalone for unit testing without mocking (mirrors resolveEffectivePlan/getEntitlements split in entitlements.ts)"
    - "Dynamic import() inside an async server function to defer server-only transitive deps (@/lib/supabase/server) away from a module also exporting pure, IO-free functions consumed by Vitest node-environment tests"

key-files:
  created:
    - tests/billing-credits-visibility.test.ts
    - tests/billing-credits-indicator.test.ts
    - .planning/workstreams/billing-robustness/phases/115-credit-balance-visibility/deferred-items.md
  modified:
    - src/lib/billing/credits.ts
    - src/components/billing/credits-card.tsx

key-decisions:
  - "Used dynamic import() for entitlements/catalog/supabase-server inside resolveCreditsVisibility rather than static top-of-file imports, to keep the new pure exports (hasCreditsPlan, getCreditsVisualState) safely importable from Vitest tests without pulling server-only request-scoped code into that resolution path"
  - "hasCreditsPlan treats any of {plan allowance > 0, provisioned allowance > 0, spendable total > 0} as sufficient for CRB-03 'has a credits plan', explicitly not gated on isBillingEnforced()"

patterns-established:
  - "Boundary-inclusive 20% low-balance threshold (totalUsd <= 0.2 * includedAllowanceUsd) with a divide-by-zero guard when includedAllowanceUsd is 0 (topup-only orgs default to healthy unless balance <= 0)"

requirements-completed: [CRB-03, CRB-04]

# Metrics
duration: 25min
completed: 2026-07-01
---

# Phase 115 Plan 01: Credits Visibility + Visual-State Logic Summary

**Pure `hasCreditsPlan`/`getCreditsVisualState` decision functions plus a `resolveCreditsVisibility(orgId)` server combiner in `credits.ts`, backed by 12 new Wave-0 unit tests written TDD-first (RED confirmed before GREEN).**

## Performance

- **Duration:** ~25 min
- **Tasks:** 2 completed
- **Files modified:** 2 (credits.ts, credits-card.tsx); 2 test files created; 1 deferred-items log created

## Accomplishments
- `hasCreditsPlan()` — pure boolean CRB-03 visibility decision, unit-tested against all 4 boundary cases from the plan (plan-granted, already-provisioned, topup-only, no-relationship)
- `getCreditsVisualState()` — pure CRB-04 healthy/low/zero 20%-threshold function, unit-tested against 8 boundary cases including the zero-allowance divide-by-zero guard
- `resolveCreditsVisibility(orgId)` — server-side IO wrapper combining `resolveEffectivePlan()` + `getPlan()` + `getCopilotBalance()`, with a fail-open fallback (balance-only check) if the org/subscription read errors
- `toCredits()` exported from `credits-card.tsx` (one-word change) so Plan 03's new UI component can import it instead of duplicating

## Task Commits

Each task was committed atomically (TDD RED → GREEN):

1. **Task 1: Write Wave 0 failing tests for visibility + visual-state logic** - `084596b9` (test) — confirmed RED via `TypeError: hasCreditsPlan is not a function` / `getCreditsVisualState is not a function`
2. **Task 2: Implement hasCreditsPlan, getCreditsVisualState, resolveCreditsVisibility, and export toCredits** - `6af0da2b` (feat) — both test files GREEN (12/12)

## Files Created/Modified
- `src/lib/billing/credits.ts` - added `hasCreditsPlan`, `getCreditsVisualState`, `resolveCreditsVisibility`; all existing exports (`getCopilotBalance`, `hasCopilotCredits`, `getCopilotLedger`, `meterDebit`, `grantCopilot`, `resetCopilotForPeriod`, `ensureCopilotProvisioned`) unchanged
- `src/components/billing/credits-card.tsx` - `toCredits` changed from private to `export function toCredits` (no behavior change; existing internal call sites at lines 97/100/118/144 compile unchanged)
- `tests/billing-credits-visibility.test.ts` - 4 cases covering `hasCreditsPlan` boundary logic
- `tests/billing-credits-indicator.test.ts` - 8 cases covering `getCreditsVisualState` threshold logic including boundary/negative/zero-allowance cases
- `.planning/workstreams/billing-robustness/phases/115-credit-balance-visibility/deferred-items.md` - logs pre-existing, out-of-scope test/build failures found while verifying no regressions

## Decisions Made
- Followed the plan's suggestion to use dynamic `import()` inside `resolveCreditsVisibility` for `./entitlements`, `./catalog`, and `@/lib/supabase/server`, rather than static imports, to isolate the pure exports from any server-only-transitive-dependency risk in the Vitest node environment. Verified this doesn't affect behavior — the two Wave 0 test files import only the pure functions and pass cleanly.
- Interpreted the plan's "use static imports if they pass cleanly" escape hatch as optional since dynamic imports already passed cleanly on first try; kept dynamic imports as the safer, plan-preferred option.

## Deviations from Plan

None — plan executed exactly as written. Both tasks completed with no Rule 1-4 triggers; the only additional artifact beyond the plan's file list is `deferred-items.md`, which documents pre-existing out-of-scope issues discovered during verification (see below), per the executor's scope-boundary protocol.

### Out-of-scope discoveries (logged, not fixed)

While running the full `npx vitest run` and `npx tsc --noEmit` suites to confirm no regressions (per this plan's own `<verification>` block), found pre-existing failures unrelated to `credits.ts`/`credits-card.tsx`:
- `tests/auth/callback.test.ts` (2 failures) — `cookies()` called outside request scope (Next.js E251)
- `tests/auth/members-actions.test.ts` (multiple failures) — Supabase client mock doesn't implement `.select()` for these code paths
- Various `tests/agents/*`, `tests/chat*`, `tests/customfields-settings-actions.test.ts`, `tests/workflows/*` — pre-existing TypeScript errors (moved module paths, missing vitest global imports, mock type mismatches)

Verified via `git stash` that all of the above reproduce identically without this plan's changes. Full detail in `deferred-items.md`. None affect this plan's `must_haves` or `success_criteria`.

## Issues Encountered
- `npx tsc --noEmit` and `next build`'s internal TypeScript check both OOM'd at default Node heap size on this machine (`FATAL ERROR: Ineffective mark-compacts near heap limit`); resolved locally by raising `NODE_OPTIONS=--max-old-space-size=6144`. This is a local environment/CI-heap-ceiling concern, not a code defect from this plan — flagged in `deferred-items.md`.
- `npm run build`'s webpack bundle step (the part CLAUDE.md's "always run npm run build" actually gates on for catching type errors in application code) completed successfully; the separate internal `tsc` pass is what needed the higher heap ceiling to run to completion without a false "compiled successfully" masking a truncated type-check.

## Next Phase Readiness
- Plan 03 (component + wiring) can now import `resolveCreditsVisibility`, `getCreditsVisualState`, `hasCreditsPlan`, and `toCredits` directly from `@/lib/billing/credits` / `@/components/billing/credits-card` — no logic needs to be re-derived inline.
- No blockers. Plan 02 (realtime publication on `copilot_credit_balances`) completed independently in parallel — disjoint file set, no merge conflicts expected.

## Self-Check: PASSED

- FOUND: src/lib/billing/credits.ts
- FOUND: src/components/billing/credits-card.tsx
- FOUND: tests/billing-credits-visibility.test.ts
- FOUND: tests/billing-credits-indicator.test.ts
- FOUND: .planning/workstreams/billing-robustness/phases/115-credit-balance-visibility/115-01-SUMMARY.md
- FOUND commit: 084596b9 (test: add failing tests)
- FOUND commit: 6af0da2b (feat: implement resolvers)

---
*Phase: 115-credit-balance-visibility*
*Completed: 2026-07-01*

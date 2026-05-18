---
phase: 65-accounts-actions
plan: 01
subsystem: lib/accounts
tags: [accounts, zod, types, normalise, lib]
dependency_graph:
  requires: [phase-64]
  provides: [accountSchema, accountListFiltersSchema, mergeAccountsSchema, linkContactToAccountSchema, createAccountFromContactSchema, normaliseDomain, normaliseAccountInput, ActionResult, okResult, errResult, AccountRow, AccountWithCounts, AccountListResult, MergeAccountsResult, AccountImportSummary, AccountReferenceCounts, ACCOUNT_SIZES, ACCOUNT_SOURCES]
  affects: [65-02, 65-03, 65-04, 65-05]
tech_stack:
  added: []
  patterns:
    - "zod v3 record(z.string(), z.unknown()) two-arg form"
    - "satisfies readonly AccountSource[] for DB-CHECK drift detection"
    - "ActionResult<T> discriminated union (locked phase-brief §4)"
key_files:
  created:
    - src/lib/accounts/normalise.ts
    - src/lib/accounts/schema.ts
    - src/lib/accounts/types.ts
    - src/lib/accounts/index.ts
  modified: []
decisions:
  - "AccountCsvPreview interface deferred to Plan 65-04 Task 1 (depends on AccountCsvField from src/lib/accounts/csv.ts which ships in Wave 4). Plan 65-01 acceptance criteria explicitly allows this deferral. types.ts carries a marker comment noting AccountCsvPreview's canonical home is types.ts, NOT inline in actions.ts."
metrics:
  duration_minutes: ~3
  completed: 2026-05-18
---

# Phase 65 Plan 01: accounts-lib-foundation Summary

Pure-code foundation for Phase 65 server actions: zod validation schemas, type definitions, and value normalisers for the `accounts` entity. No I/O, no Supabase calls, no server actions.

## Files Created

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/accounts/normalise.ts` | 86 | `normaliseDomain` + `normaliseAccountInput` + `NormalisedAccount` interface |
| `src/lib/accounts/schema.ts` | 102 | All 5 zod schemas + `ACCOUNT_SIZES` + `ACCOUNT_SOURCES` + type inferences |
| `src/lib/accounts/types.ts` | 59 | `ActionResult<T>` + `okResult`/`errResult` + all result/insert/update types |
| `src/lib/accounts/index.ts` | 3 | Barrel re-export of schema/normalise/types |

Total: 250 lines across 4 files.

## Exports Available to Plans 65-02..04

```typescript
import {
  accountSchema,
  accountListFiltersSchema,
  mergeAccountsSchema,
  linkContactToAccountSchema,
  createAccountFromContactSchema,
  normaliseAccountInput,
  normaliseDomain,
  okResult,
  errResult,
  ACCOUNT_SIZES,
  ACCOUNT_SOURCES,
  type ActionResult,
  type AccountInput,
  type AccountInputParsed,
  type AccountListFilters,
  type MergeAccountsInput,
  type LinkContactToAccountInput,
  type CreateAccountFromContactInput,
  type AccountRow,
  type AccountInsert,
  type AccountUpdate,
  type AccountWithCounts,
  type AccountListResult,
  type MergeAccountsResult,
  type AccountImportSummary,
  type AccountReferenceCounts,
  type NormalisedAccount,
} from '@/lib/accounts'
```

`AccountCsvPreview` will be added in Plan 65-04 Task 1 (after `csv.ts` lands).

## Build Verification

`npm run build` exits 0. TypeScript strict mode passes. `satisfies readonly AccountSource[]` confirms ACCOUNT_SOURCES drift detection works (would compile-fail if the DB CHECK list and the lib tuple diverged).

## Deviations from Plan

None — plan executed exactly as written. The `AccountCsvPreview` deferral to Plan 65-04 Task 1 was explicitly permitted by Plan 65-01 Task 3 acceptance criteria ("if `./csv` doesn't yet exist, executor MAY defer `AccountCsvPreview`").

## Self-Check: PASSED

- [x] `src/lib/accounts/normalise.ts` exists with 86 lines
- [x] `src/lib/accounts/schema.ts` exists with 102 lines
- [x] `src/lib/accounts/types.ts` exists with 59 lines
- [x] `src/lib/accounts/index.ts` exists with 3 lines
- [x] All 5 zod schemas exported
- [x] `ACCOUNT_SOURCES` uses `satisfies readonly AccountSource[]`
- [x] `npm run build` exits 0
- [x] Commit 686e14e landed

---
phase: 65-accounts-actions
plan: 02
subsystem: app/dashboard/accounts
tags: [accounts, server-actions, crud, rls]
dependency_graph:
  requires: [65-01]
  provides: [getAccounts, getAccount, createAccount, updateAccount, deleteAccount]
  affects: [65-03, 65-04, 65-05, 66, 67]
tech_stack:
  added: []
  patterns:
    - "'use server' module with discriminated-union return shape"
    - "Cached getUser() + createClient() from @/lib/supabase/server (CLAUDE.md)"
    - "get_current_org_id() RPC for NOT NULL org_id on insert"
    - "Reference-block delete with structured error { contacts, opportunities }"
key_files:
  created:
    - src/app/(dashboard)/accounts/actions.ts
  modified: []
decisions:
  - "deleteAccount uses UNFILTERED opportunities count (not just status='open') because closed opportunities still reference the account; deleting would orphan them."
  - "getAccount uses status='open' filter on open_opportunity_count — this is for UI display semantics (SEED-016 'open opportunities'), distinct from the delete-block check."
  - "updateAccount payload deliberately excludes org_id, created_by, source — those stay as on the row. created_by is immutable post-insert."
metrics:
  duration_minutes: ~2
  completed: 2026-05-18
---

# Phase 65 Plan 02: accounts CRUD server actions Summary

`src/app/(dashboard)/accounts/actions.ts` ships with `'use server'` and five exported server actions implementing ACC-01/02/03 end-to-end.

## File

- `src/app/(dashboard)/accounts/actions.ts` — 271 lines

## Exported Function Signatures

```typescript
export async function getAccounts(
  filters: Partial<AccountListFilters> = {},
): Promise<ActionResult<AccountListResult>>

export async function getAccount(
  id: string,
): Promise<ActionResult<AccountWithCounts>>

export async function createAccount(
  input: AccountInput,
): Promise<ActionResult<AccountRow>>

export async function updateAccount(
  id: string,
  input: AccountInput,
): Promise<ActionResult<AccountRow>>

export async function deleteAccount(
  id: string,
): Promise<ActionResult<{ deleted: string }>>
```

## ACC-03 Reference-Block Error Shape

```typescript
// When deleteAccount is called with an account that has linked contacts/opps:
{
  ok: false,
  error: 'account_has_references',
  details: { contacts: 3, opportunities: 1 }
}

// When refs are zero:
{
  ok: true,
  data: { deleted: '00000000-...' }
}
```

## Build Verification

`npm run build` exits 0. TypeScript strict mode passes.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] File starts with `'use server'`
- [x] Imports `createClient, getUser` from `@/lib/supabase/server`
- [x] Imports zod schemas + helpers from `@/lib/accounts` barrel
- [x] 5 exported async functions
- [x] `getAccounts` uses safeParse + `%/_` escape + pagination range
- [x] `getAccount` does 3 queries in `Promise.all`
- [x] `createAccount` resolves org_id via RPC + sets created_by
- [x] `updateAccount` excludes org_id/created_by/source from payload
- [x] `deleteAccount` returns `account_has_references` with `{contacts, opportunities}` details
- [x] File length 271 lines (>= 220 minimum)
- [x] `npm run build` exits 0
- [x] Commit fd124d3 landed

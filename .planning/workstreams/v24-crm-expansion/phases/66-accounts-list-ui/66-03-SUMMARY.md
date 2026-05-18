---
phase: 66-accounts-list-ui
plan: "03"
subsystem: crm-accounts
tags: [accounts, crm, bulk-actions, checkboxes, multi-select, server-actions]
dependency_graph:
  requires:
    - 66-01  # AccountsTable with selection state stub
    - 66-02  # AccountsFilters (page layout context)
    - 65-02  # deleteAccount + updateAccount server actions
  provides:
    - AccountsBulkActions component (assign/tag/delete with reference guard)
    - bulkAssignOwner and bulkAddTag server actions
    - Wire: AccountsTable conditionally renders AccountsBulkActions when selected.size > 0
  affects:
    - src/app/(dashboard)/accounts/actions.ts
    - src/components/accounts/accounts-table.tsx
    - src/components/accounts/accounts-bulk-actions.tsx
tech_stack:
  added: []
  patterns:
    - Bulk server actions using Supabase .in() filter for multi-row updates
    - Tag dedup: fetch-then-append per row (avoids array_append SQL for RLS compat)
    - Reference-blocking delete: iterate ids, collect blocked vs deleted counts, toast both
    - Dialog-per-action pattern (shadcn Dialog) with pending state guards
key_files:
  created:
    - src/components/accounts/accounts-bulk-actions.tsx
  modified:
    - src/app/(dashboard)/accounts/actions.ts
    - src/components/accounts/accounts-table.tsx
decisions:
  - "bulkAssignOwner uses .select('id') instead of { count: 'exact', head: true } — the Supabase JS client v2 .update().in().select() signature does not accept a second options argument; data.length is equivalent"
  - "bulkAddTag fetches then appends per row in JS rather than SQL array_append — RLS-scoped row-by-row update is simpler, correct, and avoids raw SQL in server actions"
  - "Delete uses window.confirm() per plan spec — no shadcn Dialog; keeps UX parity with contacts bulk-delete pattern"
  - "Empty ownerInput treated as unassign: passes empty string to action which coerces to assigned_to = null"
metrics:
  duration: "~20 minutes"
  completed: "2026-05-18"
  tasks_completed: 2
  files_created: 1
  files_modified: 2
---

# Phase 66 Plan 03: Accounts Bulk Actions Summary

Shipped multi-row checkbox selection and three bulk actions (assign owner, add tag, delete) for the accounts list. Satisfies ACC-07.

## What Was Built

**`src/components/accounts/accounts-bulk-actions.tsx`** — `'use client'` floating action bar that:
- Appears conditionally when `selected.size > 0` (rendered by AccountsTable)
- Shows "{N} selected" count + three action buttons (Assign owner, Add tag, Delete selected)
- **Assign owner button** (`<UserPlus>` icon): opens shadcn Dialog with text input for UUID/email; empty input unassigns (`assigned_to = null`); calls `bulkAssignOwner`, toasts result, clears selection, calls `onRefresh()`
- **Add tag button** (`<Tag>` icon): opens shadcn Dialog with tag name input; disabled while input is empty; calls `bulkAddTag`, toasts updated count, clears selection, calls `onRefresh()`
- **Delete selected button** (`<Trash2>` icon, rose color): `window.confirm()` guard; iterates ids calling `deleteAccount` sequentially; accumulates deleted vs blocked counts; toasts both ("Deleted N/M" + "K could not be deleted (referenced by contacts or opportunities)"); calls `onRefresh()` and clears selection

**`src/app/(dashboard)/accounts/actions.ts`** — Two new server actions appended:
- `bulkAssignOwner(ids, assignedTo)`: single `.update().in()` batch; returns `{ updated, errors }`. Empty string coerced to `null` for unassign.
- `bulkAddTag(ids, tag)`: fetches rows, skips those already tagged, updates remaining row-by-row; returns `{ updated }`.

**`src/components/accounts/accounts-table.tsx`** — Updated to:
- Import `AccountsBulkActions` from `./accounts-bulk-actions`
- Render `<AccountsBulkActions>` in the `space-y-4` container above the table container, conditional on `selected.size > 0`
- Pass `onClearSelection={() => setSelected(new Set())}` and `onRefresh={() => router.refresh()}`

## Deviations from Plan

### Auto-fixed: Supabase .select() signature mismatch

**Found during:** Task 1 build verification

**Issue:** The plan spec used `.select('id', { count: 'exact', head: true })` after `.update().in()` — this overload does not exist in the Supabase JS client v2; TypeScript errors with "Expected 0-1 arguments, but got 2."

**Fix:** Changed to `.select('id')` and used `data?.length ?? 0` as the updated count. The result is semantically equivalent: returns the IDs of rows actually updated by the batch.

**Files modified:** `src/app/(dashboard)/accounts/actions.ts`

**Commit:** be3fa6f

## Known Stubs

None. All three bulk actions are fully wired to real server actions.

## Self-Check: PASSED

- `src/components/accounts/accounts-bulk-actions.tsx` — created, exports `AccountsBulkActions`
- `src/app/(dashboard)/accounts/actions.ts` — exports `bulkAssignOwner` and `bulkAddTag`
- `src/components/accounts/accounts-table.tsx` — renders `AccountsBulkActions` when `selected.size > 0`
- `npm run build` exit code: 0 (TypeScript clean, `/accounts` route confirmed dynamic)
- Commit `be3fa6f` — verified in git log

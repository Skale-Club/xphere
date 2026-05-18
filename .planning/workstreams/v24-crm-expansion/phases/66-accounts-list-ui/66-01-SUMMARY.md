---
phase: 66-accounts-list-ui
plan: "01"
subsystem: crm-accounts
tags: [accounts, crm, table, pagination, server-component]
dependency_graph:
  requires:
    - 65-02  # getAccounts action + AccountRow types
  provides:
    - /accounts route with server-rendered table shell
    - AccountsTable client component (extendable by 66-02 filters, 66-03 bulk actions)
  affects:
    - src/app/(dashboard)/accounts/
    - src/components/accounts/
tech_stack:
  added: []
  patterns:
    - Server component page shell + inner async AccountsBody component
    - Client AccountsTable with URL-driven pagination via useRouter/useSearchParams
    - Suspense + TableSkeleton fallback
key_files:
  created:
    - src/app/(dashboard)/accounts/page.tsx
    - src/components/accounts/accounts-table.tsx
  modified: []
decisions:
  - "AccountsTable uses AccountRow (not AccountWithCounts) from list action — count columns show '—' until getAccounts is extended with JOIN counts in a future plan"
  - "pipeline_value column rendered as '—' — field not yet in schema; column structurally present for future wiring"
  - "No bulk-action bar rendered in 66-01 — selection state (toggleRow/toggleAll) included so Plan 66-03 can extend without restructuring"
metrics:
  duration: "~25 minutes"
  completed: "2026-05-18"
  tasks_completed: 2
  files_created: 2
  files_modified: 0
---

# Phase 66 Plan 01: Accounts List Page + AccountsTable Summary

Shipped the read-only `/accounts` route: a server-component page shell with Suspense + skeleton, and an 8-column `AccountsTable` client component with URL-driven pagination.

## What Was Built

**`src/app/(dashboard)/accounts/page.tsx`** — Async server component that:
- Parses `searchParams` (q, industry, size, tag, assigned_to, source, page) with proper validation against `ACCOUNT_SIZES` and `ACCOUNT_SOURCES`
- Renders a "Companies" hero header with `Building2` icon
- Wraps an inner `AccountsBody` server component in `<Suspense fallback={<TableSkeleton rows={8} columns={8} />}>`
- Calls `getAccounts()` and passes results to `AccountsTable`; on error falls back to empty rows

**`src/components/accounts/accounts-table.tsx`** — `'use client'` component that:
- Renders an 8-column CSS grid: checkbox | Company (link) | Domain | Contacts | Deals | Pipeline | Tags | Added
- Company column shows `Building2` icon + name linked to `/accounts/[id]`
- Tags rendered as chips (up to 2 visible, `+N` remainder)
- Pipeline value formatted via `formatCurrency` from `@/lib/pipeline/format`; shows `—` when absent
- `relativeTime()` helper for the Added column
- `React.useState<Set<string>>` selection with `toggleRow` / `toggleAll` (bulk-action bar deferred to Plan 66-03)
- URL-driven pagination via `useRouter` + `useSearchParams` + `setParam('page', ...)`
- Empty state message when `rows.length === 0`

## Deviations from Plan

### Auto-adjusted: Type shape mismatch between action return and component props

**Found during:** Task 1 implementation

**Issue:** The plan spec said `rows: AccountWithCounts[]` but `getAccounts()` returns `AccountListResult` where `rows: AccountRow[]` — no `contact_count`, `open_opportunity_count`, or `pipeline_value` fields in the list query. `AccountWithCounts` only exists on the `getAccount` (detail) action.

**Fix:** Introduced a local `AccountWithListCounts = AccountRow & { contact_count?: number; open_opportunity_count?: number; pipeline_value?: number | null }` type in the component. Count columns show `—` when not present, which is accurate for the list query. The columns remain structurally in place — Plan 66-02 can update `getAccounts` to JOIN counts and pass them through without changing the component API.

**Files modified:** `src/components/accounts/accounts-table.tsx`

## Known Stubs

| Column | File | Reason |
|---|---|---|
| Contacts count | `accounts-table.tsx` | `getAccounts` doesn't JOIN contact counts; shows `—` |
| Deals count | `accounts-table.tsx` | `getAccounts` doesn't JOIN opportunity counts; shows `—` |
| Pipeline value | `accounts-table.tsx` | `pipeline_value` not in DB schema yet; shows `—` |

These stubs do NOT block the plan goal (ACC-04: users can view a Company list). The structural columns are correct; data population requires a future action update.

## Self-Check: PASSED

- `src/app/(dashboard)/accounts/page.tsx` — created, verified in build output
- `src/components/accounts/accounts-table.tsx` — created, compiled with zero TS errors
- `npm run build` exit code: 0
- `/accounts` route confirmed in build output as `ƒ /accounts` (dynamic server-rendered)
- Commit `ccde04f` — verified in git log

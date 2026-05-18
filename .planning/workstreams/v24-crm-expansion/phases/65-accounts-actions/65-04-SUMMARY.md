---
phase: 65-accounts-actions
plan: 04
subsystem: lib/accounts + app/dashboard/accounts
tags: [accounts, csv, import, dedup, acc-17]
dependency_graph:
  requires: [65-01, 65-02, 65-03]
  provides: [parseCsv (re-export), ACCOUNT_CSV_FIELDS, AccountCsvField, suggestAccountColumnMapping, AccountCsvPreview, previewAccountsCsv, importAccountsCsv]
  affects: [65-05, 66]
tech_stack:
  added: []
  patterns:
    - "Re-export parseCsv from @/lib/contacts/csv — single canonical parser"
    - "App-layer dedup (existingNameKeys + existingDomainKeys Sets) — required because migration 064 created only non-unique indexes"
    - "Chunked bulk insert in batches of 500; per-chunk failure non-fatal"
    - "Per-row structured errors `{ row, field?, message }` capped at 50"
    - "MAX_CSV_BYTES = 5MB gate; Phase 75 will scale via direct-to-Storage"
    - "AccountCsvPreview lives in src/lib/accounts/types.ts (not inline in actions.ts) — 'use server' files only export async functions"
key_files:
  created:
    - src/lib/accounts/csv.ts
  modified:
    - src/lib/accounts/types.ts
    - src/app/(dashboard)/accounts/actions.ts
decisions:
  - "Dedup logic runs entirely in Node, not via Postgres ON CONFLICT. Migration 064 only created NON-unique indexes (idx_accounts_org_name, idx_accounts_org_domain) — no unique constraints. App-layer dedup is the only option and matches brief §14."
  - "csv.ts is a thin wrapper re-exporting parseCsv from @/lib/contacts/csv. No duplicate parser implementation. Heuristic header→field mapper handles English + PT-BR (empresa, nome, dominio, setor, telefone, endereco)."
  - "AccountCsvPreview interface declared in src/lib/accounts/types.ts (NOT inline in actions.ts). 'use server' modules should only export async functions; non-async exports from those files are fragile across Next.js versions."
  - "Skip-on-match semantics (not update_existing) — brief §14 LOCKED for v1. Phase 75 introduces the streaming import pipeline with update_existing strategy."
metrics:
  duration_minutes: ~3
  completed: 2026-05-18
---

# Phase 65 Plan 04: accounts CSV import Summary

ACC-17 (bulk import accounts from CSV) is implementable end-to-end at the action layer. The import wizard UI lives in Phase 66; this plan ships the data layer.

## Files

| File                                          | Lines | Status     | Purpose                                                            |
| --------------------------------------------- | ----- | ---------- | ------------------------------------------------------------------ |
| `src/lib/accounts/csv.ts`                     | 67    | **new**    | parseCsv re-export + ACCOUNT_CSV_FIELDS + suggestAccountColumnMapping |
| `src/lib/accounts/types.ts`                   | 70    | modified   | Finalized AccountCsvPreview (was marker comment, now real interface)  |
| `src/app/(dashboard)/accounts/actions.ts`     | 722   | modified   | Appended previewAccountsCsv + importAccountsCsv (+ MAX_CSV_BYTES const) |

`src/lib/accounts/` now contains 5 files (schema.ts, normalise.ts, types.ts, index.ts, csv.ts) — all 5 are re-exported through the barrel except `csv.ts` which is imported directly when callers need the parser or heuristic mapper.

## All 10 Exported Action Signatures

```typescript
// From Plan 65-02 (CRUD)
export async function getAccounts(filters?): Promise<ActionResult<AccountListResult>>
export async function getAccount(id): Promise<ActionResult<AccountWithCounts>>
export async function createAccount(input): Promise<ActionResult<AccountRow>>
export async function updateAccount(id, input): Promise<ActionResult<AccountRow>>
export async function deleteAccount(id): Promise<ActionResult<{ deleted: string }>>

// From Plan 65-03 (merge + linking)
export async function mergeAccounts(input): Promise<ActionResult<MergeAccountsResult>>
export async function linkContactToAccount(input): Promise<ActionResult<{ contact_id; account_id }>>
export async function createAccountFromContact(input): Promise<ActionResult<AccountRow>>

// New in Plan 65-04
export async function previewAccountsCsv(
  csvText: string,
): Promise<ActionResult<AccountCsvPreview>>

export async function importAccountsCsv(
  csvText: string,
  mapping: Record<string, AccountCsvField | null>,
): Promise<ActionResult<AccountImportSummary>>
```

## AccountCsvPreview Lives in types.ts (NOT inline in actions.ts)

```typescript
// src/lib/accounts/types.ts
import type { AccountCsvField } from './csv'

export interface AccountCsvPreview {
  headers: string[]
  rows: string[][]
  suggestedMapping: Record<string, AccountCsvField | null>
  totalRows: number
}
```

```typescript
// src/app/(dashboard)/accounts/actions.ts
import {
  // ...
  type AccountCsvPreview,
} from '@/lib/accounts'  // <-- IMPORTED, not declared inline
```

The plan-checker explicitly flagged inline interface declaration in `'use server'` files as anti-pattern. This implementation routes the type through the canonical types module.

## Sample importAccountsCsv Summary

Given a 10-row CSV with 3 rows whose `(lower(name))` or `normaliseDomain(domain)` already matches an existing account in the org, calling `importAccountsCsv(csvText, mapping)`:

```json
{
  "ok": true,
  "data": {
    "inserted": 7,
    "skipped": 3,
    "errors": []
  }
}
```

Re-running the SAME CSV (already imported) produces:

```json
{
  "ok": true,
  "data": {
    "inserted": 0,
    "skipped": 10,
    "errors": []
  }
}
```

This idempotency on rerun is the cornerstone of ACC-17 and is directly tested in Plan 65-05 Task 3.

## No UNIQUE Constraints on accounts

Migration 064 added two indexes on accounts:
- `idx_accounts_org_name (org_id, lower(name))` — non-unique
- `idx_accounts_org_domain (org_id, domain) WHERE domain IS NOT NULL` — non-unique

There are **no unique constraints** on either pair. This is why importAccountsCsv does app-layer dedup (single existing-rows SELECT + Sets) instead of `ON CONFLICT DO NOTHING`. Phase 65 explicitly does NOT add unique constraints — the brief locks this as a v1 trade-off.

## Build Verification

`npm run build` exits 0. Next.js production build + TypeScript strict mode pass with the new `csv.ts` imports and the `AccountCsvPreview` import wired through the barrel.

## Deviations from Plan

None — plan executed exactly as written.

## Self-Check: PASSED

- [x] `src/lib/accounts/csv.ts` exists (67 lines, >= 50 minimum)
- [x] `parseCsv` and `ParsedCsv` re-exported from `@/lib/contacts/csv` (no inline parser)
- [x] `ACCOUNT_CSV_FIELDS` const tuple of 10 strings exported
- [x] `AccountCsvField` type derived from the tuple
- [x] `suggestAccountColumnMapping` handles English + PT-BR (empresa, nome, dominio, setor, telefone, endereco)
- [x] `AccountCsvPreview` declared in `src/lib/accounts/types.ts` and reachable through `@/lib/accounts` barrel
- [x] `actions.ts` IMPORTS `AccountCsvPreview` (does NOT declare inline)
- [x] `previewAccountsCsv` returns preview with first 5 rows + suggested mapping + totalRows
- [x] `importAccountsCsv` enforces `name_column_required` when no name mapping
- [x] `importAccountsCsv` rejects empty csv with `'csv_empty'` and oversized with `'csv_too_large'`
- [x] `importAccountsCsv` builds `existingNameKeys` + `existingDomainKeys` from a single SELECT
- [x] `importAccountsCsv` ALSO dedups within the batch via `seenInBatchNames` + `seenInBatchDomains`
- [x] Inserted rows have `source: 'csv_import'`
- [x] Chunk size constant `const CHUNK = 500`
- [x] `actions.ts` line count 722 (>= 480 minimum)
- [x] `npm run build` exits 0

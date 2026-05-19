---
phase: 75-import-history-retry-tests
plan: 01
status: complete
completed_at: 2026-05-19
requirements_completed:
  - IMP-10
  - IMP-11
  - IMP-12
  - IMP-13
  - IMP-14
  - IMP-15
  - IMP-16
  - IMP-20
---

# 75-01 Summary: Processing Worker + History UI + Tests

## Supabase Edge Function (`supabase/functions/process-imports/index.ts`)

Full Deno processing worker. Triggered via:
1. HTTP POST with `{ importId }` body (invoked directly from `enqueueImport`)
2. Supabase Database Webhook on `contact_imports` INSERT/UPDATE where `status = 'queued'` (recommended for production reliability — manual setup in Supabase Dashboard → Database → Webhooks)

**Claim flow (IMP-10):**
- Reads all `processing` rows to compute per-org count (cap=2) and global count (cap=8)
- Atomic CAS: `UPDATE ... SET status='processing' WHERE status='queued'` — SKIP LOCKED semantics via single-row UPDATE
- Returns HTTP 200 immediately after claiming; processing runs via `EdgeRuntime.waitUntil()` (background)

**Processing loop (IMP-11, IMP-12, IMP-13, IMP-20):**
- Downloads CSV from `contact-imports` Storage bucket
- Inline CSV parser + `normalisePhone` + `normaliseEmail` (Deno-compatible, no Node.js imports)
- Processes in chunks of 200 rows
- Batch dedup: collects chunk's phones/emails → single `IN` query per key per chunk
- Dedup strategies: `skip_existing` / `update_existing` (non-empty wins) / `create_duplicate`
- Per-row errors inserted into `contact_import_errors` (IMP-13)
- Progress update after each chunk: `processed_rows`, `inserted_rows`, `updated_rows`, `skipped_rows`, `error_rows` → triggers Supabase Realtime subscribers (IMP-11)
- Cancellation check: re-reads `status` between chunks; stops cleanly if `cancelled` (IMP-12)
- Account auto-create (IMP-20): when company name is present and company is mapped, calls `findOrCreateAccount` which uses `ilike` dedup by name per org

**Final statuses:** `completed` (0 errors), `partial` (some errors), `failed` (all errors or 0 processed)

## Updated `enqueueImport` (`import-actions.ts`)

After setting `status='queued'`, invokes Edge Function via `createServiceRoleClient().functions.invoke('process-imports', { body: { importId } })`. Edge Function returns fast (after claiming); actual processing is background. Server action waits < 1s.

## History server actions (`import-history-actions.ts`)

| Action | Description |
|--------|-------------|
| `getImports()` | Last 100 imports for current org, newest first |
| `getImport(id)` | Single import row |
| `getImportErrors(importId, page, pageSize)` | Paginated errors (50/page default) |
| `cancelImport(id)` | Sets `status='cancelled'`; only valid for `queued`/`processing` |
| `exportImportErrors(id)` | Returns `{ csv: string }` with `_row_number`, `_field`, `_error_message` + all raw_row columns |
| `retryImport(id)` | Reconstructs CSV from `contact_import_errors.raw_row`, uploads to Storage via service role, creates new `contact_imports` row with same config, invokes worker |

## UI

### `/contacts/imports` (list page, IMP-16)
Server component. Table with: filename, StatusPill, progress bar (processed/total %), row counts (inserted/updated/skipped/errors color-coded), started timestamp, duration. "View import history" link added to contacts page header.

### `/contacts/imports/[id]` (detail page)
- `page.tsx`: server component fetches initial import row + first 50 errors in parallel
- `import-detail-client.tsx`: `'use client'` component that subscribes to Realtime `postgres_changes` on `contact_imports` filtered by `id=eq.{id}` → live updates to progress bar, counters, status (IMP-11)
- Actions: Cancel (IMP-12), Retry {N} failed rows (IMP-15), Export errors (IMP-14)
- Error list shows row number, error message, raw row preview

### Import wizard success screen
Added "View progress" link → `/contacts/imports` so users reach the list immediately after queuing.

## Tests (`tests/import-history.test.ts`) — 31 passing

| Suite | Tests | Covers |
|-------|-------|--------|
| StatusPill classes | 6 | color correctness per status |
| Progress percent | 3 | calculation logic |
| Concurrency caps (IMP-10) | 5 | per-org 2, global 8, third-job block |
| Final status derivation | 5 | completed/partial/failed conditions |
| Retry CSV reconstruction | 3 | header union, comma escaping |
| Error CSV export format | 1 | metadata columns present |
| Cancel/retry eligibility | 4 | status-gated UI actions |
| Duration formatting | 4 | s/m/h + null handling |

## Key decisions

- Edge Function returns immediately after `claimed` check; `EdgeRuntime.waitUntil()` keeps function alive for processing. Fallback: await directly if runtime doesn't support waitUntil (non-Supabase Deno environments).
- Inline CSV parser in Edge Function avoids import dependency issues in Deno; same algorithm as `parseCsv` in csv.ts
- Retry does not require a new DB column (`parent_import_id`); the retry job is a fully independent import with same config and a reconstructed CSV from error rows
- Account auto-create (IMP-20) always runs when `company` is mapped — v1 decision: opt-out not implemented (no `auto_create_accounts` column needed)
- Database Webhook setup is a manual step (Supabase Dashboard) documented here; direct invocation from `enqueueImport` provides immediate triggering without manual config
- v2.4 milestone: all 54 requirements (ACC-01..19 + CF-01..15 + IMP-01..20) now complete

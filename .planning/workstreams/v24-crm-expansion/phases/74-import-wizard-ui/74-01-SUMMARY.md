---
phase: 74-import-wizard-ui
plan: 01
status: complete
completed_at: 2026-05-19
requirements_completed:
  - IMP-01
  - IMP-02
  - IMP-03
  - IMP-04
  - IMP-05
  - IMP-06
  - IMP-07
  - IMP-08
  - IMP-09
  - IMP-17
---

# 74-01 Summary: Import Wizard UI

## CSV lib extensions (`src/lib/contacts/csv.ts`)

- `parseCsvLimit(text, maxDataRows)`: same RFC-4180 parser as `parseCsv` but stops after reading `maxDataRows` data rows (header always parsed); avoids full 200k-row parse in preview/dry-run actions
- `countCsvDataRows(text)`: fast O(n) newline scan to approximate total rows without full parse
- `suggestColumnMappingEnhanced(headers, sampleRows, customDefs)`: combines header-regex (same as `suggestColumnMapping`) with value sampling (>50% email/phone pattern → suggest field) and custom-field label fuzzy match (`cf:key` targets)

## Server actions (`src/app/(dashboard)/contacts/import-actions.ts`)

Five `'use server'` actions composing the upload → parse → config → dry-run → enqueue pipeline:

| Action | What it does |
|--------|-------------|
| `createImportRecord(filename, sizeBytes)` | Creates `contact_imports` row (status=`uploading`), gets signed upload URL via Supabase Storage; returns `{ importId, signedUrl, storagePath, currentUserId }` |
| `finalizeUpload(importId)` | Downloads uploaded file from Storage, runs `parseCsvLimit(csvText, 5)` for preview rows + `countCsvDataRows` for total, calls `suggestColumnMappingEnhanced` with contact custom defs, sets status=`previewing` |
| `saveImportConfig(importId, config)` | Persists `mapping`, `dedup_strategy`, `dedup_keys`, `default_tags`, `default_source`, `default_assigned_to` to the `contact_imports` row |
| `dryRunImport(importId)` | Downloads file, runs `parseCsvLimit(csvText, 1000)`, batch-queries contacts by phone/email IN sets, classifies each row as would-insert/update/skip/error per `dedup_strategy`; returns counts + up to 5 sample error messages |
| `enqueueImport(importId)` | IMP-17 gate: verifies phone or email is mapped; sets status=`queued` for Phase 75 worker pickup |

## Import wizard component (`src/components/contacts/import-wizard-dialog.tsx`)

Multi-stage `'use client'` dialog (7 stages):

| Stage | Content |
|-------|---------|
| `pick` | Drop zone + file picker; 50 MB limit validated client-side; drag-and-drop supported |
| `uploading` | Real byte-level progress bar driven by `xhr.upload.addEventListener('progress')` XHR PUT to signed URL |
| `parsing` | Spinner while `finalizeUpload` server action runs |
| `mapping` | Column mapping table (base contact fields + custom fields section); CSV preview (first 5 rows); dedup strategy select; dedup keys ordered list with up/down/remove; row defaults (source, assigned owner, tags) |
| `validating` | Spinner while `dryRunImport` runs |
| `preview` | 4-column dry-run result cards (Insert/Update/Skip/Error) + sample error list; "Start import" disabled when gate fails |
| `queued` | Success state — worker picks up from queue (Phase 75) |

Key implementation notes:
- XHR PUT to `signedUrl` with `Content-Type: text/csv` — Supabase Storage signed upload URL accepts PUT requests
- IMP-17 gate enforced both in UI (`canStart` boolean disables Validate button) and in `enqueueImport` server action (double-check before setting status=queued)
- Dedup key reordering via up/down buttons (no dnd-kit needed for ≤2 keys)
- "Assign to" select shows "Unassigned" + "Myself" (currentUserId returned by `createImportRecord`)

## Page update

`src/app/(dashboard)/contacts/page.tsx`: `ImportCsvDialog` replaced with `ImportWizardDialog`; old dialog kept in place for accounts CSV flow (unaffected)

## Test coverage

`tests/import-wizard.test.ts` — 30 tests, all passing:
- `parseCsvLimit`: 5 tests
- `countCsvDataRows`: 4 tests
- `suggestColumnMappingEnhanced` (header regex): 3 tests
- `suggestColumnMappingEnhanced` (value sampling): 3 tests
- `suggestColumnMappingEnhanced` (custom field matching): 2 tests
- IMP-17 required-mapping gate: 6 tests
- Dedup key reordering: 4 tests
- Dry-run classification: 3 tests

## Key decisions

- `parseCsvLimit` stops parsing after N data rows to keep server action latency acceptable for 50 MB files (avoid parsing 200k rows for a 5-row preview)
- `countCsvDataRows` trades accuracy (embedded newlines in quoted fields) for speed — acceptable for progress bar display
- XHR PUT (not fetch) used for real `upload.onprogress` events; standard fetch API does not expose upload progress in all environments
- `currentUserId` returned from `createImportRecord` so the client can offer "Assign to myself" without a separate fetch
- Old `ImportCsvDialog` (5 MB sync flow) retained in the codebase but no longer linked from the contacts page; can be removed in Phase 75 cleanup

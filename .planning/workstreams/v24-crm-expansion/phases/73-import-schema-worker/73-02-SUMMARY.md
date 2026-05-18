---
phase: 73-import-schema-worker
plan: "02"
status: complete
completed: 2026-05-18
requirements_addressed: [IMP-18, IMP-19]
---

# Plan 73-02 Summary — Import Pipeline Interfaces + Database Types

## What was built

**`src/lib/import/storage.ts`** — `ContactImportStorage` interface:
- `getSignedUploadUrl(orgId, filename): Promise<{url, path}>`
- `streamFile(path): Promise<ReadableStream<Uint8Array>>`

**`src/lib/import/storage-supabase.ts`** — `SupabaseImportStorage` concrete implementation backed by Supabase Storage `contact-imports` bucket

**`src/lib/import/worker.ts`** — `ImportWorkerEntry` interface:
- `processNextImport(claimTimeoutMs): Promise<ClaimResult>`
where `ClaimResult = {claimed: true, importId: string} | {claimed: false}`

**`src/lib/import/worker-supabase.ts`** — `SupabaseImportWorkerEntry` stub satisfying the interface (actual processing loop ships in Phase 75)

**`src/types/database.ts`** — extended with:
- `ContactImportStatus` literal union (9 values)
- `ContactImportDedupStrategy` literal union (3 values)
- `contact_imports` table type (Row/Insert/Update/Relationships)
- `contact_import_errors` table type (Row/Insert/Update/Relationships)

## Hetzner portability note

Only `storage-supabase.ts` and `worker-supabase.ts` are replaced post-migration. All callers use the interface types and remain untouched.

---
phase: 105
plan: 01
subsystem: contact-identity
tags: [migration, database, generated-columns, rls, audit]
requirements: [CID-01, CID-02, CID-03]
dependency_graph:
  requires:
    - "supabase/migrations/051_contacts.sql (contacts table)"
    - "supabase/migrations/1055_lock_get_tag_usage_search_path.sql (previous migration)"
    - "public.get_current_org_id() (RLS helper)"
    - "public.organizations table (FK target)"
  provides:
    - "public.normalize_phone(text) IMMUTABLE SQL function"
    - "public.contacts.phone_e164 (STORED generated column)"
    - "public.contacts.email_normalized (STORED generated column)"
    - "public.contacts.identity_status (text + CHECK)"
    - "public.contact_duplicate_audit table + RLS"
    - "public.refresh_contact_duplicate_audit() SECURITY DEFINER function"
  affects:
    - "Phase 105-02: applies migration via Supabase branch"
    - "Phase 105-03: applies migration to prod + regen types"
    - "Phase 106: reads contact_duplicate_audit for merge UI"
    - "Phase 107: adds UNIQUE indexes on phone_e164 / email_normalized"
tech-stack:
  added:
    - "Postgres STORED generated columns (first use in this repo for contacts)"
  patterns:
    - "IMMUTABLE SQL function powering STORED generated column"
    - "CHECK constraint enumerating future enum values (extensibility)"
    - "SECURITY DEFINER refresh function with locked search_path"
    - "RLS via get_current_org_id() with (SELECT ...) wrapper for plan caching"
key-files:
  created:
    - "supabase/migrations/1056_contact_identity_audit.sql"
  modified: []
decisions:
  - "D-01 honored: contact_duplicate_audit table created exactly per spec (7 columns, indexed for Phase 106 query patterns)"
  - "D-02 honored: normalize_phone() declared IMMUTABLE PARALLEL SAFE, body mirrors TS normalisePhone byte-for-byte across the 10-row equivalence table"
  - "D-02b honored: email_normalized uses inline NULLIF(lower(btrim(coalesce(...))), '') — no separate function"
  - "D-03 honored: per-row backfill UPDATE targets only channel_only predicate; DEFAULT 'identified' covers everything else"
  - "D-03b honored: CHECK enumerates all 5 future values (channel_only/identified/verified/merge_conflict/archived_duplicate)"
  - "D-04a honored: migration numbered 1056 (next after 1055_lock_get_tag_usage_search_path.sql)"
metrics:
  duration: "73s"
  completed: "2026-05-25T22:07:05Z"
  tasks: 1
  files_created: 1
  files_modified: 0
---

# Phase 105 Plan 01: Author Contact Identity Audit Migration — Summary

Authored `supabase/migrations/1056_contact_identity_audit.sql` containing all 7 ordered sections required by Phase 105 (normalize_phone function, phone_e164 / email_normalized STORED generated columns, identity_status with CHECK + backfill, contact_duplicate_audit table with RLS, refresh_contact_duplicate_audit SECURITY DEFINER function). The migration is ready for Plan 02 to apply on a Supabase branch.

## What Shipped

**File:** `supabase/migrations/1056_contact_identity_audit.sql` (178 lines, 6.74 KB)

**Sections (in order):**

1. `CREATE OR REPLACE FUNCTION public.normalize_phone(input text)` — IMMUTABLE PARALLEL SAFE SQL function mirroring `src/lib/contacts/zod-schemas.ts:20-28`.
2. `ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS phone_e164 text GENERATED ALWAYS AS (public.normalize_phone(phone)) STORED`.
3. `ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS email_normalized text GENERATED ALWAYS AS (NULLIF(lower(btrim(coalesce(email, ''))), '')) STORED`.
4. `ALTER TABLE public.contacts ADD COLUMN IF NOT EXISTS identity_status text NOT NULL DEFAULT 'identified' CHECK (...)` enumerating all 5 future values.
5. Backfill UPDATE: `SET identity_status = 'channel_only' WHERE phone IS NULL AND email IS NULL AND source IN ('instagram','whatsapp','facebook','messenger') AND external_id IS NOT NULL`.
6. `CREATE TABLE IF NOT EXISTS public.contact_duplicate_audit (...)` with FK to organizations, two indexes (`idx_cda_org_size`, `idx_cda_org_match_type`), RLS enabled, SELECT policy via `get_current_org_id()`.
7. `CREATE OR REPLACE FUNCTION public.refresh_contact_duplicate_audit()` SECURITY DEFINER with `SET search_path = public, pg_temp`, TRUNCATE + dual INSERT...SELECT (phone and email clusters with `HAVING count(*) >= 2`). GRANT EXECUTE to `authenticated`, REVOKE from public.

## Verification

All 24 grep-able tokens from `<acceptance_criteria>` matched in the file. Forbidden-pattern check (no writes to generated columns, no UNIQUE indexes) passed.

```
$ node -e "<verify script>"
OK file size: 6743 bytes
$ node -e "<forbidden pattern check>"
forbidden patterns found: 0
clean
```

File size 6743 bytes is within the plan's expected 4KB-8KB band.

## Commit

| Task | Description | Commit |
|------|-------------|--------|
| 1    | Write migration 1056 with all 7 sections | `f02d40b` |

## Deviations from Plan

None — plan executed exactly as written. SQL was copied verbatim from `105-RESEARCH.md` "Code Examples" section as instructed.

## Out of Scope (correctly deferred)

- Migration application — Plan 02 handles via Supabase branch.
- TypeScript type regeneration (`src/types/database.ts`) — Plan 03 handles after prod apply.
- UNIQUE indexes on `phone_e164` / `email_normalized` — Phase 107.
- Merge UI reading `contact_duplicate_audit` — Phase 106.

## Self-Check: PASSED

- File `supabase/migrations/1056_contact_identity_audit.sql` — FOUND
- Commit `f02d40b` — FOUND in git log

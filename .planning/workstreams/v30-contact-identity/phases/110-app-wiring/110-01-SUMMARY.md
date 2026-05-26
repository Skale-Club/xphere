---
phase: 110-app-wiring
plan: 01
subsystem: contact-identity
tags: [migration, rls, supabase, types, verification]
requires:
  - 1056 (contacts.identity_status)
  - 1057 (RLS template + org_members admin gating)
provides:
  - contact_verifications table (audit log)
  - 4 RLS policies (SELECT org members; INSERT/UPDATE/DELETE org admins)
  - UNIQUE (org_id, contact_id, identifier_type, identifier_value) idempotency key
  - INDEX idx_contact_verifications_contact_id (reverse lookup)
  - TS Row/Insert/Update types in database.ts
affects:
  - future markContactVerified server action (Plan 110-02+)
  - badge "verified" sub-state derivation
tech-stack:
  added: []
  patterns:
    - pooler-pg apply script with SAVEPOINT-wrapped probes (mirrors apply-1060/1061)
    - RLS admin gate via org_members.role='admin' (mirrors 1057)
key-files:
  created:
    - supabase/migrations/1062_contact_verifications.sql (4551 bytes)
    - apply-1062.mjs (6511 bytes)
  modified:
    - src/types/database.ts (+33 lines: contact_verifications Tables entry)
decisions:
  - D-05 (table shape: id, org_id, contact_id, identifier_type, identifier_value, method, verified_at, verified_by + UNIQUE + INDEX + RLS)
  - D-05a (wide method enum: 'manual','sms_reply','email_click','oauth' to avoid future ALTER)
metrics:
  duration_seconds: 291
  completed_date: 2026-05-26T14:34:04Z
  tasks: 2
  files_changed: 3
  commits: 2
---

# Phase 110 Plan 01: contact_verifications Schema Summary

Verification audit log table (migration 1062) for v3.0 contact-identity. One-row-per (contact, identifier) pair with idempotent re-verification via UNIQUE; 4 RLS policies mirroring 1057's admin gate; wide `method` enum so Phase 110 (`manual` only) and future SMS/email/oauth triggers share schema without ALTER.

## Tasks Completed

| Task | Name                                                                            | Commit  | Files                                                                                |
| ---- | ------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------ |
| 1    | Author migration 1062 + apply-1062.mjs with 4 SQL probes; apply to prod         | b55820e | supabase/migrations/1062_contact_verifications.sql, apply-1062.mjs                   |
| 2    | Manual patch src/types/database.ts for contact_verifications; npm run build green | b9a025b | src/types/database.ts                                                                |

## Migration 1062 Details

**File:** `supabase/migrations/1062_contact_verifications.sql` (4551 bytes)
**Body:**
- `CREATE TABLE contact_verifications` with columns:
  - `id uuid PK DEFAULT gen_random_uuid()`
  - `org_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE`
  - `contact_id uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE`
  - `identifier_type text NOT NULL CHECK IN ('phone','email')`
  - `identifier_value text NOT NULL`
  - `method text NOT NULL CHECK IN ('manual','sms_reply','email_click','oauth')`
  - `verified_at timestamptz NOT NULL DEFAULT now()`
  - `verified_by uuid REFERENCES auth.users(id) ON DELETE SET NULL`
  - `UNIQUE (org_id, contact_id, identifier_type, identifier_value)`
- `CREATE INDEX idx_contact_verifications_contact_id ON contact_verifications(contact_id)` (reverse lookup for badge logic)
- `COMMENT ON TABLE` + `COMMENT ON COLUMN method` documenting D-05a wide-enum intent
- `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`
- 4 policies:
  - `contact_verifications_select` — SELECT to authenticated, USING `org_id = get_current_org_id()`
  - `contact_verifications_insert` — INSERT to authenticated, WITH CHECK org match + admin gate
  - `contact_verifications_update` — UPDATE to authenticated, USING org match, WITH CHECK org match + admin gate
  - `contact_verifications_delete` — DELETE to authenticated, USING org match + admin gate

Admin gate exactly mirrors `contact_merge_exclusions` from 1057 (`EXISTS (SELECT 1 FROM org_members WHERE user_id=auth.uid() AND organization_id=...org_id AND role='admin')`).

## apply-1062.mjs Probe Results

All 4 probes ran inside a single BEGIN/COMMIT transaction with SAVEPOINT wrappers around state-mutating probes (3 and 4). Final COMMIT occurred only after every probe passed; record in `supabase_migrations.schema_migrations` (version=1062) was inserted in the same transaction.

```
Applying supabase/migrations/1062_contact_verifications.sql (4551 bytes) to xphere prod...
  ✓ migration body applied
  ✓ probe: table contact_verifications exists
  ✓ probe: index idx_contact_verifications_contact_id exists
  ✓ probe: UNIQUE collision returns 23505
  ✓ probe: CASCADE delete on contacts removes verifications
  ✓ recorded in schema_migrations
  ✓ committed
migration 1062 applied
```

| # | Probe                                            | Mechanism                                                                                          | Outcome           |
| - | ------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ----------------- |
| 1 | Table exists                                     | `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='contact_verifications'` | 1 row returned    |
| 2 | Index exists                                     | `SELECT 1 FROM pg_indexes WHERE indexname='idx_contact_verifications_contact_id'`                  | 1 row returned    |
| 3 | UNIQUE collision raises 23505                    | Two INSERTs with same `(org_id, contact_id, 'phone', probeValue)` inside SAVEPOINT; ROLLBACK after | Second INSERT raised 23505; SAVEPOINT rolled back |
| 4 | CASCADE on contact delete                        | INSERT temp contact + verification, DELETE contact, assert verification row gone; SAVEPOINT rollback after | Verification row absent post-DELETE; SAVEPOINT rolled back |

## TS Types Patch

`src/types/database.ts` gained a `contact_verifications` Tables entry (alphabetical placement between `contact_tags` and `opportunity_tags`):

- `Row` — 8 fields, exact NULL semantics (`verified_by: string | null`), literal unions for `identifier_type` and `method` mirroring the CHECK enums.
- `Insert` — `id`/`verified_at`/`method`/`verified_by` optional; `org_id`/`contact_id`/`identifier_type`/`identifier_value` required.
- `Update` — all optional.
- `Relationships: []` (kept inline-empty per Phase 108 precedent — runtime queries do not depend on this metadata; the FK constraints exist at the DB level).

## Build Verification

`npm run build` exits 0. Widget bundles built (13.6kb + 12.8kb). Next.js production build completed including TS type check across all routes. No TS errors introduced by the new Tables entry. Pre-existing modified files (`copilot-*`, dashboard pages) are unrelated to this plan and were not touched.

## Decisions Implemented

- **D-05 (table shape):** Exact columns, types, CHECK enums, UNIQUE, INDEX, RLS policy set as specified in 110-CONTEXT.md.
- **D-05a (wide method enum):** CHECK constraint enumerates all four values; Phase 110 writes only `manual`, future phases reuse without ALTER.

## Deviations from Plan

None. Plan executed exactly as written:
- Migration body matches RESEARCH.md §"Migration 1062 Body" verbatim.
- 4 probes mapped 1:1 to plan spec (table, index, UNIQUE 23505, CASCADE).
- SAVEPOINT wrappers used per plan to isolate state-mutating probes from the outer txn.
- Manual type patch placed alphabetically; no other entries touched.
- No edits to migrations 1056-1061 or any `apply-105X.mjs` / `apply-106X.mjs` script.

## Authentication Gates

None.

## Known Stubs

None. The table is schema-only at this plan boundary; the `markContactVerified` server action and badge wiring land in later 110-XX plans.

## Self-Check: PASSED

- `supabase/migrations/1062_contact_verifications.sql` — FOUND (4551 bytes)
- `apply-1062.mjs` — FOUND (6511 bytes)
- `src/types/database.ts` contains `contact_verifications:` — FOUND
- Commit `b55820e` — FOUND (`feat(110-01): add contact_verifications table (migration 1062)`)
- Commit `b9a025b` — FOUND (`feat(110-01): add contact_verifications types to database.ts`)
- `migration 1062 applied` stdout from apply-1062.mjs — observed
- 4/4 probes green — observed
- `npm run build` exit 0 — observed

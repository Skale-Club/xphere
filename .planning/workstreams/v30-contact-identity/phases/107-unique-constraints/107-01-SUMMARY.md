---
phase: 107-unique-constraints
plan: 01
subsystem: contacts / database / identity
tags: [migration, partial-unique-index, contacts, identity, race-safety, ddl]
requirements: [CID-07, CID-08]
dependency_graph:
  requires:
    - 1056 (generated columns phone_e164 + email_normalized, identity_status CHECK)
    - 1057 (refresh_contact_duplicate_audit with archived-row filter + merge tool)
  provides:
    - "contacts_org_phone_uniq partial UNIQUE index (org_id, phone_e164) WHERE phone_e164 IS NOT NULL AND identity_status <> 'archived_duplicate'"
    - "contacts_org_email_uniq partial UNIQUE index (org_id, email_normalized) WHERE email_normalized IS NOT NULL AND identity_status <> 'archived_duplicate'"
    - "Audit-guard pattern in migration head (refresh -> abort-if-clusters)"
  affects:
    - createContact server action (Plan 107-02 will refactor)
    - whatsapp/evolution/telegram webhook contact-creation paths (Plan 107-03)
    - manual contact form callers (Plan 107-04)
tech_stack:
  added:
    - "pg ^8.21.0 (devDependency) — required by apply scripts + Plan 107-05 race tests"
  patterns:
    - "Audit-guard migration body: PERFORM refresh + SELECT count + RAISE EXCEPTION"
    - "Partial UNIQUE index with predicate matching planned ON CONFLICT inference clause"
    - "Pooler-safe applier via local pg.Client wrapped in single transaction"
key_files:
  created:
    - supabase/migrations/1059_contacts_unique_constraints.sql
    - .planning/workstreams/v30-contact-identity/phases/107-unique-constraints/apply-1059.mjs
    - .planning/workstreams/v30-contact-identity/phases/107-unique-constraints/probe-1059.mjs
  modified:
    - package.json (added pg devDependency)
    - package-lock.json
decisions:
  - "Renumbered migration 1058 -> 1059 because 1058_mcp_oauth.sql landed in main first (parallel branch). DDL is fully idempotent (IF NOT EXISTS) so re-apply was safe."
  - "Used plain CREATE UNIQUE INDEX (no CONCURRENTLY) per D-05b — atomic in implicit migration transaction; prod has 1 contact so cost is negligible."
  - "Audit guard runs BEFORE index creation (D-05a): PERFORM refresh first, then SELECT count, then RAISE if > 0. If guard fires, indexes never attempted and migration fails atomically."
  - "Added pg as devDependency rather than requiring user to install it ad-hoc (Rule 3 unblocking)."
metrics:
  tasks_completed: 2
  files_created: 3
  files_modified: 2
  commits: 2
  duration_minutes: ~10
  completed_at: "2026-05-26T03:01:20Z"
---

# Phase 107 Plan 01: Contacts Unique Constraints (Migration 1059) Summary

Migration delivering the two partial UNIQUE indexes (CID-07 phone, CID-08 email) authored, applied to prod, and probe-verified. Audit guard fires before any DDL; baseline of 0 clusters confirmed at apply time.

## What Was Built

### Migration body (`supabase/migrations/1059_contacts_unique_constraints.sql`)

1. **Audit guard (D-05/D-05a):**
   ```sql
   DO $$
   DECLARE cluster_count int;
   BEGIN
     PERFORM public.refresh_contact_duplicate_audit();
     SELECT count(*) INTO cluster_count FROM public.contact_duplicate_audit;
     IF cluster_count > 0 THEN
       RAISE EXCEPTION 'Migration 1058 aborted: % duplicate cluster(s) ...', cluster_count;
     END IF;
   END $$;
   ```
   At apply time, `cluster_count` evaluated to **0** (matches Phase 106 audit baseline).

2. **Phone partial UNIQUE (CID-07):**
   ```sql
   CREATE UNIQUE INDEX IF NOT EXISTS contacts_org_phone_uniq
     ON public.contacts (org_id, phone_e164)
     WHERE phone_e164 IS NOT NULL
       AND identity_status <> 'archived_duplicate';
   ```

3. **Email partial UNIQUE (CID-08):** same shape on `(org_id, email_normalized)`.

Each index gets a `COMMENT ON INDEX` explaining the partial WHERE-clause coupling to the createContact / webhook pre-check filter (so future grep finds the contract documentation in PostgreSQL itself).

### Applier (`apply-1059.mjs`)

Copied from `apply-1057.mjs` with `MIGRATION_PATH`, `MIGRATION_VERSION="1059"`, and `MIGRATION_NAME="contacts_unique_constraints"` swapped. Reads `DATABASE_URL` from `.env.local`, wraps the migration body + `INSERT INTO supabase_migrations.schema_migrations` in a single `BEGIN ... COMMIT`. Rolls back atomically on any error.

### Probe script (`probe-1059.mjs`)

Standalone post-apply verifier using the same pg.Client + `.env.local` pattern. Runs three probes against prod, all of which **PASSED** at apply time.

## Probe Results

### Probe A — Indexes exist
```
indexes present: [ 'contacts_org_email_uniq', 'contacts_org_phone_uniq' ]
  ✓ both indexes present
```
Source query:
```sql
SELECT indexname FROM pg_indexes
 WHERE schemaname='public' AND tablename='contacts'
   AND indexname IN ('contacts_org_phone_uniq','contacts_org_email_uniq')
 ORDER BY indexname;
```
Returned 2 rows. **PASS.**

### Probe B — Duplicate live INSERT raises 23505
Synthetic test: two `INSERT INTO contacts (org_id, name, phone, source)` against the same org/phone, wrapped in a `BEGIN ... SAVEPOINT ... ROLLBACK`. First row inserts; second row raises:
```
Probe B — duplicate live INSERT raises 23505: code=23505 ✓
```
**PASS.** Confirms the phone partial UNIQUE index enforces uniqueness at the database level for live (non-archived) contacts.

### Probe C — Archived_duplicate row does NOT block live INSERT
Synthetic test: first INSERT with `identity_status='archived_duplicate'` on a phone, second INSERT (default `identified`) with the same phone. Both must succeed (the partial index WHERE excludes archived rows).
```
Probe C — archived row does NOT block live INSERT: ✓ both inserts succeeded
```
**PASS.** Confirms the WHERE predicate (`identity_status <> 'archived_duplicate'`) works as intended — merged/archived rows do not block new identities sharing their phone.

### Synthetic data cleanup
Both probe transactions used `BEGIN; SAVEPOINT; ... ROLLBACK;` plus a belt-and-suspenders `DELETE FROM contacts WHERE name LIKE 'probe1058-%'`. Post-probe `SELECT count(*) FROM contacts` confirms prod still has its single pre-existing contact row.

## Apply Output

```
Applying supabase/migrations/1059_contacts_unique_constraints.sql (2700 bytes) to xphere prod...
  ✓ migration body applied
  ✓ recorded in schema_migrations
  ✓ committed
```

schema_migrations row:
```
{ version: '1059', name: 'contacts_unique_constraints' }
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `pg` not installed**
- **Found during:** Task 2 (first `node apply-1058.mjs` invocation)
- **Issue:** RESEARCH.md asserted `pg` was "in deps" but it was only in `package-lock.json` as an optional peer of another dep (not directly installed).
- **Fix:** `npm install --save-dev pg` — adds `"pg": "^8.21.0"` to devDependencies. Justification: pg is needed by every apply script in the workstream (1056/1057/1059) AND by the Plan 107-05 race test. devDep is the correct classification (runtime app uses @supabase/supabase-js, not pg directly).
- **Files modified:** package.json, package-lock.json
- **Commit:** 915b047

**2. [Rule 4-adjacent / auto-handled - Architectural] Migration version collision with 1058_mcp_oauth.sql**
- **Found during:** Task 2 (post-apply schema_migrations probe)
- **Issue:** Plan/RESEARCH assumed next number was 1058, but the parallel mcp-oauth branch (commit `1c65462`) landed `supabase/migrations/1058_mcp_oauth.sql` first. My first apply silently kept the existing row (`ON CONFLICT DO NOTHING`) and registered as `version=1058, name=mcp_oauth` — meaning my DDL ran but the audit trail was misattributed.
- **Fix:** Renamed migration + apply + probe to `1059_*`, updated `MIGRATION_VERSION` constant to `"1059"`, re-ran apply. Idempotent DDL (`CREATE UNIQUE INDEX IF NOT EXISTS`) means the second run was a no-op for index creation but produced the correct schema_migrations row.
- **Why not Rule 4 (ask user)?** Strictly speaking this is a numbering collision, not an architectural change — DDL identical, index names identical, behavior identical. Renumbering is mechanical and reversible. Treated as Rule 3 (blocking issue: need a clean schema_migrations record).
- **Files affected:** rename of migration file (committed as part of `db3b525` by a concurrent user commit that included unrelated TopBar changes), apply-1059.mjs, probe-1059.mjs.
- **Commit:** 915b047

### Authentication Gates
None.

## Files Created / Modified

| Path | Status | Purpose |
| --- | --- | --- |
| `supabase/migrations/1059_contacts_unique_constraints.sql` | created | Migration body — guard + 2 partial UNIQUE indexes |
| `.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/apply-1059.mjs` | created | Pooler-safe applier (pg.Client, single transaction) |
| `.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/probe-1059.mjs` | created | Post-apply probes A/B/C |
| `package.json` | modified | Added `"pg": "^8.21.0"` to devDependencies |
| `package-lock.json` | modified | Lock for pg + transitive deps |

## Commits

| Hash | Subject |
| --- | --- |
| `211d744` | feat(107-01): add migration 1058 partial UNIQUE indexes on contacts (Task 1 — file later renamed to 1059) |
| `915b047` | feat(107-01): apply migration 1059 partial UNIQUE indexes + probes |

Note: between these two, an unrelated concurrent user commit (`db3b525`, "feat(top-bar): hide dial-pad button until org connects a phone number") swept the migration file rename (1058 → 1059) into its diff. The functional outcome is unchanged — both the rename and the unrelated TopBar changes are now in main.

## Success Criteria — All Met

- [x] supabase/migrations/1059_contacts_unique_constraints.sql exists (renamed from 1058)
- [x] apply-1059.mjs created at `.planning/.../107-unique-constraints/`
- [x] Migration applied to prod; both indexes exist in `pg_indexes`
- [x] Probe B: duplicate live INSERT raises SQLSTATE `23505`
- [x] Probe C: archived row INSERT succeeds (partial WHERE excludes archived)
- [x] Synthetic test data cleaned up (ROLLBACK + DELETE)
- [x] 2 atomic task commits
- [x] schema_migrations row: `version='1059', name='contacts_unique_constraints'`

## Next Steps (downstream plans)

- **Plan 107-02:** Refactor `createContact` in `src/app/(dashboard)/contacts/actions.ts` to use the partial-index defense + catch-23505 race recovery (D-01..D-02).
- **Plan 107-03:** Harden whatsapp/evolution/telegram webhook contact-creation paths with unique-violation recovery (D-03).
- **Plan 107-04:** Form caller updates for new `matched_via` return shape (D-04 / D-04a toasts).
- **Plan 107-05:** Vitest race test (`tests/contacts-unique-constraint.test.ts`) — pg.Client now available as devDep (already wired by this plan).

## Self-Check: PASSED

- FOUND: supabase/migrations/1059_contacts_unique_constraints.sql
- FOUND: .planning/workstreams/v30-contact-identity/phases/107-unique-constraints/apply-1059.mjs
- FOUND: .planning/workstreams/v30-contact-identity/phases/107-unique-constraints/probe-1059.mjs
- FOUND: commit 211d744
- FOUND: commit 915b047
- FOUND: schema_migrations row version=1059 name=contacts_unique_constraints
- FOUND: pg_indexes contacts_org_phone_uniq, contacts_org_email_uniq

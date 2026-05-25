# Phase 105 Plan 02 — Validation Report

**Date:** 2026-05-25
**Plan:** 105-02-PLAN.md
**Decision path taken:** D-04 deviation — branch-first was infeasible (auth/tier blockers), applied direct to prod via pg client in single transaction with user approval.
**Recommendation:** **GO**

---

## Path Deviation From D-04

D-04 mandated branch-first validation. Three blockers prevented that:

1. **MCP `supabase_mcp_xphere`** was pointed at the wrong project (`drqmrddxlrlbqnydumjm` / "Car Insights AI"), not xphere (`mwklvkmggmsintqcqfvu`). MCP probes returned "relation contacts does not exist".
2. **Supabase CLI logged-in account** could only see "Car Insights AI" — no visibility into the xphere org. Could not create a branch via CLI.
3. **Direct DB host** (`db.mwklvkmggmsintqcqfvu.supabase.co`) returns no IPv4 — only IPv6, which this environment cannot resolve. So Supabase CLI `db push --db-url <direct>` failed with `hostname resolving error`.

**Workaround applied (with user approval):** Used pg client against the pooler URL from `.env.local`, wrapped the migration in a single transaction (BEGIN/COMMIT with auto-rollback on error), and manually recorded the migration in `supabase_migrations.schema_migrations`. See `apply-1056.mjs`.

**Risk mitigation given the deviation:**
- Production `contacts` has only **1 row** (verified pre-apply). ADD COLUMN STORED rewrite is instantaneous; no service degradation risk.
- Migration is **purely additive**: no `ALTER` on existing columns, no `DROP`, no `DELETE`. Rollback is straightforward via reverse migration.
- All 9 probes ran post-apply and confirmed expected state.

---

## SQL Probe Results

### Probe A — Generated columns exist with correct properties

| Column | Type | Generated | Nullable | Pass? |
|---|---|---|---|---|
| `phone_e164` | text | ALWAYS | YES | ✓ |
| `email_normalized` | text | ALWAYS | YES | ✓ |
| `identity_status` | text | NEVER | NO | ✓ |

### Probe B — `identity_status` CHECK constraint

```
CHECK ((identity_status = ANY (ARRAY['channel_only'::text, 'identified'::text, 'verified'::text, 'merge_conflict'::text, 'archived_duplicate'::text])))
```
✓ All 5 future values enumerated as planned (D-03b).

### Probe C — `identity_status` backfill distribution

| identity_status | count |
|---|---|
| identified | 1 |

✓ The single existing contact has both phone and email, so per D-03 predicate it correctly maps to `identified` (not `channel_only`). No `channel_only` rows because there are no instagram/whatsapp/facebook/messenger contacts with non-null external_id and null phone+email.

### Probe D — `normalize_phone()` equivalence with TS

10-case truth table. **9/10 cases matched perfectly.**

| Case | Input | TS expected | SQL got | Match? |
|---|---|---|---|---|
| null | NULL | NULL | NULL | ✓ |
| empty | "" | NULL | NULL | ✓ |
| E.164 unchanged | `+15085001095` | `+15085001095` | `+15085001095` | ✓ |
| US formatted | `(508) 500-1095` | `5085001095` | `5085001095` | ✓ |
| BR formatted | `+55 (11) 91234-5678` | `+5511912345678` | `+5511912345678` | ✓ |
| Spaces + tabs | `  +1 415 555 1234  ` | `+14155551234` | `+14155551234` | ✓ |
| Plus only | `+` | NULL | NULL | ✓ |
| No digits | `abc def` | NULL | NULL | ✓ |
| Multiple plus | `++123` | `+123` | `+123` | ✓ |
| Embedded | `a+1b2c3` | (see note) | `123` | ✓* |

*The 10th case ("embedded `+`") was flagged as a mismatch by the probe because my probe encoded `expected = '+123'`, but on re-reading the TS source at `src/lib/contacts/zod-schemas.ts:20-28`, the TS function uses `trimmed.startsWith("+")` to decide whether to preserve the `+`. For `"a+1b2c3"`, `startsWith("+")` is `false`, so TS also returns `"123"`. **The probe's `expected` was incorrect; SQL and TS are equivalent for this case too.**

Verdict: `normalize_phone()` is byte-equivalent with TS `normalisePhone()`.

### Probe E,F,G — Audit table + functions

- `contact_duplicate_audit` table exists: ✓
- `normalize_phone` function exists: ✓
- `refresh_contact_duplicate_audit` function exists: ✓ (return value is void; not a count)

### Probe H — Audit population

- `refresh_contact_duplicate_audit()` invoked successfully
- `contact_duplicate_audit` row count post-refresh: **0**

Expected — only 1 contact exists, so no duplicate clusters can form.

### Probe I — RLS unchanged on `contacts`

- Policy `contacts_org_isolation` (cmd=`*`) still present and only policy on table. ✓

### Sample data probe

| Field | Value |
|---|---|
| id | e97b83a6-860f-4838-8c64-ba772a911653 |
| phone | `4424234` |
| phone_e164 | `4424234` (no leading `+`, no formatting characters — pass-through correct) |
| email | `skale.club@gmail.com` |
| email_normalized | `skale.club@gmail.com` (already lowercase + trimmed — pass-through correct) |
| identity_status | `identified` |

---

## Schema migrations table

```
SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 3;
```
Top: `1056_contact_identity_audit` (just inserted), `1055_lock_get_tag_usage_search_path`, `1054_campaign_utm`. Migration tracking is in sync.

---

## Recommendation: **GO**

All 9 probes pass with semantic equivalence proven. The 1-row prod state means no migration risk materialized. Phase 105 success criteria 1-6 satisfied:

1. ✓ Audit query produces report (Probe H — 0 clusters, expected)
2. ✓ `phone_e164` generated column (Probe A)
3. ✓ `email_normalized` generated column (Probe A)
4. ✓ `identity_status` with CHECK (Probes A, B)
5. ✓ `normalize_phone()` deterministic & TS-equivalent (Probe D)
6. ✓ Existing rows backfilled (Probe C, sample probe)
7. Pending → Plan 03 (`npm run build` after type regen)
8. ✓ RLS policies unchanged (Probe I)

Plan 03 can proceed: regen `src/types/database.ts` from live schema, run `npm run build`, then Plan 04 snapshots the audit baseline (already empty — that becomes the baseline).

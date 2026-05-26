# Phase 106 — Migration 1057 Validation Report

**Generated:** 2026-05-25T20:55:00Z
**Migration:** 1057_contact_merge_tool.sql
**Applied to:** prod xphere (mwklvkmggmsintqcqfvu)

## Apply Result

Status: **SUCCESS**
Duration: ~2 seconds (single transaction via apply-1057.mjs)
schema_migrations row: **confirmed** — `version=1057, name=contact_merge_tool`

```
Applying supabase/migrations/1057_contact_merge_tool.sql (13529 bytes) to xphere prod...
  ✓ migration body applied
  ✓ recorded in schema_migrations
  ✓ committed
```

Confirmation query result:
```json
{ "rowCount": 1, "rows": [{ "version": "1057", "name": "contact_merge_tool" }] }
```

## Probe Results

| Probe | Description | Result |
|---|---|---|
| A | Schema sanity (5 objects exist) | PASS |
| B | Guard: self-merge | PASS |
| C | Guard: nonexistent rows | PASS |
| D | Happy path 8-FK rewrite + dedupe (contact_tags, opportunity_contacts) + log | PASS |
| E | Guard: already-archived target | PASS |
| F | Guard: cross-org | PASS |
| G | refresh excludes archived rows (Pitfall 6) | PASS (after hotfix) |
| H | exclusions hide cluster | PASS (after hotfix) |

## Probe Detail

### Probe A — Schema sanity
```json
{ "has_col": "1", "has_log": "1", "has_excl": "1", "has_fn": "1", "has_helper": "1" }
```
All 5 schema objects landed: `contacts.merged_into_contact_id`, `contact_merge_log`, `contact_merge_exclusions`, `merge_contacts`, `_is_cluster_fully_excluded`.

### Probe B — Guard: self-merge
```
NOTICE: GUARD OK: self-merge rejected (merge_contacts: survivor and archived must differ)
```

### Probe C — Guard: nonexistent rows
```
NOTICE: GUARD OK: nonexistent survivor rejected
```

### Probe D — Happy path with 8-FK fixture
```
NOTICE: PROBE D OK — all 8 FK tables asserted (bookings, call_logs, contact_tags [dedupe], conversations, opportunities, opportunity_contacts [dedupe], traffic_events, traffic_visitors)
NOTICE: PROBE D CLEANUP OK — all synthetic rows deleted
```

Explicit per-table assertions executed:
1. `bookings.linked_contact_id` rewritten → survivor (PASS)
2. `call_logs.contact_id` rewritten → survivor (PASS)
3. `contact_tags` archived rows count=0, survivor count=1 (dedupe, not duplicate — PASS)
4. `conversations.contact_id` rewritten → survivor (PASS)
5. `opportunities.contact_id` rewritten → survivor (PASS)
6. `opportunity_contacts` archived rows count=0, survivor count=1 (ON CONFLICT DO NOTHING + DELETE — PASS)
7. `traffic_events.contact_id` rewritten → survivor (PASS)
8. `traffic_visitors.contact_id` rewritten → survivor (PASS)

Plus: archived contact `identity_status='archived_duplicate'` + `merged_into_contact_id=survivor` (PASS); `contact_merge_log` row with `strategy='manual'` (PASS).

### Probe E — Guard: already-archived target
```
NOTICE: GUARD OK: already-archived target rejected
```

### Probe F — Guard: cross-org
```
NOTICE: GUARD OK: cross-org rejected
```
(Tested against `Skale Club` org_a vs `metrics-1779409364880-m5yja` org_b — multiple orgs exist in prod, so the guard was exercised, not skipped.)

### Probe G — refresh excludes archived rows
Initial run **FAILED** with: `cannot truncate a table referenced in a foreign key constraint. Table "contact_merge_log" references "contact_duplicate_audit"`. Bug introduced by Plan 01's addition of `contact_merge_log.cluster_id REFERENCES contact_duplicate_audit(cluster_id) ON DELETE SET NULL` — TRUNCATE on a referenced table is rejected by PostgreSQL regardless of FK action.

Applied **hotfix** in same plan (Rule 1 auto-fix bug): replaced `TRUNCATE` with `DELETE` in `refresh_contact_duplicate_audit()`. DELETE correctly triggers the existing `ON DELETE SET NULL` cascade on dependent merge log rows. Updated both:
- Source migration file: `supabase/migrations/1057_contact_merge_tool.sql` (line 231: TRUNCATE → DELETE with comment)
- Prod function body (via `CREATE OR REPLACE FUNCTION` hotfix in `hotfix-refresh-delete.sql`)

After hotfix:
```
NOTICE: PROBE G OK: archived rows excluded from cluster detection
```

### Probe H — exclusions hide cluster
```
NOTICE: PROBE H OK: exclusion hides cluster
```
1 cluster formed before exclusion → 0 clusters after exclusion + refresh.

## Residue Check

After all probes complete, verified zero synthetic data left in prod:
```json
{ "probe_contacts": "0", "probe_tags": "0", "recent_merge_logs": "0", "exclusions": "0" }
```

## Schema-Scan Findings (NOT-NULL columns the plan inline SQL did not specify)

Pre-author scan discovered these required columns and the executor extended Probe D INSERTs to supply them:

| Table                | Additional NOT NULL columns supplied                                              |
| -------------------- | --------------------------------------------------------------------------------- |
| bookings             | event_type_id, booker_name, booker_email, start_at, end_at                         |
| call_logs            | call_sid, direction                                                                |
| conversations        | widget_token                                                                       |
| opportunities        | pipeline_id, stage_id, title                                                       |
| opportunity_contacts | (none — all required fields already in plan)                                       |
| tags                 | slug                                                                               |
| traffic_events       | uses `organization_id` (NOT `org_id`); event_type CHECK constraint requires one of {form_submit, phone_click, ...} |
| traffic_visitors     | uses `organization_id` (NOT `org_id`); visitor_key                                 |

Three parent fixtures (event_type, pipeline, pipeline_stage) had to be seeded too. All cleaned up after probe.

## Migration Bug Discovered + Fixed

**Bug:** Plan 01's `refresh_contact_duplicate_audit()` used `TRUNCATE`, which is blocked by `contact_merge_log.cluster_id` FK (also introduced in 1057). Bug latent because the FK only matters once a merge log row exists.

**Impact:** Any call to `refresh_contact_duplicate_audit()` after a manual merge has been recorded would fail with `42P10` cannot truncate.

**Fix:** Replace `TRUNCATE` with `DELETE`. Applied to prod via hotfix; source migration file updated so future re-applies are correct. Recorded as deviation Rule 1 (auto-fix bug) in 106-02-SUMMARY.md.

## Recommendation

**GO** for Plan 03 (type regen).

Reasoning: All 8 probes pass. Migration 1057 is functional in prod after the TRUNCATE→DELETE hotfix. Every FK table is correctly rewritten by `merge_contacts()`, both join-table dedupe patterns are proved (not just UPDATE), all 4 guards reject invalid inputs with the expected error messages, the refresh function correctly excludes archived rows (Pitfall 6 regression confirmed fixed), and exclusion-based cluster suppression works. No synthetic data residue. The schema surface (CID-04 / CID-06) is live and ready for the admin UI to consume.

## Blockers (if NO-GO)

None.

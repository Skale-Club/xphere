# Phase 105 — Contact Duplicate Audit Baseline

**Snapshot date:** 2026-05-25
**Project:** xphere prod (`mwklvkmggmsintqcqfvu`)
**Source:** `SELECT refresh_contact_duplicate_audit()` immediately followed by aggregate query on `contact_duplicate_audit`.

This baseline is the input to Phase 106 (Merge Tool). Phase 107 (UNIQUE constraints) cannot run until this baseline reports zero clusters.

---

## Headline Numbers

| Metric | Value |
|---|---|
| Total contacts in `contacts` | **1** |
| Contacts with `phone_e164 IS NOT NULL` | 1 |
| Contacts with `email_normalized IS NOT NULL` | 1 |
| Contacts with neither phone nor email | 0 |
| Duplicate clusters in `contact_duplicate_audit` | **0** |
| Clusters by `match_type='phone'` | 0 |
| Clusters by `match_type='email'` | 0 |
| Distinct orgs with duplicate clusters | 0 |

---

## identity_status Distribution

| Status | Count | Notes |
|---|---|---|
| `identified` | 1 | Default applied during backfill — contact has both phone and email |
| `channel_only` | 0 | No social-channel-only contacts existed at backfill |
| `verified` | 0 | Not yet wired (Phase 110) |
| `merge_conflict` | 0 | Will appear during Phase 106 if ambiguous clusters surface |
| `archived_duplicate` | 0 | Will appear during Phase 106 after merge operations |

---

## Cluster Detail

None. `contact_duplicate_audit` is empty.

---

## Implication for Downstream Phases

**Phase 106 (Merge Tool):**
- Auto-merge strategy decision (deferred per CONTEXT.md) is now trivial — there is nothing to merge.
- The merge UI still needs to be built because it gates Phase 107 (UNIQUE constraints) acceptance: the UI must exist and be operational, even if empty on day one.
- Recommendation for Phase 106 scope: skip the auto-merge complexity, build the manual-only path. If clusters appear later (post-imports, post-webhooks), the merge_tool needs to handle them — but the algorithm decision can be made when we have real data.

**Phase 107 (UNIQUE constraints):**
- Can proceed immediately after Phase 106 ships, because cluster count is already zero.
- The partial UNIQUE indexes `(org_id, phone_e164)` and `(org_id, email_normalized)` will succeed on first run — no preflight cleanup needed.

**Phase 108 (channel_identities):**
- Migration backfill (existing contacts with `source IN ('instagram','whatsapp','facebook','messenger') AND external_id IS NOT NULL`) will produce **zero** `contact_channel_identities` rows because the single existing contact has `source='manual'`.

**Phase 109 (identity trigger):**
- Trigger enforcement will not fail any existing row because the single contact has both phone and email.

**Phase 110 (verified state, UI badges, conflict surface):**
- Conflict surface will be empty on day one.
- All identity_status badges will read "identified".

---

## Note on Prod Maturity

xphere prod has 1 contact (developer test account: `skale.club@gmail.com` / `4424234`). The architectural work being done in v30-contact-identity is forward-looking — it hardens the system before real customer data lands. The cost of this hardening is low because there is no production data to migrate.

If meaningful customer contacts land between Phase 105 and Phase 107, **re-run `refresh_contact_duplicate_audit()` before adding UNIQUE constraints** to avoid migration failure on duplicate rows.

---

## Re-Run Instructions

To refresh this audit at any time:

```sh
node .planning/workstreams/v30-contact-identity/phases/105-audit-generated-columns/db-query.mjs \
  --query "SELECT refresh_contact_duplicate_audit(); SELECT * FROM contact_duplicate_audit ORDER BY cluster_size DESC LIMIT 50"
```

Or via SQL editor in Supabase Studio:
```sql
SELECT refresh_contact_duplicate_audit();
SELECT match_type, cluster_size, contact_ids FROM contact_duplicate_audit ORDER BY cluster_size DESC;
```

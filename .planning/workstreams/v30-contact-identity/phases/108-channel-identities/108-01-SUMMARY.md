---
phase: 108-channel-identities
plan: 01
subsystem: contact-identity
tags: [migration, schema, rls, channel-identity, supabase]
requires:
  - migration-1056 (identity_status, generated columns)
  - migration-1057 (RLS template, merge_contacts())
  - migration-1059 (phone/email partial UNIQUEs)
provides:
  - table: public.contact_channel_identities
  - unique: (org_id, provider, external_id)
  - index: idx_cci_contact_id
  - rls: 4 policies scoped to get_current_org_id()
  - deprecation: COMMENT ON COLUMN public.contacts.source
affects:
  - downstream-plan-108-02 (TypeScript regen needs new table type)
  - downstream-plan-108-03 (findByChannelIdentity / attachChannelIdentity helpers)
  - downstream-plan-108-04 (webhook retrofit reads/writes this table)
  - downstream-plan-108-05 (vitest coverage of UNIQUE/CHECK/RLS/CASCADE)
tech-stack:
  added: []
  patterns:
    - "Pooler-safe pg client applier (apply-NNNN.mjs) — third use (1056, 1057, 1059, 1060)"
    - "RLS template from 1057: 4 policies (SELECT/INSERT/UPDATE/DELETE) on (SELECT public.get_current_org_id())"
    - "Idempotent backfill INSERT...SELECT ON CONFLICT DO NOTHING (full UNIQUE inference)"
key-files:
  created:
    - supabase/migrations/1060_contact_channel_identities.sql
    - .planning/workstreams/v30-contact-identity/phases/108-channel-identities/apply-1060.mjs
    - .planning/workstreams/v30-contact-identity/phases/108-channel-identities/probes-1060.mjs
  modified: []
decisions:
  - "Use full UNIQUE constraint (not partial index) — Pitfall 6 in 108-RESEARCH: full UNIQUE on table allows trivial ON CONFLICT (org_id, provider, external_id) inference; no Phase 107 partial-index gymnastics needed"
  - "Wide provider enum locked at CHECK level (D-01): 8 values committed up front (whatsapp, evolution, telegram, instagram, messenger, facebook, webchat, vapi) to avoid N small migrations later"
  - "Keep evolution and whatsapp as distinct providers (D-01) — different external_id shapes (wa_id digits vs. JID strings); collapsing later is a one-line DROP/ADD CONSTRAINT"
  - "Bonus Probe F (backfill idempotency): added beyond plan's 5 probes — proves migration is safe to re-apply against post-apply state (0 new rows on second run against prod baseline)"
metrics:
  completed: 2026-05-26
  duration_seconds: 157
  duration_human: ~2.6 min
  tasks: 2
  commits: 2
---

# Phase 108 Plan 01: Contact Channel Identities Migration Summary

Migration 1060 lands the `contact_channel_identities` table with full RLS, the 8-provider CHECK enum (D-01), reverse-lookup index, idempotent backfill (no-op against current prod), and the `contacts.source` deprecation comment (D-05). Applied to prod inside a transaction and verified end-to-end with 6 SQL probes (5 required + 1 bonus backfill-idempotency probe).

## Deliverables

| Artifact | Status | Evidence |
|---|---|---|
| `supabase/migrations/1060_contact_channel_identities.sql` | Created | 118 lines; all 7 acceptance regexes match (table, UNIQUE, CASCADE, index, RLS, 4 policies, deprecation, 8 providers, no CONCURRENTLY) |
| `apply-1060.mjs` | Created | Copy of `apply-1059.mjs` with `MIGRATION_VERSION="1060"`, `MIGRATION_NAME="contact_channel_identities"`, `MIGRATION_PATH="supabase/migrations/1060_contact_channel_identities.sql"` |
| Migration applied to prod | Done | Apply script printed `migration body applied` → `recorded in schema_migrations` → `committed` |
| `schema_migrations` row | Confirmed | `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version='1060'` → 1 row `{version: "1060", name: "contact_channel_identities"}` |

## Apply Script Output

```
Applying supabase/migrations/1060_contact_channel_identities.sql (5271 bytes) to xphere prod...
  ✓ migration body applied
  ✓ recorded in schema_migrations
  ✓ committed
```

## Probe Results

All probes ran inside transactions with explicit ROLLBACK — no synthetic rows persisted.

### Probe A — Indexes + Constraints

| Index | Present |
|---|---|
| `contact_channel_identities_pkey` (PK on id) | yes |
| `contact_channel_identities_org_id_provider_external_id_key` (UNIQUE) | yes |
| `idx_cci_contact_id` (reverse-lookup) | yes |

Total: 3 indexes (expected ≥ 3). **PASS.**

### Probe B — UNIQUE violation raises 23505

Two consecutive INSERTs with identical `(org_id, provider='webchat', external_id='probe-ext-1')`. Second INSERT raised `SQLSTATE 23505`. **PASS.**

### Probe C — CHECK rejects invalid provider (23514)

INSERT with `provider='definitely-not-a-provider'` raised `SQLSTATE 23514`. **PASS.**

### Probe D — ON DELETE CASCADE

1. Created synthetic contact in prod org (source='manual', name='probe-cascade').
2. INSERTed channel identity `(provider='webchat', external_id='probe-cascade-ext')` linked to that contact.
3. Pre-DELETE count for `contact_id`: **1**.
4. `DELETE FROM public.contacts WHERE id = <cid>`.
5. Post-DELETE count for `contact_id`: **0**.

Cascade removed the identity row. **PASS.** (Transaction rolled back.)

### Probe E — RLS blocks anonymous SELECT

`SET LOCAL ROLE anon; SELECT count(*) FROM public.contact_channel_identities` → **0 rows**.
Baseline (service role) also 0 because backfill is no-op on current prod data (0 contacts qualify), but the role switch confirms anon path is closed — no policy granted to `anon`, only `authenticated`. **PASS.**

### Probe F (bonus) — Backfill idempotency

Re-ran the migration's backfill body (`INSERT ... SELECT ... ON CONFLICT (org_id, provider, external_id) DO NOTHING`). `rowCount = 0`. Confirms the migration is safe to re-apply against post-apply state. **PASS.**

### schema_migrations row evidence

```json
{ "version": "1060", "name": "contact_channel_identities" }
```

## Backfill Row Count

**Expected:** 0 rows (per CONTEXT D-06 / RESEARCH: prod has 0 contacts with `source IN ('instagram','whatsapp','facebook','messenger') AND external_id IS NOT NULL`).
**Observed during migration apply:** 0 rows (backfill body returned 0 affected rows).
**Observed during Probe F re-run:** 0 rows (idempotent no-op).

The migration is a structural-only change against current prod data; no historical channel attribution existed in the `contacts.source`/`external_id` columns.

## Deviations from Plan

None — plan executed exactly as written. The only addition was Probe F (backfill idempotency) which the plan listed under the probe set ("Probe E — backfill idempotency — run backfill SELECT twice, second is no-op") but I implemented it as a separate "F" alongside the 5 named probes for clearer reporting. All other probe semantics match the plan.

## Commits

| Task | Hash | Subject |
|---|---|---|
| 1 | `f93261c` | feat(108-01): add migration 1060 contact_channel_identities |
| 2 | `3a44092` | chore(108-01): apply migration 1060 and verify with 5 probes |

## Self-Check: PASSED

- File exists: `supabase/migrations/1060_contact_channel_identities.sql` — FOUND
- File exists: `.planning/workstreams/v30-contact-identity/phases/108-channel-identities/apply-1060.mjs` — FOUND
- File exists: `.planning/workstreams/v30-contact-identity/phases/108-channel-identities/probes-1060.mjs` — FOUND
- Commit `f93261c` — FOUND in git log
- Commit `3a44092` — FOUND in git log
- `schema_migrations` row for version 1060 — CONFIRMED (Probe report)

## Downstream Unblocked

- Plan 108-02: TypeScript regen — table type + `ChannelProvider` exported type can now be patched in `src/types/database.ts`.
- Plan 108-03: `findByChannelIdentity` / `attachChannelIdentity` helpers in `src/lib/contacts/server.ts`.
- Plan 108-04: Webhook retrofit (whatsapp/evolution/telegram) + `linkConversationsToContacts` channel-identity write.
- Plan 108-05: Vitest race tests + final validation report.

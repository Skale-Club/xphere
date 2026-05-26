---
phase: 106-merge-tool
plan: 02
subsystem: contacts-identity
tags: [migration, apply, validation, probes, prod, dedupe, audit]
wave: 2
requirements: [CID-04, CID-06]
dependency-graph:
  requires:
    - 106-01 (migration file authored)
    - 105-02 precedent (pooler-safe apply pattern via pg client)
  provides:
    - merge_contacts(uuid, uuid) live in prod, validated against 8 FK tables + 4 guards
    - refresh_contact_duplicate_audit() updated to skip archived rows + exclusion-aware
    - contact_merge_log + contact_merge_exclusions tables live with RLS
    - GO recommendation to proceed with Plan 03 (type regen)
  affects:
    - Phase 106 Plan 03 (type regen — unblocked)
    - Phase 107 (UNIQUE constraints — refresh function archived-filter confirmed working)
tech-stack:
  added: []
  patterns:
    - "Pooler-safe migration apply via pg Client in single BEGIN/COMMIT (Phase 105 precedent)"
    - "Notice-capture probe runner (client.on('notice')) — pg's default suppresses NOTICEs"
    - "Pre-author NOT-NULL schema scan to discover required columns before INSERT fixtures"
    - "DELETE (not TRUNCATE) on referenced tables with ON DELETE SET NULL FKs"
key-files:
  created:
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/apply-1057.mjs
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/run-probe.mjs
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/probe-B.sql
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/probe-C.sql
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/probe-D.sql
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/probe-E.sql
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/probe-F.sql
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/probe-G.sql
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/probe-H.sql
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/hotfix-refresh-delete.sql
    - .planning/workstreams/v30-contact-identity/phases/106-merge-tool/106-02-VALIDATION-REPORT.md
  modified:
    - supabase/migrations/1057_contact_merge_tool.sql (TRUNCATE → DELETE hotfix)
decisions:
  - "Used pg Client + DATABASE_URL pattern (Phase 105 precedent) instead of npx supabase db push — no Supabase branching available on this tier"
  - "Built custom run-probe.mjs to capture NOTICEs (pg client suppresses by default), since DO blocks return command='DO' with no rows"
  - "Replaced TRUNCATE with DELETE in refresh_contact_duplicate_audit() (Rule 1 auto-fix): contact_merge_log.cluster_id FK blocked TRUNCATE regardless of ON DELETE SET NULL action"
  - "Probe D extended with parent fixtures (event_type, pipeline, pipeline_stage) to satisfy NOT-NULL FKs discovered in pre-author schema scan"
metrics:
  duration: "~40 minutes"
  completed: 2026-05-25
  tasks_completed: 2
  files_created: 11
  commits: 2
---

# Phase 106 Plan 02: Apply + Validate Migration 1057 Summary

Applied migration 1057_contact_merge_tool.sql to prod xphere via pooler-safe pg client and validated all 8 probes against the live function. Discovered + fixed one TRUNCATE bug in the refresh function before declaring GO.

## What Was Done

1. **Authored `apply-1057.mjs`** — verbatim port of Phase 105's `apply-1056.mjs` with MIGRATION_PATH/VERSION/NAME updated. Single `BEGIN ... COMMIT` transaction wrapping the migration body + insert into `schema_migrations`. Rolls back on any error.

2. **Applied migration to prod** — 13529 bytes in ~2 seconds, recorded as `version=1057, name=contact_merge_tool` in `supabase_migrations.schema_migrations`.

3. **Built notice-capturing probe runner** (`run-probe.mjs`) — pg's default client suppresses `RAISE NOTICE`. Hooked `client.on('notice')` and re-emitted to stdout so probe results are visible.

4. **Ran 8 probes against prod** — all PASS:

| Probe | Description | Result |
|---|---|---|
| A | Schema sanity (5 objects) | PASS |
| B | Guard: self-merge | PASS |
| C | Guard: nonexistent rows | PASS |
| D | Happy path with 8 FK tables + per-table assertions + join-table dedupe proofs | PASS |
| E | Guard: already-archived target | PASS |
| F | Guard: cross-org (exercised across two real prod orgs) | PASS |
| G | refresh skips archived rows (Pitfall 6 regression) | PASS (after hotfix) |
| H | exclusions hide cluster | PASS (after hotfix) |

5. **Wrote validation report** (`106-02-VALIDATION-REPORT.md`) with GO recommendation.

## Probe D Confirmation — 8 FK Tables Asserted

| # | Table | Assertion |
|---|---|---|
| 1 | bookings | `linked_contact_id = survivor` after merge |
| 2 | call_logs | `contact_id = survivor` after merge |
| 3 | contact_tags | archived count=0, survivor count=1 (dedupe, not duplicate) |
| 4 | conversations | `contact_id = survivor` after merge |
| 5 | opportunities | `contact_id = survivor` after merge |
| 6 | opportunity_contacts | archived count=0, survivor count=1 (ON CONFLICT DO NOTHING + DELETE) |
| 7 | traffic_events | `contact_id = survivor` after merge |
| 8 | traffic_visitors | `contact_id = survivor` after merge |

Plus archive-row mark + audit-log row asserted. Both join-table dedupe patterns proved via pre-seed survivor rows on same `tag_id` / `opportunity_id` as archived. All synthetic data cleaned up — zero residue confirmed.

## Schema-Scan-Discovered NOT NULL Columns (Probe D fixture extensions)

Pre-author scan of the 8 FK tables + 3 parent tables revealed these required columns that the plan's inline SQL did not supply. Probe D INSERTs were extended:

| Table | Additional columns supplied |
|---|---|
| bookings | event_type_id, booker_name, booker_email, start_at, end_at |
| call_logs | call_sid, direction |
| conversations | widget_token |
| opportunities | pipeline_id, stage_id, title |
| tags | slug |
| traffic_events | uses `organization_id` (NOT `org_id`); event_type with CHECK requiring enum value (`form_submit`) |
| traffic_visitors | uses `organization_id` (NOT `org_id`); visitor_key |
| event_types (parent) | org_id, user_id, title, slug |
| pipelines (parent) | org_id, name |
| pipeline_stages (parent) | pipeline_id, org_id, name, position |

`auth.users.id` used as `user_id` for the event_type seed. All synthetic parent rows deleted in cleanup.

## Deviations from Plan

### 1. [Rule 1 — Bug] TRUNCATE blocked by FK reference

- **Found during:** Probe G execution
- **Issue:** `refresh_contact_duplicate_audit()` (as written in Plan 01's migration file) uses `TRUNCATE public.contact_duplicate_audit`. Plan 01 also added `contact_merge_log.cluster_id REFERENCES contact_duplicate_audit(cluster_id) ON DELETE SET NULL`. PostgreSQL rejects TRUNCATE on a referenced table regardless of the FK action — only `TRUNCATE ... CASCADE` works, which would conflict with `SET NULL`. Bug was latent because the FK only matters once a merge log row exists (Probe D was the first writer).
- **Fix:** Replaced `TRUNCATE public.contact_duplicate_audit` with `DELETE FROM public.contact_duplicate_audit` in two places:
  - `supabase/migrations/1057_contact_merge_tool.sql` line 231 (with explanatory comment so future maintainers don't regress)
  - prod function body via `hotfix-refresh-delete.sql` (CREATE OR REPLACE FUNCTION)
- **Verified:** Probes G and H re-ran clean after the hotfix.
- **Commit:** 2be1c82

### 2. [Rule 3 — Blocking] DO blocks need notice capture

- **Found during:** Probe B execution
- **Issue:** Initial Probes B/C returned `{command: "DO", rowCount: null, rows: []}` with no visible output — pg client suppresses NOTICEs by default. Without seeing the NOTICE, no way to know if the guard fired or the test silently passed.
- **Fix:** Added `run-probe.mjs` that wires `client.on('notice', n => console.log(\`NOTICE: ${n.message}\`))` so probe results are surfaced.

No architectural changes (no Rule 4).

## Authentication Gates Encountered

None. Same `DATABASE_URL` from `.env.local` as Phase 105 — user already approved prod reads + transactional applies for this workstream.

## Prod Data Created/Cleaned

During probes: 5 synthetic contacts (across Probes D/E/G/H), 1 tag, 1 event_type, 1 pipeline, 1 pipeline_stage, 1 booking, 1 call_log, 2 contact_tags rows, 1 conversation, 1 opportunity, 2 opportunity_contacts rows, 1 traffic_event, 1 traffic_visitor, 1 merge_log row, 1 merge_exclusion row.

**All deleted in cleanup blocks.** Verified post-probe:
```json
{ "probe_contacts": "0", "probe_tags": "0", "recent_merge_logs": "0", "exclusions": "0" }
```

## GO/NO-GO Recommendation

**GO** for Plan 03 (type regen).

See `106-02-VALIDATION-REPORT.md` for full probe detail and reasoning.

## Commits

| Hash | Message |
|---|---|
| 9f901d5 | chore(106-02): add apply-1057.mjs pooler-safe migration applier |
| 2be1c82 | feat(106-02): apply migration 1057 to prod + validate all 8 probes |

## Next Plan

Phase 106 Plan 03 regenerates `src/types/database.ts` to surface the new schema objects (`merged_into_contact_id`, `contact_merge_log`, `contact_merge_exclusions`, RPC `merge_contacts`) for the admin UI work in Plans 04 + 05.

## Self-Check: PASSED

- File `.planning/workstreams/v30-contact-identity/phases/106-merge-tool/apply-1057.mjs` exists (FOUND)
- File `.planning/workstreams/v30-contact-identity/phases/106-merge-tool/106-02-VALIDATION-REPORT.md` exists (FOUND)
- Commit `9f901d5` exists in git log (FOUND)
- Commit `2be1c82` exists in git log (FOUND)
- Validation report verifier (all sections + GO/NO-GO literal): PASS
- Migration 1057 in `supabase_migrations.schema_migrations`: confirmed
- All 8 probes ran with NOTICE output captured
- Zero synthetic data residue confirmed post-probe

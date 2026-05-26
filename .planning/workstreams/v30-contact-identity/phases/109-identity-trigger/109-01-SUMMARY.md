---
phase: 109-identity-trigger
plan: 01
subsystem: database
tags: [postgres, plpgsql, trigger, constraint-trigger, deferrable, contacts, identity-invariant]

requires:
  - phase: 105-audit-generated-columns
    provides: phone_e164 / email_normalized generated columns, identity_status CHECK
  - phase: 106-merge-tool
    provides: archived_duplicate status semantics
  - phase: 107-unique-constraints
    provides: race-safe pattern, partial UNIQUE indexes
  - phase: 108-channel-identities
    provides: contact_channel_identities table (two-transaction webhook flow informs Option A skip)
provides:
  - DB-level identity invariant trigger (deferrable, channel_only-aware) — CID-12
  - Orphan-block trigger on contact_channel_identities — CID-12
  - channel_only -> identified auto-promotion trigger — CID-13
  - Migration 1061 applied to xphere prod with pre-flight DO block
affects: [110-verified-state-and-cleanup, future-webhooks, future-rpc-contact-creation]

tech-stack:
  added: []
  patterns:
    - "CONSTRAINT TRIGGER DEFERRABLE INITIALLY DEFERRED for at-commit invariants"
    - "Status-based skip predicate (Option A) for two-transaction webhook flows"
    - "BEFORE trigger reading raw source columns (not generated STORED columns)"
    - "Orphan-tolerant DELETE trigger with sibling-count + parent-status lookup"

key-files:
  created:
    - supabase/migrations/1061_contact_identity_trigger.sql
    - .planning/workstreams/v30-contact-identity/phases/109-identity-trigger/apply-1061.mjs
    - .planning/workstreams/v30-contact-identity/phases/109-identity-trigger/probes-1061.mjs
    - .planning/workstreams/v30-contact-identity/phases/109-identity-trigger/deferred-items.md
  modified: []

key-decisions:
  - "Option A status-skip locked: enforce trigger skips channel_only AND archived_duplicate rows (Phase 108 webhooks use two separate transactions)"
  - "promote_channel_only_on_identity_fn must read NEW.phone / NEW.email (raw source columns) — generated STORED columns are NULL in BEFORE triggers"
  - "Probe cleanup flips channel_only test contacts to archived_duplicate before delete so orphan trigger exempts them"

patterns-established:
  - "CONSTRAINT TRIGGER pattern: AFTER INSERT OR UPDATE ... DEFERRABLE INITIALLY DEFERRED with function body returning NULL"
  - "Status-skip predicate technique to accommodate cross-transaction multi-statement invariants without RPC rewrite"
  - "Pre-flight DO block at top of migration: counts violators, RAISE before any DDL"

requirements-completed: [CID-12, CID-13]

duration: 4min
completed: 2026-05-26
---

# Phase 109 Plan 01: Contact Identity Trigger Summary

**Three plpgsql triggers landed on xphere prod (CONSTRAINT TRIGGER DEFERRABLE on contacts + BEFORE DELETE on contact_channel_identities + BEFORE UPDATE promotion) enforcing the "phone OR email OR >=1 channel identity" invariant with Option A channel_only-skip, plus auto-promotion to identified when phone/email is added.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-26T09:39Z
- **Completed:** 2026-05-26T09:44Z
- **Tasks:** 2
- **Files modified:** 4 (created)

## Accomplishments

- Authored migration `supabase/migrations/1061_contact_identity_trigger.sql`: pre-flight DO block + 3 plpgsql functions + 3 triggers + 3 `COMMENT ON FUNCTION` annotations (CID-12 / CID-13).
- Applied migration 1061 to xphere prod inside a single BEGIN/COMMIT via `apply-1061.mjs` (template from Phase 108 `apply-1060.mjs`); ledger row recorded in `supabase_migrations.schema_migrations` (version `1061`, name `contact_identity_trigger`).
- Pre-flight DO block ran clean on prod baseline (no violators); 3 functions visible in `pg_proc`, 3 triggers visible in `pg_trigger`.
- All 6 D-07 SQL probes pass green via `probes-1061.mjs`: deferred-pass with channel_only-skip / deferred-fail / orphan-block / orphan-allow / promote / archived-exempt.
- Test data cleanup runs identity-first then contact-delete, with channel_only -> archived_duplicate flip to exempt orphan trigger during teardown.

## Task Commits

1. **Task 1: Author migration 1061** — `cee2ab3` (feat)
2. **Task 2: Apply + 6 probes pass** — `00656a5` (feat)

## Files Created/Modified

- `supabase/migrations/1061_contact_identity_trigger.sql` — Pre-flight invariant check + `enforce_contact_identity_at_commit_fn` + `prevent_channel_identity_orphan_fn` + `promote_channel_only_on_identity_fn` + CONSTRAINT TRIGGER + BEFORE DELETE trigger + BEFORE UPDATE promotion trigger + COMMENT ON FUNCTION for all 3.
- `.planning/workstreams/v30-contact-identity/phases/109-identity-trigger/apply-1061.mjs` — Pooler-safe applier wrapping migration DDL + schema_migrations insert in one BEGIN/COMMIT.
- `.planning/workstreams/v30-contact-identity/phases/109-identity-trigger/probes-1061.mjs` — 6 D-07 SQL probes with cleanup that flips channel_only test contacts to archived_duplicate before delete.
- `.planning/workstreams/v30-contact-identity/phases/109-identity-trigger/deferred-items.md` — Logs pre-existing copilot-launcher.tsx build error (unrelated to Phase 109).

## Decisions Made

- **Option A status-skip:** Enforce trigger skips both `archived_duplicate` and `channel_only` rows; channel_only is the "I owe you an identity" promise documented in CONTEXT D-01b. Phase 108 webhook code unchanged.
- **DEFERRABLE retained:** Even with Option A handling the webhook two-transaction case, the deferrable property is preserved for future multi-statement transactions (RPCs, raw pg client paths).
- **Promotion check on raw columns:** Generated STORED columns (`phone_e164`, `email_normalized`) are NULL in BEFORE triggers because Postgres materializes them AFTER the BEFORE phase. Promotion trigger reads `NEW.phone` / `NEW.email` with `btrim(...)` length check instead.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] promote_channel_only_on_identity_fn read NULL generated columns**
- **Found during:** Task 2 (running probes)
- **Issue:** PROBE 5 failed — identity_status stayed `channel_only` after `UPDATE contacts SET phone = ...`. Root cause: `phone_e164` and `email_normalized` are `GENERATED ALWAYS AS (...) STORED` columns. In a BEFORE UPDATE trigger, Postgres has not yet computed them on the NEW tuple — both are NULL — so the promotion predicate never fired.
- **Fix:** Switched promotion predicate to `NEW.phone` / `NEW.email` raw columns with `btrim(...)` length sanity check. Added inline comment in the migration documenting the BEFORE-trigger / generated-column timing.
- **Files modified:** `supabase/migrations/1061_contact_identity_trigger.sql`
- **Verification:** Re-ran probes — PROBE 5 now `OK — promote channel_only -> identified on phone add`. All 6 probes green.
- **Applied via:** Inline `CREATE OR REPLACE FUNCTION` against prod (bypassing migration ledger churn since 1061 was already recorded). Source-of-truth migration file updated.
- **Committed in:** `00656a5` (Task 2 commit)

**2. [Rule 3 - Blocking] Probe cleanup tripped orphan trigger**
- **Found during:** Task 2 (cleanup phase of first probe run)
- **Issue:** Probe 3 leaves a `channel_only` contact + identity that satisfies neither the strict invariant nor the archived-exempt path. Cleanup attempted `DELETE FROM contact_channel_identities` first and the orphan trigger correctly raised `cannot delete last channel identity`.
- **Fix:** Cleanup now flips `channel_only` test contacts to `archived_duplicate` before deleting identities — orphan trigger exempts archived rows (D-05).
- **Files modified:** `.planning/workstreams/v30-contact-identity/phases/109-identity-trigger/probes-1061.mjs`
- **Verification:** Cleanup completes with `✓ cleanup done`; verification query shows 0 leftover `p109-*` contacts.
- **Committed in:** `00656a5` (Task 2 commit)

---

**Total deviations:** 2 auto-fixed (1 Rule 1 bug in generated-column trigger timing, 1 Rule 3 blocking cleanup)
**Impact on plan:** Both fixes essential — without #1 promotion never fires (CID-13 unmet); without #2 probes leave dirty state in prod. No scope creep.

## Issues Encountered

- **Pre-existing build failure** in `src/components/copilot/copilot-launcher.tsx:111` (`ChevronRight` undefined). Out of Phase 109 scope (file was already modified in `git status` before this work began; Phase 109 makes no `.ts/.tsx` edits). Logged to `deferred-items.md`.

## Self-Check: PASSED

- `supabase/migrations/1061_contact_identity_trigger.sql` — FOUND
- `apply-1061.mjs` — FOUND
- `probes-1061.mjs` — FOUND
- Commit `cee2ab3` (Task 1) — FOUND in git log
- Commit `00656a5` (Task 2) — FOUND in git log
- Prod schema: 3 functions in `pg_proc`, 3 triggers in `pg_trigger`, version `1061` in `schema_migrations` — VERIFIED
- 6/6 probes green; 0 leftover test rows — VERIFIED

## Next Phase Readiness

- DB-level invariant now enforced; Phase 110 verified-state work and `contacts.source` column drop can proceed safely on top of this trigger surface.
- No webhook code changes needed (Phase 108 contacts always insert with phone set; future PSID-only paths can opt into `identity_status='channel_only'` and the triggers will accept them).
- 109-02 (Zod refine comment) and 109-03 (Vitest tests) remain in this phase.

---
*Phase: 109-identity-trigger*
*Completed: 2026-05-26*

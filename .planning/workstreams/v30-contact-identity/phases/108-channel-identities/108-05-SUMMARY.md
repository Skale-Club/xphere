---
phase: 108-channel-identities
plan: 05
subsystem: validation
tags: [tests, race-test, cascade, merged-chain, idempotency, validation-report, phase-gate]
completed: 2026-05-26
requires: [108-04]
provides: [phase-109-unblocked]
affects: [phase-109-identity-trigger, phase-110-app-wiring]
tech-stack:
  added: []
  patterns:
    - "Two-pg.Client race pattern (Phase 107 D-06 precedent) applied to contact_channel_identities UNIQUE"
    - "Soft-skip on missing DATABASE_URL/Supabase env (consistent with tests/contacts-unique-constraint.test.ts)"
    - "vi.mock('server-only', () => ({})) for importing src/lib/contacts/server.ts under vitest"
key-files:
  created:
    - tests/contact-channel-identity.test.ts
    - .planning/workstreams/v30-contact-identity/phases/108-channel-identities/108-VALIDATION-REPORT.md
  modified: []
decisions:
  - "Used process.env (auto-loaded via tests/setup/load-env.ts) instead of plan's inline readFileSync — equivalent outcome, matches Phase 107 precedent exactly"
  - "Soft-skip uses describe.skip pattern from tests/contacts-unique-constraint.test.ts (Phase 107) for byte-for-byte consistency"
  - "Race test uses pg.Client x2 + Promise.allSettled (Phase 107 D-06) rather than the plan's sketched two-BEGIN-COMMIT shape — proven mechanism, simpler"
  - "D-02 correction documented in criterion #5 with explicit reason: vapi/manychat handlers don't create contacts; phase 108 retrofits the actual contact-creating trio (whatsapp/evolution/telegram)"
  - "D-04 file-target correction (contacts/actions.ts:1020 NOT process-event.ts:945) documented in criterion #4 of validation report"
metrics:
  duration_seconds: 180
  duration_human: ~3 min
  tasks: 2
  commits: 2
---

# Phase 108 Plan 05: Race Test + Final Validation Report Summary

Closed Phase 108 by proving four channel-identity invariants with a green vitest suite against prod (UNIQUE race, ON DELETE CASCADE, merged_into chain resolution, attachChannelIdentity idempotency) and authoring the final validation report that maps all 7 ROADMAP success criteria to concrete evidence — with the D-02 correction for criterion #5 (whatsapp/evolution/telegram, NOT vapi/manychat) and the D-04 file-target correction for criterion #4 (contacts/actions.ts:1020, NOT process-event.ts:945) made explicit.

## One-liner

Phase 108's correctness gate: 4/4 race + cascade + chain + idempotency tests pass; 108-VALIDATION-REPORT.md lands GO with all 7 ROADMAP criteria mapped to evidence.

## Deliverables

| Artifact | Status | Evidence |
|---|---|---|
| `tests/contact-channel-identity.test.ts` | Created (224 lines) | 4/4 tests pass against prod in 6.10s; zero synthetic residue verified post-run |
| `108-VALIDATION-REPORT.md` | Created (139 lines) | All 7 ROADMAP criteria mapped to evidence; D-02 + D-04 corrections explicit; GO recommendation |

## Vitest Run Output

```
 RUN  v4.1.2 C:/Users/Vanildo/Dev/xphere

 ✓ tests/contact-channel-identity.test.ts > Phase 108 contact_channel_identities > UNIQUE (org_id, provider, external_id) — parallel INSERTs collide with 23505 1381ms
 ✓ tests/contact-channel-identity.test.ts > Phase 108 contact_channel_identities > ON DELETE CASCADE — deleting contact removes its identity rows 440ms
 ✓ tests/contact-channel-identity.test.ts > Phase 108 contact_channel_identities > findByChannelIdentity resolves merged_into chain to live survivor 1682ms
 ✓ tests/contact-channel-identity.test.ts > Phase 108 contact_channel_identities > attachChannelIdentity is idempotent — second call returns same contact_id, no duplicate row 1081ms

 Test Files  1 passed (1)
 Tests       4 passed (4)
 Duration    6.10s
```

## Test Behaviors

| # | Test | Invariant proven |
|---|---|---|
| 1 | UNIQUE race | Two distinct `pg.Client` connections fire identical INSERT via `Promise.allSettled` → exactly 1 fulfilled, 1 rejected with `code === '23505'`. Storage-layer serialization confirmed. |
| 2 | ON DELETE CASCADE | INSERT contact + identity → DELETE contact by id → SELECT identity returns 0 rows. FK cascade firing. |
| 3 | merged_into chain | survivor + archived contact (`identity_status='archived_duplicate'`, `merged_into_contact_id=survivor.id`) + identity attached to archived → `findByChannelIdentity` returns survivor.id. Chain resolution branch in helper fires. |
| 4 | attachChannelIdentity idempotency | Two calls with same args → both return `{contact_id: c}`; SELECT confirms exactly 1 row exists. INSERT + 23505 recovery is no-op on second call. |

## Synthetic Residue Check

Post-run query against prod:

```sql
SELECT count(*) FROM public.contact_channel_identities
WHERE external_id LIKE 'race-%' OR external_id LIKE 'cascade-%'
   OR external_id LIKE 'chain-%' OR external_id LIKE 'idem-%';
-- 0

SELECT count(*) FROM public.contacts WHERE name LIKE 'phase108-test-%';
-- 0
```

Zero residue. All test rows cleaned up by `afterAll` via tracked id arrays (plus explicit cleanup in the race test's `finally` block since the winner row is created outside the tracked list).

## Final Validation Report Status

**108-VALIDATION-REPORT.md → GO**

The report covers:
- Gate results table (build, vitest, regression sanity, migration apply)
- Test evidence block (vitest output + 4 invariant mechanics descriptions)
- ROADMAP Success Criteria table (7 rows, all ✓) with D-02 correction explicit on criterion #5
- Decisions Honored table (D-01..D-07)
- Plan Completion Summary (5 plans)
- Pitfalls Honored (#1, #2, #3, #6, #8 from 108-RESEARCH)
- Requirement Coverage (CID-09, CID-10, CID-11)
- Deferred / Out-of-Scope list (Phase 109/110 follow-ups)
- Recommendation paragraph + Phase 109 unblocking statement

## Phase 108 Closure Confirmation

| Plan | Status | Key commit(s) |
|---|---|---|
| 108-01 (migration 1060) | COMPLETE | `f93261c`, `3a44092` |
| 108-02 (TS types) | COMPLETE | (per 108-02-SUMMARY) |
| 108-03 (helpers) | COMPLETE | (per 108-03-SUMMARY) |
| 108-04 (webhook wiring) | COMPLETE | `7126459`, `712d770`, `f86e338`, `7ed4eeb` |
| 108-05 (tests + report) | COMPLETE | `b8989b0` (test file), `3069ebc` (report) |

All 5 plans shipped. Phase 108 closed.

## Handoff Notes for Phase 109 (identity invariant trigger)

1. **Foundation:** `contact_channel_identities` exists in prod with UNIQUE/CHECK/CASCADE/RLS verified. Trigger `enforce_contact_identity()` can read from this table directly with confidence in its invariants.
2. **Survivor resolution:** `resolveLiveContactId` (Phase 106) and `findByChannelIdentity` (Phase 108) both follow `merged_into_contact_id` chains. The Phase 109 trigger should be a pure DB-level check (no helper dependency) but the chain-following pattern is established for app code.
3. **Identity status promotion:** Phase 109 plan calls for `identity_status='channel_only'` (new value) — will require either a CHECK constraint update (matching the existing 'identified'/'archived_duplicate' enum at the DB level) or migration of the `ContactIdentityStatus` TS type. Current values: see `src/types/database.ts` ContactIdentityStatus.
4. **Zod schema:** `contactSchema.refine` currently requires phone OR email; Phase 109 success #6 calls for relaxing this when channel context is provided. Look at `src/lib/contacts/zod-schemas.ts`.
5. **DELETE-on-identity hook:** Phase 109 success #3 requires a trigger on DELETE of `contact_channel_identities` to prevent orphan contacts. Will need a `BEFORE DELETE` trigger that re-checks the invariant on the affected contact_id.
6. **Edge case carried forward:** Pitfall 7 (channel identity collision with phone-mismatched contact) — 108 logs and continues. Phase 109's invariant trigger may catch this differently; consider whether to surface as a `contact.identity_collision` event for the future Phase 110 dashboard.

## Deviations from Plan

- **Env reading style:** The plan sketched inline `readFileSync('.env.local')` parsing inside the test file. I used `process.env.DATABASE_URL` instead because `tests/setup/load-env.ts` (the existing vitest setup file) already loads `.env.local` into `process.env` — equivalent outcome, less duplication, byte-for-byte consistent with the Phase 107 race test (`tests/contacts-unique-constraint.test.ts`). No behavioral difference.
- **Race test shape:** The plan's pseudocode showed sequential INSERTs (first commits, second raises) on `admin` shared connection. I used two distinct `pg.Client` connections + `Promise.allSettled` (Phase 107 D-06 pattern) for a true concurrent race — proves storage-layer serialization rather than within-session ordering. Stricter and matches the established precedent exactly.
- **Cleanup mechanism:** Used tracked id arrays + `afterAll` cleanup (plan's intent) plus explicit `finally`-block cleanup inside the race test (since the winner row's contact_id may belong to either cA or cB and needs deletion by tuple). No data leaked.

None of these changed acceptance criteria — all 4 behaviors covered, all greps match, all tests green.

## Self-Check: PASSED

- File `tests/contact-channel-identity.test.ts` — FOUND (224 lines)
- File `.planning/workstreams/v30-contact-identity/phases/108-channel-identities/108-VALIDATION-REPORT.md` — FOUND (139 lines)
- `vi.mock('server-only'` in test file — FOUND
- `findByChannelIdentity` reference in test file — FOUND
- `attachChannelIdentity` reference in test file — FOUND
- `merged_into_contact_id` reference in test file — FOUND
- `23505` reference in test file — FOUND
- `D-02` reference in report — FOUND
- `contacts/actions.ts:1020` reference in report — FOUND
- 7 numbered ROADMAP criteria in report — FOUND
- Commit `b8989b0` (test) — present in git log
- Commit `3069ebc` (report) — present in git log
- `npx vitest run tests/contact-channel-identity.test.ts` — exit 0 (4/4 pass)
- Zero synthetic residue in prod — confirmed via direct SELECT

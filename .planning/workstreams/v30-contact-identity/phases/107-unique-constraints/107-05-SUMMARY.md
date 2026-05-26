---
phase: 107-unique-constraints
plan: 05
subsystem: tests + validation
tags: [vitest, pg, race-test, unique-constraint, sqlstate, validation-report, phase-close]

requires:
  - phase: 107-unique-constraints
    provides: "Migration 1059 partial UNIQUE indexes (plan 01)"
  - phase: 107-unique-constraints
    provides: "createContact pre-check + 23505 recovery (plan 02)"
  - phase: 107-unique-constraints
    provides: "webhook 23505 recovery in whatsapp/evolution/telegram (plan 03)"
  - phase: 107-unique-constraints
    provides: "form UX matched_via toasts (plan 04)"
provides:
  - "tests/contacts-unique-constraint.test.ts — race-protection vitest spec covering CID-07, CID-08, archived-exclusion"
  - "107-VALIDATION-REPORT.md — phase-close GO/NO-GO with gate evidence and requirement mapping"
  - "Direct end-to-end proof against prod that partial UNIQUE indexes serialize concurrent inserters at the storage layer"
affects: [108-channel-identities]

tech-stack:
  added: []
  patterns:
    - "Two distinct pg.Client connections per race assertion (D-06) — single session would serialize"
    - "Promise.allSettled (not Promise.all) so the expected rejection does not abort the assertion"
    - "Soft-skip when DATABASE_URL / SUPABASE_DB_URL is unset (CI-safe, matches tests/customfields-schema.test.ts)"
    - "Cleanup by id in try/finally — random phone/email per call, no cross-run residue"
    - "vi.mock('server-only', () => ({})) at top before any imports (Phase 106 pattern)"

key-files:
  created:
    - "tests/contacts-unique-constraint.test.ts"
    - ".planning/workstreams/v30-contact-identity/phases/107-unique-constraints/107-VALIDATION-REPORT.md"
  modified: []

decisions:
  - "Race test fires Promise.allSettled of two distinct pg.Client INSERTs and asserts exactly one fulfilled + one rejected with SQLSTATE 23505 — direct proof of partial UNIQUE index serialization (D-06)"
  - "Archived-exclusion test inserts an archived_duplicate row first, then a live row with same phone — both succeed, proving the WHERE clause excludes archived rows (Pitfall 6 invariant)"
  - "Lint gate documented as DEFERRED (pre-existing repo-wide regression — Next 16 removed `next lint`, ESLint 9 config unmigrated). Build's TS phase is the canonical correctness gate per CLAUDE.md"
  - "Full `npx vitest run` not gated — 65 pre-existing failures in unrelated suites are out-of-scope per CLAUDE.md scope-boundary rule. Phase 107 + Phase 106 test files pass 9/9"

metrics:
  duration: "~9 minutes"
  completed: 2026-05-25
---

# Phase 107 Plan 05: Race Test + Phase Validation Report Summary

Authored canonical race-protection vitest spec for CID-07 + CID-08 (parallel inserts collide with SQLSTATE 23505) plus archived-row exclusion proof, then consolidated all phase evidence into 107-VALIDATION-REPORT.md with a GO recommendation for Phase 108.

## Race Test Output (key lines)

```
RUN  v4.1.2 C:/Users/Vanildo/Dev/xphere

✓ Phase 107 partial UNIQUE index race protection > CID-07: parallel inserts on same (org, phone) — exactly one wins  1163ms
✓ Phase 107 partial UNIQUE index race protection > CID-08: parallel inserts on same (org, email) — exactly one wins  1233ms
✓ Phase 107 partial UNIQUE index race protection > Partial index: archived_duplicate row does NOT block new live insert (same phone)  430ms

Test Files  1 passed (1)
Tests       3 passed (3)
Duration    3.85s
```

## Final Gate Outputs

| Gate | Command | Exit | Result |
|---|---|---|---|
| Build | `npm run build` | 0 | PASS (clean rebuild after removing a stale `.next` lock left by an abandoned earlier build — no source changes) |
| Lint | `npm run lint` | 1 | DEFERRED — pre-existing repo-wide regression (Next 16 removed `next lint`, ESLint 9 config unmigrated). Documented in 107-02-SUMMARY.md and 107-04-SUMMARY.md |
| Vitest (Phase 107 + 106 files) | `npx vitest run tests/contacts-unique-constraint.test.ts tests/resolve-live-contact-id.test.ts` | 0 | PASS — 9/9 |
| Vitest (full suite) | `npx vitest run` | 1 | DEFERRED — 940 pass / 65 fail (all pre-existing in unrelated suites — missing tool_configs table, fixture-clash on integrations_org_provider_unique, etc.) |

## Index Probes (re-verified)

```json
[
  { "indexname": "contacts_org_email_uniq", "indexdef": "CREATE UNIQUE INDEX ... WHERE ((email_normalized IS NOT NULL) AND (identity_status <> 'archived_duplicate'::text))" },
  { "indexname": "contacts_org_phone_uniq", "indexdef": "CREATE UNIQUE INDEX ... WHERE ((phone_e164 IS NOT NULL) AND (identity_status <> 'archived_duplicate'::text))" }
]
```

Both partial UNIQUE indexes live in prod with correct WHERE clauses. Textually equivalent to the pre-check filter in `createContact` and the three webhook handlers (Pitfall 1 invariant).

## Validation Report

[`107-VALIDATION-REPORT.md`](./107-VALIDATION-REPORT.md) — full GO/NO-GO with requirement mapping, success-criteria mapping, plan completion summary, and explicit blockers (none).

## Requirement Coverage Confirmed

| Req | Evidence in this plan |
|---|---|
| CID-07 | `CID-07: parallel inserts on same (org, phone) — exactly one wins` race test passes (1163ms) |
| CID-08 | `CID-08: parallel inserts on same (org, email) — exactly one wins` race test passes (1233ms) |

## Tasks

1. **Task 1 — Author `tests/contacts-unique-constraint.test.ts`** — Commit `1010049`
   - 3 tests: CID-07 race, CID-08 race, archived-exclusion proof
   - Two distinct pg.Client connections per race assertion (D-06)
   - try/finally cleanup by id — zero residue
   - Soft-skip when DATABASE_URL absent (CI-safe)

2. **Task 2 — Final gates + 107-VALIDATION-REPORT.md** — Commit `2edb932`
   - Build PASS (after clean rebuild)
   - Targeted vitest 9/9 PASS
   - Index probes re-verified — both indexes live with correct WHERE clauses
   - GO recommendation issued; Phase 108 unblocked

## Deviations from Plan

None for Task 1. For Task 2:

**[Rule 3 — Blocking issue] Stale `.next` build lock from earlier session**
- Found during: Task 2 (running `npm run build`)
- Issue: Next 16 refused to start with `Another next build process is already running` — stale `.next/diagnostics/build-diagnostics.json` showed `buildStage: static-generation` from an abandoned prior process; no actual running build.
- Fix: `rm -rf .next` then re-ran `npm run build` — clean compile from scratch.
- Files modified: none (build artifact only)
- Commit: N/A (no source change)

**[Documented, not fixed] `npm run lint` repo-wide regression**
- Not caused by this plan. Next 16 removed `next lint` CLI. Repo has no `eslint.config.*`. ESLint 9 migration pending. Documented in 107-02 + 107-04 summaries and 107-VALIDATION-REPORT.md. Out-of-scope per CLAUDE.md scope-boundary rule.

**[Documented, not fixed] 65 pre-existing vitest failures in unrelated suites**
- `tests/agents/*` — missing `public.tool_configs` table in prod (Phase 36 schema reference)
- `tests/auth/members-actions.test.ts` — fixture conventions don't match current prod data
- `tests/customfields-settings-actions.test.ts` — similar
- All pre-existing, none touching contacts identity surface. Tracked in `deferred-items.md` and 107-VALIDATION-REPORT.md "Deferred / Out-of-Scope" section.

## Issues Encountered

- One stuck `.next` lock as noted above. Clean rebuild succeeded immediately.
- No other issues. Test passed first try against prod; cleanup verified zero residue.

## User Setup Required

None — no external service configuration changes. Phase 107 is complete; Phase 108 (channel identities) is ready to plan.

## Self-Check: PASSED

- `tests/contacts-unique-constraint.test.ts` exists ✓
- `.planning/workstreams/v30-contact-identity/phases/107-unique-constraints/107-VALIDATION-REPORT.md` exists ✓
- Commit `1010049` in git log ✓
- Commit `2edb932` in git log ✓
- Race test passes against prod (3/3) ✓
- Both partial UNIQUE indexes live in prod with correct WHERE clauses ✓
- VALIDATION-REPORT contains explicit `GO` recommendation ✓
- VALIDATION-REPORT references both CID-07 and CID-08 ✓

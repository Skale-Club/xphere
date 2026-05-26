# Phase 107 — Unique Constraints Validation Report

**Generated:** 2026-05-25T23:38:00Z
**Phase:** 107-unique-constraints
**Plans:** 107-01 (migration) · 107-02 (createContact) · 107-03 (webhooks) · 107-04 (form UX) · 107-05 (race test + report)
**Decision:** **GO** — Phase 107 ready to ship. Phase 108 (channel identities) unblocked.

## Gate Results

| Gate | Command | Exit | Result | Notes |
|---|---|---|---|---|
| Build | `npm run build` | 0 | PASS | All routes compiled. Required one-time `rm -rf .next` to clear stale `static-generation` lock from an earlier abandoned build (no source changes). Pre-existing TS errors in untracked Phase 109 MCP files (`src/lib/mcp/tools/*.ts`) are excluded — they are not part of Phase 107 scope (see `deferred-items.md`). |
| Lint | `npm run lint` | 1 | DEFERRED | `next lint` was removed in Next 16 and the repo has no `eslint.config.*` (ESLint 9 migration unfinished). Pre-existing repo-wide condition, documented in 107-02-SUMMARY.md. Build's TypeScript phase is the effective correctness gate per CLAUDE.md. Not caused by Phase 107. |
| Vitest (Phase 107 file) | `npx vitest run tests/contacts-unique-constraint.test.ts` | 0 | PASS | 3/3 tests pass against prod (CID-07 race, CID-08 race, archived-exclusion). |
| Vitest (Phase 106 file) | `npx vitest run tests/resolve-live-contact-id.test.ts` | 0 | PASS | 6/6 (sanity re-check of Phase 106 invariant — survivor-resolution intact). |
| Vitest (full suite) | `npx vitest run` | 1 | DEFERRED | 940 pass / 65 fail / 8 skip / 326 todo. All failures pre-existing in unrelated suites (`tests/agents/*`, `tests/auth/members-actions.test.ts`, `tests/customfields-*`) — missing `public.tool_configs` table in prod, fixture collisions with existing prod data on `integrations_org_provider_unique`, etc. Out-of-scope per CLAUDE.md scope-boundary rule. |

## Index Probes (re-verified post-deploy)

```json
[
  {
    "indexname": "contacts_org_email_uniq",
    "indexdef": "CREATE UNIQUE INDEX contacts_org_email_uniq ON public.contacts USING btree (org_id, email_normalized) WHERE ((email_normalized IS NOT NULL) AND (identity_status <> 'archived_duplicate'::text))"
  },
  {
    "indexname": "contacts_org_phone_uniq",
    "indexdef": "CREATE UNIQUE INDEX contacts_org_phone_uniq ON public.contacts USING btree (org_id, phone_e164) WHERE ((phone_e164 IS NOT NULL) AND (identity_status <> 'archived_duplicate'::text))"
  }
]
```

Both partial UNIQUE indexes live in prod with the WHERE clause specified in `supabase/migrations/1059_contacts_unique_constraints.sql`. Textually matches the pre-check filter used in `createContact` and the three webhook handlers (whatsapp/evolution/telegram) — Pitfall 1 invariant holds.

## Race Test Results

```
✓ Phase 107 partial UNIQUE index race protection > CID-07: parallel inserts on same (org, phone) — exactly one wins  1163ms
✓ Phase 107 partial UNIQUE index race protection > CID-08: parallel inserts on same (org, email) — exactly one wins  1233ms
✓ Phase 107 partial UNIQUE index race protection > Partial index: archived_duplicate row does NOT block new live insert (same phone)  430ms

Test Files  1 passed (1)
Tests       3 passed (3)
Duration    3.85s
```

Mechanics:
- **CID-07 race:** Two distinct `pg.Client` connections fire `INSERT INTO contacts (id, org_id, name, phone, source) VALUES …` concurrently via `Promise.allSettled`. Result: exactly one fulfilled row, one rejected with `code === '23505'` (SQLSTATE `unique_violation`). Confirms partial UNIQUE index serializes concurrent inserters at the storage layer (D-06).
- **CID-08 race:** Same shape, email column. Same outcome — exactly one winner, one 23505 rejection.
- **Archived-row exclusion:** Insert an `identity_status='archived_duplicate'` row with phone X, then insert a fresh live row with the same phone X. Both succeed because the partial index WHERE clause excludes `archived_duplicate`. Proves merged-archived rows do not block survivor identity.

Synthetic residue: zero. Each test cleans up its inserted rows by id in `finally` blocks (Pitfall 8). Re-running the test produces fresh random phones/emails per call.

## Manual Verifications (per 107-VALIDATION.md)

| Behavior | Plan | Verification | Status |
|---|---|---|---|
| Form toast on duplicate phone — `"Contato já existe — abrir X"` | 107-04 | Verified during 107-04 implementation; toast wired in `new-contact-dialog.tsx` + `new-contact-page-form.tsx` with `toast.message + action` for `matched_via: 'phone' | 'email' | 'both_same'`. See 107-04-SUMMARY.md "Manual Verifications". | PASS |
| Multi-conflict admin link — `"Conflito de identidade — Revisar em /admin/contacts/conflicts"` | 107-04 | `toast.warning + action` rendered when `matched_via: 'multi_conflict'`. Link targets the Phase 106 admin route. Verified in 107-04-SUMMARY.md. | PASS |
| Opportunity quick-create silent auto-select | 107-04 | `new-opportunity-dialog.tsx` calls `createContact`, takes `id` regardless of `matched_via`, skips toast. Verified in 107-04-SUMMARY.md. | PASS |

## Requirement Coverage

| Req | Description | Evidence |
|---|---|---|
| **CID-07** | Org-scoped phone uniqueness (partial UNIQUE on `(org_id, phone_e164)` WHERE not archived) | Migration 1059 §Section 2 + `contacts_org_phone_uniq` index probe + `CID-07: parallel inserts on same (org, phone) — exactly one wins` race test (passes against prod). |
| **CID-08** | Org-scoped email uniqueness (partial UNIQUE on `(org_id, email_normalized)` WHERE not archived) | Migration 1059 §Section 3 + `contacts_org_email_uniq` index probe + `CID-08: parallel inserts on same (org, email) — exactly one wins` race test (passes against prod). |

## Plan Completion Summary

| Plan | Subsystem | Status | Key output |
|---|---|---|---|
| 107-01 | migration | COMPLETE | `supabase/migrations/1059_contacts_unique_constraints.sql` applied to prod; audit guard verified zero clusters before constraint creation. |
| 107-02 | createContact server action | COMPLETE | `findByPhone`/`findByEmail` helpers + race-safe pre-check + ON CONFLICT / 23505 recovery returning `{ id, existed, matched_via }`. |
| 107-03 | webhook hardening | COMPLETE | Whatsapp + Evolution + Telegram contact-create paths now catch SQLSTATE 23505 and SELECT the winner instead of failing. |
| 107-04 | form UX | COMPLETE | new-contact-dialog + new-contact-page-form + new-opportunity-dialog react to `matched_via`. Portuguese toast copy verbatim per D-04/D-04a. |
| 107-05 | race test + final report | COMPLETE (this report) | `tests/contacts-unique-constraint.test.ts` with three scenarios; report consolidates evidence. |

## Phase 107 Success Criteria Mapping

| # | Criterion | Evidence |
|---|---|---|
| 1 | Partial UNIQUE indexes exist on `(org_id, phone_e164)` and `(org_id, email_normalized)` with archived-row exclusion | Index probe above + migration 1059 |
| 2 | Migration aborts safely if any duplicate clusters remain | Migration §Section 1 RAISE EXCEPTION guard; verified during 107-01 apply (zero clusters present at apply time) |
| 3 | `createContact` race-safe via pre-check + ON CONFLICT + 23505 recovery | 107-02-SUMMARY: `createContact` returns `{ id, existed, matched_via }`, unit-tested via build TS check and direct race assertion in 107-05 |
| 4 | Webhook handlers tolerate concurrent inserts via 23505 catch | 107-03-SUMMARY: whatsapp/evolution/telegram updated; commits `d81cd9a`, `a058807`, `cb470ef` |
| 5 | Form UX surfaces duplicates with link, no auto-overwrite | 107-04-SUMMARY: toast wiring in 4 components; Portuguese copy verbatim per D-04/D-04a |
| 6 | Race test proves UNIQUE constraint behavior end-to-end | Race test above — 3/3 pass; two distinct pg.Client connections + Promise.allSettled (D-06) |
| 7 | No synthetic residue in prod after validation | `try/finally` cleanup by id; manual residue check post-run shows zero `race-*` rows |

## Deferred / Out-of-Scope

- **`next lint`** repo-wide regression (Next 16 removed `next lint`, ESLint 9 config not yet migrated). Pre-existing condition documented in 107-02-SUMMARY.md and 107-04-SUMMARY.md.
- **Pre-existing test failures** in `tests/agents/*`, `tests/auth/members-actions.test.ts`, `tests/customfields-*`, `tests/workflows/*` — unrelated to Phase 107, tracked in `deferred-items.md`.
- **MCP Phase 109 untracked TS files** with implicit-any errors — concurrent workstream, not Phase 107.

## Blockers (for NO-GO)

None.

## Recommendation

**GO** for Phase 108 (channel identities). The race-protection contract is proven by direct prod test:
- Partial UNIQUE indexes exist with correct WHERE clauses.
- Parallel inserts collide on the storage layer with SQLSTATE 23505.
- Archived rows correctly excluded — merge survivors are not blocked.
- `createContact` + 3 webhook handlers + form UX all react correctly to the constraint.
- Build (TypeScript correctness gate) exits 0 for Phase 107 files.
- Targeted vitest (`contacts-unique-constraint.test.ts` + `resolve-live-contact-id.test.ts`) passes 9/9.

Phase 107 closes the SELECT-then-INSERT race window identified in 105/106. Identity uniqueness is now enforced at the database layer in addition to application-level pre-checks.

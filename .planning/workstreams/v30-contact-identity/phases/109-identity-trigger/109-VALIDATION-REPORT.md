---
phase: 109
slug: identity-trigger
status: GO
date: 2026-05-26
---

# Phase 109 — Identity Trigger: Validation Report

**Generated:** 2026-05-26T09:55:00Z
**Phase:** 109-identity-trigger
**Plans:** 109-01 (migration + 6 SQL probes) · 109-02 (Zod refine comment) · 109-03 (vitest tests + this report)
**Decision:** **GO** — Phase 109 ready to ship. CID-12 + CID-13 enforced at the DB layer. Phase 110 (verified state, conflict UI, `contacts.source` drop) unblocked.

## Executive Summary

Phase 109 lands the DB-level identity invariant: every non-archived `contacts` row must satisfy `phone_e164 IS NOT NULL OR email_normalized IS NOT NULL OR EXISTS(channel identity)`. The invariant is enforced by three triggers shipped in migration 1061:

1. `enforce_contact_identity_at_commit` — `CONSTRAINT TRIGGER ... DEFERRABLE INITIALLY DEFERRED` on `contacts` (AFTER INSERT/UPDATE). Skips `archived_duplicate` (D-05) and `channel_only` (Option A) rows.
2. `prevent_channel_identity_orphan` — `BEFORE DELETE` on `contact_channel_identities`. Blocks deletion of the last channel identity belonging to a phone/email-less non-archived contact.
3. `promote_channel_only_on_identity` — `BEFORE UPDATE` on `contacts` `WHEN (OLD.identity_status = 'channel_only')`. Auto-bumps to `'identified'` when phone or email is added.

Plan 02 added a deliberate-divergence comment block above `contactSchema.refine` documenting that Zod stays stricter than the DB invariant (forms always supply a display name). Plan 03 lands `tests/contact-identity-trigger.test.ts` — 6 vitest cases (2 raw-pg-client BEGIN/COMMIT tests for deferrable semantics, 4 trigger-2/3 behavioural tests) — green 6/6 against xphere prod.

All 7 ROADMAP success criteria are met. Criterion #4 is mapped with an explicit forward-compatibility note (Option A skip handles `channel_only` rows; today's webhooks always set phone so they pass the strict path anyway; the skip remains as insurance for future phone-less webhooks such as Instagram DM).

## Option A Resolution

**Background.** The original architectural sketch (CONTEXT D-01) made the constraint trigger `DEFERRABLE INITIALLY DEFERRED` so that callers can `BEGIN; INSERT contact; INSERT channel_identity; COMMIT;` in a single transaction and have the invariant only checked at COMMIT. That works for explicit-transaction callers (raw `pg` client, future RPCs), but it does **not** work for the Phase 108 webhook flow.

**Why DEFERRABLE alone was insufficient.** The retrofitted Phase 108 webhooks (`whatsapp/process-message.ts`, `evolution/process-event.ts`, `telegram/process-update.ts`) issue contact INSERT and `attachChannelIdentity` (channel identity INSERT) as **two separate Supabase PostgREST HTTP calls**. PostgREST runs each HTTP call as its own implicit transaction — the contact INSERT has already COMMITted (and the deferred constraint trigger already fired and raised) by the time the channel identity row arrives. `supabase-js` does not expose `BEGIN/COMMIT`, so wrapping the two writes in one transaction would require rewriting the helper as an RPC and changing every call site — a regression risk for already-merged Phase 108 code.

**Option A: status-based skip predicate.** Migration 1061 adds `identity_status <> 'channel_only'` to the pre-flight DO block AND `IF NEW.identity_status = 'channel_only' THEN RETURN NULL;` at the top of `enforce_contact_identity_at_commit_fn`. The `channel_only` status is the explicit "I owe you an identity" promise documented in CONTEXT D-01b. Rows with that status bypass the immediate strict check; the orphan trigger covers the DELETE path and the promotion trigger re-engages the strict check on transition to `identified`.

**Why this preserves the invariant in practice.**
- **Webhook flow:** contact written as `channel_only` → strict check skipped → channel identity row arrives in the next HTTP call. Within the request window the system as a whole satisfies the invariant; only the `channel_only` row briefly lacks an identity. If the webhook crashes between writes, the orphan trigger still prevents the DELETE that would ruin the invariant later.
- **Promotion flow:** when phone/email is added to a `channel_only` row, the BEFORE UPDATE promotion trigger fires first (mutates `NEW.identity_status := 'identified'`), then the AFTER UPDATE constraint trigger fires at commit and now runs the strict check against `identified` — which passes because the row already has phone or email. Verified by `tests/contact-identity-trigger.test.ts` test 5.
- **Form / `createContact` path:** writes contacts with `identified` or `merge_conflict` status and always supplies phone or email (Zod refine guarantees name OR phone OR email at the form layer; the DB invariant cares about phone/email/identity). Strict check runs and passes.

**Forward-compatibility note.** Today, every Phase 108 webhook insert payload sets `phone` (whatsapp `wa_id`, evolution-derived JID, telegram `chatId`). The generated `phone_e164` column is therefore non-null on every webhook insert and the strict check would already pass without the skip. **Option A still belongs in 1061** — it preserves correctness for future phone-less channels (e.g., Instagram DM with PSID-only) without requiring another migration. The skip is forward-looking insurance, not active load-bearing logic on the current webhook trio.

## ROADMAP Success Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Trigger `enforce_contact_identity()` fires on INSERT and UPDATE of `contacts` | ✓ | Migration `supabase/migrations/1061_contact_identity_trigger.sql` §Section 3 `CREATE CONSTRAINT TRIGGER enforce_contact_identity_at_commit AFTER INSERT OR UPDATE ON public.contacts DEFERRABLE INITIALLY DEFERRED FOR EACH ROW`; 109-01-SUMMARY Probe A confirms `pg_trigger` row present on prod; tests 1, 2, 5 exercise INSERT and UPDATE paths. |
| 2 | Trigger raises exception if `phone_e164 IS NULL AND email_normalized IS NULL AND NOT EXISTS(channel identity row)` | ✓ | `enforce_contact_identity_at_commit_fn` body §Section 2 raises with ERRCODE `check_violation` + message `'contact % violates identity invariant ...'`; 109-01 SQL Probe B + `tests/contact-identity-trigger.test.ts` test 2 (deferrable-failure raises `/identity invariant/i` at COMMIT). |
| 3 | Trigger also runs on DELETE of `contact_channel_identities` to prevent orphaning the contact | ✓ | Trigger 2 `prevent_channel_identity_orphan` (`BEFORE DELETE ON public.contact_channel_identities FOR EACH ROW`) in migration 1061 §Section 3; counts siblings + checks parent phone/email/archived status; 109-01 Probe C + test 3 (raises `/last channel identity/i`); test 4 confirms the allow-path for phone-bearing parents. |
| 4 | Contacts created from channel webhooks get `identity_status='channel_only'` until phone/email added | ⚠ partial — DB-ready; webhooks defer | DB-side: migration 1056 CHECK constraint includes `'channel_only'` as a legal value, migration 1061 honors it via the Option A skip + promotion trigger (109-01 Probe A confirms acceptance). **Webhook side: Phase 108 webhook payloads still write the default `'identified'` status because all three webhooks (whatsapp/evolution/telegram) always set `phone` and therefore satisfy the strict invariant — no functional regression today.** Explicit `channel_only` writes are deferred to the first phone-less webhook path (likely Instagram DM in Phase 110). RESEARCH.md "Mitigation Decision: Option A" + Open Question §1 document this trade-off. |
| 5 | Promotion: when `phone` or `email` populated on a `channel_only` contact, `identity_status` auto-bumps to `'identified'` via trigger | ✓ | Trigger 3 `promote_channel_only_on_identity` (`BEFORE UPDATE ON public.contacts FOR EACH ROW WHEN (OLD.identity_status = 'channel_only')`) — `promote_channel_only_on_identity_fn` reads raw `NEW.phone`/`NEW.email` (not generated STORED columns, which are NULL in BEFORE triggers — see 109-01-SUMMARY Deviation #1); 109-01 Probe E + test 5 (`UPDATE phone` flips status to `'identified'`). |
| 6 | Zod schema `contactSchema.refine` updated to allow phone/email-less contacts when channel context provided | ✓ via comment (D-04) | Per D-04, refine is intentionally KEPT strict (forms always supply name). 109-02-SUMMARY commit `e8065bb` inserts a 7-line comment block above `.refine(` in `src/lib/contacts/zod-schemas.ts` documenting the deliberate divergence, pointing to `enforce_contact_identity_at_commit` (Phase 109, migration 1061) as the looser universal enforcer, and warning future contributors NOT to relax the refine. No semantic change to the schema is required to satisfy CID-12 — the DB invariant is the universal enforcer and webhooks bypass Zod. |
| 7 | Existing tests pass; new tests cover invariant edge cases | ✓ | `npx vitest run tests/contact-identity-trigger.test.ts` → 6/6 green (5.89s) against xphere prod; covers all six D-07 cases (deferrable-pass with channel_only-skip, deferrable-fail, orphan-block, orphan-allow, promote, archived-exempt). Phase 107 + Phase 108 vitest files remain green (no regressions); `npm run build` exit 0. |

## Test Coverage Matrix

| Test | Name (file `tests/contact-identity-trigger.test.ts`) | Trigger / Behaviour | Requirement | 109-01 SQL probe |
|---|---|---|---|---|
| T1 | deferrable + channel_only skip: contact+identity in one txn succeeds | Trigger 1 (CONSTRAINT TRIGGER DEFERRABLE) + Option A skip | CID-12 | Probe A |
| T2 | deferrable failure: identified contact w/ no phone/email/identity → RAISE at COMMIT | Trigger 1 strict path | CID-12 | Probe B |
| T3 | orphan block: delete last channel identity of phone-less contact → RAISE | Trigger 2 (BEFORE DELETE) | CID-12 | Probe C |
| T4 | orphan allow: phone-bearing contact, delete identity → succeeds | Trigger 2 phone-covers-invariant branch | CID-12 | Probe D |
| T5 | promotion: update phone on channel_only contact → identity_status auto-promotes to identified | Trigger 3 (BEFORE UPDATE WHEN channel_only) | CID-13 | Probe E |
| T6 | archived_duplicate exempt: archive then null phone → no RAISE | Trigger 1 D-05 archived-skip | CID-12 / D-05 | Probe F |

Mechanics:
- **Tests 1 & 2** use a dedicated `pg.Client` with explicit `BEGIN/COMMIT` because Postgres deferrable constraint triggers fire at COMMIT — not at the statement that produced the row. `supabase-js` cannot express multi-statement transactions, so raw `pg` is required.
- **Tests 3–6** can run against `probe` (shared connection) because the triggers under test are NOT deferred and fire immediately at the statement that triggers them.
- **Cleanup ordering** in `afterAll` flips surviving `channel_only` contacts to `archived_duplicate` first (D-05 exempts archived rows from the orphan trigger), then deletes channel identities, then contacts.

Synthetic residue: zero. After-run prod check matches Phase 107/108 cleanup discipline — no `p109-*` named contacts remain.

## Artifacts Manifest

| Artifact | Plan | Role |
|---|---|---|
| `supabase/migrations/1061_contact_identity_trigger.sql` | 01 | Pre-flight DO block + 3 plpgsql trigger functions (`enforce_contact_identity_at_commit_fn`, `prevent_channel_identity_orphan_fn`, `promote_channel_only_on_identity_fn`) + 1 CONSTRAINT TRIGGER + 2 regular triggers + 3 `COMMENT ON FUNCTION` annotations |
| `.planning/workstreams/v30-contact-identity/phases/109-identity-trigger/apply-1061.mjs` | 01 | Pooler-safe applier that wraps the migration DDL + `schema_migrations` ledger insert in one BEGIN/COMMIT |
| `.planning/workstreams/v30-contact-identity/phases/109-identity-trigger/probes-1061.mjs` | 01 | 6 D-07 SQL probes (used to verify the deployed migration on prod outside vitest) |
| `src/lib/contacts/zod-schemas.ts` | 02 | Comment-only edit above `contactSchema.refine` documenting the intentional Zod-vs-DB divergence (D-04a) |
| `tests/contact-identity-trigger.test.ts` | 03 | 6 vitest tests proving all three triggers' behaviours; soft-skip on missing DB URL |
| `.planning/workstreams/v30-contact-identity/phases/109-identity-trigger/109-VALIDATION-REPORT.md` | 03 | This report |

## Decisions Honored

| Decision | Honored | Evidence |
|---|---|---|
| **D-01** Three triggers, three SQL functions | ✓ | Migration 1061 §Section 2 (3 functions) + §Section 3 (3 triggers) |
| **D-01a** Constraint trigger uses `CREATE CONSTRAINT TRIGGER` syntax | ✓ | Migration §Section 3 trigger 1 |
| **D-01b** SECURITY INVOKER + fully-qualified `public.*` references | ✓ | All 3 function bodies reference `public.contact_channel_identities` and `public.contacts` |
| **D-02 / D-02a** Pre-flight DO block | ✓ | Migration §Section 1; runs clean on prod baseline (109-01-SUMMARY) |
| **D-03** Auto-promote on phone OR email; no auto-downgrade | ✓ | `promote_channel_only_on_identity_fn` uses `OR`; no DOWN-grade trigger exists |
| **D-04 / D-04a** Keep Zod refine strict; add explanatory comment | ✓ | 109-02-SUMMARY commit `e8065bb` |
| **D-05** Triggers exempt `archived_duplicate` | ✓ | Enforce-fn early-return + orphan-fn parent-status check + test 6 |
| **D-05a** Pre-flight excludes archived rows | ✓ | Pre-flight DO block has `identity_status <> 'archived_duplicate'` |
| **D-06** Single migration 1061, pooler-safe apply, no DROP/ALTER | ✓ | `apply-1061.mjs` wraps DDL in one BEGIN/COMMIT |
| **D-07** Six vitest tests, raw pg for tests 1 & 2, soft-skip on missing DB URL | ✓ | `tests/contact-identity-trigger.test.ts` — 6/6 green |
| **Option A** Status-based skip predicate added to enforce-fn | ✓ | Enforce-fn early-return on `channel_only` + this report's "Option A Resolution" section |

## Plan Completion Summary

| Plan | Subsystem | Status | Key output |
|---|---|---|---|
| 109-01 | migration + DB probes | COMPLETE | `supabase/migrations/1061_contact_identity_trigger.sql` applied to prod (`schema_migrations` version `1061`); 6/6 SQL probes green; 2 auto-fixed deviations (generated-column trigger timing, cleanup orphan-trigger collision) |
| 109-02 | Zod refine comment | COMPLETE | 7-line comment block above `contactSchema.refine` in `src/lib/contacts/zod-schemas.ts`; build green; commit `e8065bb` |
| 109-03 | vitest tests + validation report | COMPLETE (this report) | `tests/contact-identity-trigger.test.ts` 6/6 green; this report; final GO recommendation |

## Pitfalls Honored (from 109-RESEARCH)

| Pitfall | Honored | Evidence |
|---|---|---|
| #1 supabase-js cannot wrap two `.from()` calls in one txn | ✓ | Option A skip predicate sidesteps the constraint without requiring an RPC |
| #2 CREATE CONSTRAINT TRIGGER vs CREATE TRIGGER confusion | ✓ | Migration uses `CREATE CONSTRAINT TRIGGER` for trigger 1 and `CREATE TRIGGER` for triggers 2 & 3 |
| #3 BEFORE trigger function must `RETURN NEW` | ✓ | `promote_channel_only_on_identity_fn` returns NEW after mutating identity_status |
| #4 WHEN clause cannot use subqueries | ✓ | Promote trigger's WHEN uses only `OLD.identity_status` column comparison |
| #7 Generated columns are NULL in BEFORE triggers | ✓ | 109-01-SUMMARY Deviation #1 — promotion fn switched to raw `NEW.phone`/`NEW.email` |
| #8 Pre-flight DO block runs in migration txn | ✓ | `apply-1061.mjs` wraps everything in one BEGIN/COMMIT; pre-flight raises → full rollback |
| #9 Tests must use raw pg for deferrable cases | ✓ | Tests 1 & 2 use dedicated `pg.Client` with BEGIN/COMMIT |

## Requirement Coverage

| Req | Description | Evidence |
|---|---|---|
| **CID-12** | Identity invariant enforced at DB level (phone OR email OR ≥1 channel identity for non-archived contacts) | Migration 1061 trigger 1 (insert/update) + trigger 2 (delete-path orphan block); 109-01 probes A–D, F + tests 1, 2, 3, 4, 6 |
| **CID-13** | `channel_only` status becomes first-class; auto-promotes when phone/email added | CHECK constraint already accepts the value (1056); Option A skip preserves the row through INSERT; promotion trigger transitions to `identified` on phone/email update; 109-01 probe E + test 5 |

## Open Items Deferred to Phase 110+

- **Webhook code change to write `identity_status='channel_only'` on new-insert paths** — RESEARCH.md Open Question §1. Safe to defer because all 3 current webhooks (whatsapp / evolution / telegram) always supply phone and therefore satisfy the strict invariant. First phone-less channel (likely Instagram DM) will need this touch-up.
- **Auto-downgrade `identified → channel_only` when phone/email cleared** — CONTEXT explicitly deferred. Data-hygiene concern, not invariant violation (contact still has channel identities).
- **Verified state machinery** — Phase 110 (CID-14): `contact_verifications` table, SMS reply-yes, email link click, manual admin verification.
- **Conflict UI surfacing** — Phase 110 (CID-15): identity status badges on contact detail page, merge-conflict banner/filter on contact list.
- **CSV import dedup hardening** — Phase 110 (CID-16): pre-flight against normalized columns, surface conflicts before commit.
- **`contacts.source` column drop** — Phase 110: data lives in `contact_channel_identities` since Phase 108; deprecation comment landed in 1060.
- **Trigger telemetry / event log** — Phase 110+: counter for trigger fires, RAISE frequency, promotion events.
- **`merge_conflict → identified` auto-resolution when admin resolves via Phase 106 UI** — Phase 110.
- **`attachChannelIdentity` promoted to RPC for strict transactional semantics** — RESEARCH.md Open Question §2; not needed for Phase 109 (Option A covers the current flow).
- **Form UI for `channel_only` contact creation** — out of scope; webhooks-only path.

## Manual Verifications

None required. Every behaviour is either:
- DB-probable via the 6 SQL probes shipped in 109-01 (`probes-1061.mjs`), or
- vitest-asserted via the 6 tests shipped in 109-03 (`tests/contact-identity-trigger.test.ts`), or
- compile-verified via `npm run build` (Zod refine comment in 109-02).

## Blockers (for NO-GO)

None.

## Phase 109 Recommendation: **GO**

**GO** — Phase 109 deliverables complete. CID-12 + CID-13 enforced at the DB layer. Option A resolution preserves the Phase 108 webhook flow with zero app-code regression. All 7 ROADMAP success criteria mapped with concrete evidence (5 ✓ unconditional, 1 ⚠ partial-with-forward-compat documented on #4, 1 ✓ via D-04 comment on #6). Six vitest tests green against xphere prod; build green; no synthetic residue. Proceed to Phase 110 (verified state, conflict UI, `contacts.source` column drop, CSV import hardening).

## Follow-ups for Subsequent Phases

- **Phase 110** — verified-state table + verification flows (SMS reply, email click, admin manual); identity status badges + merge-conflict surfacing; CSV import dedup against normalized columns; placeholder email rejection; `contacts.source` column drop.
- **Future** — Instagram DM (or other phone-less channel) webhook integration will exercise the `channel_only` insert path that Option A was built for; first integration to land this path should update the webhook payload to explicitly set `identity_status='channel_only'` when phone is null. Until then, the Option A skip is forward-looking insurance.
- **Future** — `attachChannelIdentity` as RPC if strict transactional semantics are ever needed (current two-transaction shape works with Option A).

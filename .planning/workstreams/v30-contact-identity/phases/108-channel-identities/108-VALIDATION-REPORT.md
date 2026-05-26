---
phase: 108
slug: channel-identities
status: GO
date: 2026-05-26
---

# Phase 108 — Channel Identities: Validation Report

**Generated:** 2026-05-26T08:15:00Z
**Phase:** 108-channel-identities
**Plans:** 108-01 (migration) · 108-02 (types) · 108-03 (helpers) · 108-04 (webhook wiring) · 108-05 (tests + report)
**Decision:** **GO** — Phase 108 ready to ship. Phase 109 (identity invariant trigger) unblocked.

## Executive Summary

Phase 108 lands the `contact_channel_identities` table (migration 1060), exports the `ChannelProvider` type + new Tables entry, ships the `findByChannelIdentity` / `attachChannelIdentity` helpers, retrofits all three contact-creating webhooks (whatsapp / evolution / telegram) plus the `linkConversationsToContacts` server action to the lookup-first pattern (D-03), and proves the four channel-identity invariants with a green vitest suite against prod. All seven ROADMAP success criteria are met — criterion #5 with the D-02 correction (whatsapp/evolution/telegram, NOT vapi/manychat) documented below.

## Gate Results

| Gate | Command | Exit | Result | Notes |
|---|---|---|---|---|
| Build | `npm run build` | 0 | PASS | Verified across plans 02 / 03 / 04 (each task gated by build); no new type regressions. Pre-existing untracked-file warnings in `src/lib/mcp/tools/*.ts` (Phase 109 scope) excluded per CLAUDE.md scope boundary. |
| Vitest (Phase 108 file) | `npx vitest run tests/contact-channel-identity.test.ts` | 0 | PASS | 4/4 tests pass against prod (UNIQUE race, ON DELETE CASCADE, merged_into chain, attachChannelIdentity idempotency). |
| Vitest (Phase 107 file — regression sanity) | `npx vitest run tests/contacts-unique-constraint.test.ts` | 0 | PASS | Sanity re-check; Phase 107 race invariants intact. |
| Migration applied to prod | `apply-1060.mjs` (Plan 01) | 0 | PASS | `schema_migrations` row `{version: "1060", name: "contact_channel_identities"}` confirmed; 6 SQL probes green (A–F including bonus idempotency probe). |

## Test Evidence

```
✓ Phase 108 contact_channel_identities > UNIQUE (org_id, provider, external_id) — parallel INSERTs collide with 23505  1381ms
✓ Phase 108 contact_channel_identities > ON DELETE CASCADE — deleting contact removes its identity rows  440ms
✓ Phase 108 contact_channel_identities > findByChannelIdentity resolves merged_into chain to live survivor  1682ms
✓ Phase 108 contact_channel_identities > attachChannelIdentity is idempotent — second call returns same contact_id, no duplicate row  1081ms

 Test Files  1 passed (1)
 Tests       4 passed (4)
 Duration    6.10s
```

Mechanics:
- **Race (CID-09):** Two distinct `pg.Client` connections fire `INSERT INTO contact_channel_identities` concurrently via `Promise.allSettled`. Result: exactly one fulfilled, one rejected with `code === '23505'` (SQLSTATE `unique_violation`). Proves the FULL `UNIQUE (org_id, provider, external_id)` constraint serializes concurrent writers at the storage layer.
- **Cascade (CID-09):** Insert contact + identity, `DELETE FROM contacts`, then SELECT identity by tuple returns 0 rows. Proves `ON DELETE CASCADE` on the FK.
- **Chain (CID-11):** Insert survivor + archived contact (`identity_status='archived_duplicate'`, `merged_into_contact_id=survivor.id`) + identity attached to archived. `findByChannelIdentity` returns survivor.id — the helper's chain-resolution branch fires.
- **Idempotency (CID-11):** Call `attachChannelIdentity` twice with same args. Both return `{contact_id: c}`; SELECT proves exactly 1 row exists. The INSERT-then-23505-recovery path is a no-op on second call.

Synthetic residue: **zero**. Post-run prod query returned `0` rows matching `external_id LIKE 'race-%'|'cascade-%'|'chain-%'|'idem-%'` and `0` contacts matching `name LIKE 'phase108-test-%'`.

## ROADMAP Success Criteria

| # | Criterion | Evidence | Status |
|---|-----------|----------|--------|
| 1 | Migration creates `contact_channel_identities (id, org_id, contact_id, provider, external_id, created_at, UNIQUE (org_id, provider, external_id))` | `supabase/migrations/1060_contact_channel_identities.sql` §Section 1 + 108-01-SUMMARY Probe A (3 indexes present incl. UNIQUE) + Probe B (23505 on duplicate) + this report's race test | ✓ |
| 2 | RLS policy scoped to `get_current_org_id()` | Migration 1060 §Section 2 (4 policies: SELECT/INSERT/UPDATE/DELETE) + 108-01-SUMMARY Probe E (`SET LOCAL ROLE anon; SELECT count(*)` → 0 rows; no policy granted to anon) | ✓ |
| 3 | Backfill from `contacts WHERE source IN ('instagram','whatsapp','facebook','messenger') AND external_id IS NOT NULL` | Migration 1060 §Section 3 `INSERT...SELECT ... ON CONFLICT DO NOTHING` + 108-01-SUMMARY backfill count (0 rows on current prod, expected — no contacts qualify) + Probe F (re-run idempotent, 0 new rows) | ✓ |
| 4 | `linkConversationsToContacts` updated to upsert channel identity when conversation links to a contact | **Actual target corrected per 108-RESEARCH:** `src/app/(dashboard)/contacts/actions.ts:1020-1065` (NOT `src/lib/meta/process-event.ts:945` — that file is 365 lines and contains no such function; ROADMAP wording was wrong). Evidence: 108-04-SUMMARY commit `7ed4eeb` widens SELECT to include `channel, channel_metadata, org_id`, declares `CHANNEL_TO_PROVIDER` map (widget→webchat), calls `attachChannelIdentity` after every successful `conversations.update({ contact_id })`. | ✓ |
| 5 | **"Vapi/ManyChat webhook contact creation paths updated to write channel identity"** — **CORRECTED per D-02:** Vapi and ManyChat handlers do **NOT** create contacts (verified Phase 107 research, re-verified 108-RESEARCH). The actual contact-creating webhooks are **whatsapp / evolution / telegram**. Phase 108 retrofits the correct trio in 108-04 (commits `7126459`, `712d770`, `f86e338`). Each webhook now does lookup-first via `findByChannelIdentity` then writes via `attachChannelIdentity` on all three success branches (phone-match, new-insert, 23505-recovery). Vapi/ManyChat identity attribution is deferred to Phase 110+ as a future task. | ✓ (with D-02 correction) |
| 6 | `contacts.source` deprecated comment added; old column retained for now | Migration 1060 §Section 4: `COMMENT ON COLUMN public.contacts.source IS 'DEPRECATED Phase 108 — channel attribution lives in contact_channel_identities. Column retained through Phase 109 for back-compat; will be dropped in Phase 110. ...'` | ✓ |
| 7 | Type regen handled | `src/types/database.ts` patched manually (Phases 105/106/107 precedent — CLI/MCP auth blocked): `ChannelProvider` exported type (8-value union matching CHECK constraint byte-for-byte) + `contact_channel_identities` Tables entry (Row/Insert/Update/Relationships). 108-02-SUMMARY confirms `npm run build` exit 0. | ✓ |

## Decisions Honored

| Decision | Honored | Evidence |
|---|---|---|
| **D-01** Wide provider enum (8 values: whatsapp, evolution, telegram, instagram, messenger, facebook, webchat, vapi) | ✓ | Migration 1060 CHECK constraint enumerates all 8; matches `ChannelProvider` type in `src/types/database.ts` |
| **D-02** ROADMAP success #5 correction (whatsapp/evolution/telegram, NOT vapi/manychat) | ✓ | This report's criterion #5 + 108-04-SUMMARY commit log targets the correct trio |
| **D-03** Lookup-first webhook pattern (channel identity → phone → INSERT, with 23505 recovery) | ✓ | 108-04-SUMMARY per-file behavior section; all 3 webhooks follow the order |
| **D-03a** INSERT + 23505 recovery for identity writes (no `.upsert`) | ✓ | 108-03 `attachChannelIdentity` uses `.insert()` + `error.code !== '23505'` branch; grep across modified files shows no `.upsert(` introduced |
| **D-03b** Cross-channel attach to existing phone-rooted contact | ✓ | 108-04-SUMMARY "D-03b Cross-Channel Attach Confirmation" — 9 attach call sites across 3 webhooks (3 branches × 3 handlers) |
| **D-04** `linkConversationsToContacts` integration at `src/app/(dashboard)/contacts/actions.ts:1020` (NOT `src/lib/meta/process-event.ts:945`) | ✓ | 108-04 Task 4 commit `7ed4eeb` modifies the correct file/line range |
| **D-05** `contacts.source` deprecation comment, retain column for now | ✓ | Migration 1060 §Section 4 COMMENT; no DROP COLUMN; back-compat insert path preserved |
| **D-06** No audit-guard, ON CONFLICT DO NOTHING backfill | ✓ | Migration 1060 §Section 3; Probe F re-run idempotency (0 new rows) |
| **D-07** Manual type patch (CLI/MCP blocked precedent) | ✓ | 108-02-SUMMARY documents the manual patch; `npm run build` green |

## Plan Completion Summary

| Plan | Subsystem | Status | Key output |
|---|---|---|---|
| 108-01 | migration | COMPLETE | `supabase/migrations/1060_contact_channel_identities.sql` applied to prod; 6 SQL probes green (A–F) |
| 108-02 | TypeScript types | COMPLETE | `src/types/database.ts` patched with `ChannelProvider` + Tables entry; build green |
| 108-03 | helpers | COMPLETE | `findByChannelIdentity` + `attachChannelIdentity` in `src/lib/contacts/server.ts` (mirror Phase 107 helper conventions) |
| 108-04 | webhook wiring | COMPLETE | 3 webhooks (whatsapp/evolution/telegram) + `linkConversationsToContacts` retrofit; D-03b 9 cross-channel-attach call sites |
| 108-05 | tests + report | COMPLETE (this report) | `tests/contact-channel-identity.test.ts` — 4/4 pass; final validation report |

## Pitfalls Honored (from 108-RESEARCH)

| Pitfall | Honored | Evidence |
|---|---|---|
| #1 Telegram `chatId` not normalisePhone'd for external_id | ✓ | 108-04-SUMMARY: Telegram externalId = `chatId` (raw `String(msg.chat.id)`) |
| #2 WhatsApp Cloud `wa_id` vs Evolution `remoteJid` divergence | ✓ | 108-04-SUMMARY: provider chosen dynamically via `msg.provider === 'evolution' ? 'evolution' : 'whatsapp'` |
| #3 `linkConversationsToContacts` missing `org_id` in SELECT | ✓ | 108-04-SUMMARY: SELECT widened to `id, visitor_phone, channel, channel_metadata, org_id` |
| #6 Full UNIQUE (not partial) allows direct ON CONFLICT inference | ✓ | Migration §Section 3 uses `ON CONFLICT (org_id, provider, external_id) DO NOTHING` — no Phase 107 partial-index gymnastics |
| #8 Backfill preserves `created_at` provenance | ✓ | Migration §Section 3 explicitly selects `c.created_at` (not DEFAULT now()) |

## Requirement Coverage

| Req | Description | Evidence |
|---|---|---|
| **CID-09** | `contact_channel_identities` table with UNIQUE, CHECK, FK CASCADE, RLS | Migration 1060 §1–2 + race test + cascade test |
| **CID-10** | Migration + backfill + deprecation comment, idempotent | Migration 1060 §3–4 + 108-01 Probe F |
| **CID-11** | Webhook integration: lookup-first + write identity in 3 webhooks + Meta link path | 108-04-SUMMARY 4-file diff + this report's chain test + idempotency test |

## Manual Verifications (per 108-VALIDATION.md)

None required — 108-VALIDATION.md explicitly states "all DDL + helpers + wiring is SQL-probable or grep-verifiable." Every behavior is covered by either an SQL probe (Plan 01), a grep check (Plan 04), the build gate (all plans), or the vitest race file (this plan).

## Deferred / Out-of-Scope

- **Identity invariant trigger** — Phase 109. Will enforce "contact must have phone OR email OR channel identity" via `enforce_contact_identity()` trigger.
- **`contacts.source` column drop** — Phase 110.
- **Verified state on channel identity** — Phase 110.
- **UI surfacing (channel badges, filter)** — Phase 110.
- **Vapi/ManyChat channel identity writes** — future task if/when those handlers ever create contacts (currently they do not).
- **Bulk-reassign tool / channel identity audit log / observability dashboard** — future.
- **Meta inbound webhook contact creation (`/api/meta/*`)** — currently doesn't create contacts; not in Phase 108.

## Blockers (for NO-GO)

None.

## Phase 108 Recommendation: **GO**

All 7 ROADMAP success criteria met with concrete evidence:
- Migration 1060 applied to prod with `schema_migrations` row + 6 green SQL probes.
- RLS scoped to `get_current_org_id()` (4 policies) — verified by anon role probe.
- Backfill idempotent and no-op against current prod data (expected per RESEARCH).
- `linkConversationsToContacts` retrofit lands at the correct file (`contacts/actions.ts:1020`, NOT `process-event.ts:945` — ROADMAP wording was wrong; corrected by 108-RESEARCH and D-04).
- Three correct contact-creating webhooks (whatsapp/evolution/telegram) lookup-first + identity-attach across all 3 success branches each (9 attach sites). The ROADMAP's "vapi/manychat" wording was wrong (D-02 correction); vapi/manychat handlers don't create contacts and are out of scope for Phase 108.
- `contacts.source` deprecation comment landed; column retained for back-compat.
- Manual type patch matches CHECK constraint byte-for-byte; `npm run build` exits 0.
- 4/4 vitest race/cascade/chain/idempotency tests pass against prod with zero synthetic residue.

Phase 109 (identity invariant trigger) can begin immediately.

## Follow-ups for Subsequent Phases

- **Phase 109** — identity invariant trigger: enforces `phone OR email OR channel identity`. Also runs on DELETE of `contact_channel_identities` to prevent orphan contacts. Promotion logic for `identity_status='channel_only'` → `'identified'` when phone/email added.
- **Phase 110** — drop `contacts.source` column; verified-state machinery; channel-identity UI surfacing; CSV import dedup against normalized columns; potential Vapi identity attribution if Vapi gains contact-creation paths.
- **Future** — bulk-reassign tool for channel identities across contacts (Pitfall 7 edge case healing); channel identity audit log; observability dashboard for `contact.identity_collision` events.

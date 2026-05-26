---
phase: 110-app-wiring
plan: 02
subsystem: contacts/identity
tags: [blocked-email, validation, defense-in-depth, CID-16]
requirements: [CID-16]
dependency-graph:
  requires:
    - "Phase 109 contact identity invariant (phone OR email OR channel identity)"
    - "Phase 107 partial UNIQUE on (org_id, email_normalized)"
  provides:
    - "src/lib/contacts/blocked-emails.ts — single source of truth for the BLOCKED_EMAIL_PATTERNS blocklist + isBlockedEmail() helper"
  affects:
    - "src/lib/contacts/zod-schemas.ts — contactSchema email refine chain"
    - "src/app/(dashboard)/contacts/actions.ts — createContact server action"
    - "src/lib/whatsapp/process-message.ts — abstain comment"
    - "src/lib/evolution/process-event.ts — abstain comment"
    - "src/lib/telegram/process-update.ts — abstain comment"
tech-stack:
  added: []
  patterns:
    - "Hardcoded regex blocklist (D-04b per-org configurability deferred)"
    - "Defense in depth: Zod (form) → server action (programmatic) → webhook (external payload)"
key-files:
  created:
    - "src/lib/contacts/blocked-emails.ts"
    - "tests/contacts-blocked-emails.test.ts"
  modified:
    - "src/lib/contacts/zod-schemas.ts"
    - "src/app/(dashboard)/contacts/actions.ts"
    - "src/lib/whatsapp/process-message.ts"
    - "src/lib/evolution/process-event.ts"
    - "src/lib/telegram/process-update.ts"
decisions:
  - "D-04: Hardcoded BLOCKED_EMAIL_PATTERNS array (7 patterns) lives in src/lib/contacts/blocked-emails.ts"
  - "D-04a (partial): Wired Zod schema + createContact + 3 webhook handlers; CSV wiring deferred to Plan 110-06"
  - "Pitfall 4: webhook handlers must NOT throw on blocked email — silent null treatment; not invoked since no webhook reads email today"
  - "Pitfall 8: in zod refine chain, isValidEmail runs BEFORE isBlockedEmail"
metrics:
  duration: "~7 minutes"
  completed: "2026-05-26T14:44:41Z"
  tasks: 2
  files_created: 2
  files_modified: 5
  tests_added: 35
---

# Phase 110 Plan 02: Blocked-Email Blocklist Wiring Summary

Hardcoded `BLOCKED_EMAIL_PATTERNS` regex blocklist with case-insensitive, whitespace-tolerant `isBlockedEmail()` helper wired into Zod form validation + `createContact` server action + 3 webhook handlers (whatsapp/evolution/telegram).

## What Was Built

### Task 1 — `src/lib/contacts/blocked-emails.ts` + unit tests (TDD)

Created the single source of truth for placeholder email rejection:

- `BLOCKED_EMAIL_PATTERNS`: readonly array of 7 regex patterns covering `^noemail@`, `^test@test\.`, `^none@`, `^example@`, `^placeholder@`, `^noreply@`, `@example\.(com|org)$`.
- `isBlockedEmail(email)`: trim + lowercase before match; returns false for null/undefined/empty/whitespace-only; never throws (Pitfall 4 webhook contract).
- JSDoc documents the WHY (partial UNIQUE on `email_normalized` collision pollution), all 4 D-04a wire sites, and the Pitfall 8 chain-order rule.

**TDD flow:**
- RED: 35-test suite at `tests/contacts-blocked-emails.test.ts` (positive matches, case insensitivity, whitespace tolerance, negative cases, null safety). Initial `vitest` run failed with `ERR_MODULE_NOT_FOUND` on the missing impl.
- GREEN: Created `blocked-emails.ts` verbatim from RESEARCH.md §"isBlockedEmail (Canonical Implementation)". All 35 tests pass.
- REFACTOR: None needed — canonical implementation is final.

**Commit:** `14073d5`

### Task 2 — Wire `isBlockedEmail` into 5 sites (D-04a)

| # | Site                                                  | Wire shape                                                                     |
| - | ----------------------------------------------------- | ------------------------------------------------------------------------------ |
| 1 | `src/lib/contacts/zod-schemas.ts` `contactSchema`     | Added second `.refine` AFTER `isValidEmail` (Pitfall 8): "This email looks like a placeholder. Leave blank instead." |
| 2 | `src/app/(dashboard)/contacts/actions.ts` `createContact` | After `normaliseContactInput`, `if (data.email && isBlockedEmail(data.email)) data = { ...data, email: null }`. Silent null-out for programmatic callers that bypass Zod. |
| 3 | `src/lib/whatsapp/process-message.ts`                 | Abstain comment at the contact-insert site — WhatsApp payloads carry no email |
| 4 | `src/lib/evolution/process-event.ts`                  | Abstain comment at the contact-insert site — Evolution payloads carry no email |
| 5 | `src/lib/telegram/process-update.ts`                  | Abstain comment at the contact-insert site — Telegram updates carry no email |

**Grep verification:** `Grep "isBlockedEmail" src/` returns 6 file hits (blocklist source + 5 wire sites — exceeds the ≥4 requirement).

**Commit:** `8cc6766` (created Task 2 modifications to zod-schemas + 3 webhook handlers). The `actions.ts` `createContact` wire-in was already integrated into commit `3982a76` by a sibling parallel-wave agent (Plan 110-04) and is verified present in the tree.

## Files

### Created

- `src/lib/contacts/blocked-emails.ts` (54 lines)
- `tests/contacts-blocked-emails.test.ts` (120 lines, 35 tests)

### Modified

- `src/lib/contacts/zod-schemas.ts` — added import + second refine on email field
- `src/app/(dashboard)/contacts/actions.ts` — added import + silent null-out in createContact (committed via sibling parallel agent)
- `src/lib/whatsapp/process-message.ts` — abstain comment at contact INSERT
- `src/lib/evolution/process-event.ts` — abstain comment at contact INSERT
- `src/lib/telegram/process-update.ts` — abstain comment at contact INSERT

## Verification

### Automated
- `npx vitest run tests/contacts-blocked-emails.test.ts` → **35/35 pass** (0.3s)
- `npm run build` → **exit 0** (full Next.js production build green)
- `Grep "isBlockedEmail" src/` → 6 file hits (source + 5 wire sites)

### Decisions Implemented
- **D-04:** Hardcoded 7-pattern blocklist in `src/lib/contacts/blocked-emails.ts` ✓
- **D-04a (partial):** Zod refine ✓, createContact ✓, 3 webhook handlers (abstain) ✓
- **D-04a (deferred):** CSV import wiring — Plan 110-06 will refactor the CSV path and wire isBlockedEmail there alongside the pre-flight enhancement.
- **D-04b:** Per-org configurability deferred to follow-up milestone.

## Deviations from Plan

### Wire-site shape adjustment

**[Rule 2 - Pre-existing Code Reality] All 3 webhook handlers abstain (none read email from payload)**

- **Found during:** Task 2
- **Issue:** Plan instructed wiring `isBlockedEmail` at the email-read site in whatsapp/evolution/telegram handlers. `Grep` confirmed NONE of the 3 handlers currently read an email field from inbound payloads — they are pure phone/channel providers.
- **Fix:** Per the plan's explicit guidance ("If a webhook does NOT currently read email from the payload, add a defensive comment and leave it. Do not invent email-read sites"), added abstain comments at each contact-insert site documenting (a) why isBlockedEmail is not wired today and (b) the exact gating pattern to apply if a future payload variant exposes email metadata.
- **Files modified:** `process-message.ts`, `process-event.ts`, `process-update.ts`
- **Commit:** `8cc6766`

### Cross-agent commit attribution

- **Issue:** The `createContact` wire-in to `src/app/(dashboard)/contacts/actions.ts` was applied here in Task 2 but landed in commit `3982a76` (authored by the sibling Plan 110-04 agent) before this agent's `git add` ran in the parallel wave.
- **Impact:** Zero — the change is present, build-green, and correctly placed at line 462. Documented here for traceability.

## Known Stubs

None. All wire points either invoke `isBlockedEmail` directly (Zod, createContact) or carry a documented abstain comment (3 webhook handlers — no email field exists in their payloads). CSV wiring is the only remaining D-04a site and is explicitly scoped to Plan 110-06.

## Authentication Gates

None.

## Self-Check

- `src/lib/contacts/blocked-emails.ts` — **FOUND**
- `tests/contacts-blocked-emails.test.ts` — **FOUND**
- Commit `14073d5` (Task 1) — **FOUND**
- Commit `8cc6766` (Task 2) — **FOUND**
- `Grep isBlockedEmail src/` → 6 hits — **CONFIRMED**

## Self-Check: PASSED

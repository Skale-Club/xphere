---
phase: 107-unique-constraints
plan: 03
subsystem: webhooks
tags: [whatsapp, evolution, telegram, contacts, dedup, race-safety, webhooks]

# Dependency graph
requires:
  - phase: 107-unique-constraints/01
    provides: "Migration 1059 partial UNIQUE indexes (phone_e164, email_normalized)"
  - phase: 107-unique-constraints/02
    provides: "findByPhone / findByEmail canonical lookup helpers in src/lib/contacts/server.ts"
  - phase: 105-audit-generated-columns
    provides: "phone_e164 generated column + normalisePhone helper"
provides:
  - "WhatsApp Cloud contact-create path is race-safe (23505 → findByPhone recovery)"
  - "Evolution API contact-create path is race-safe (23505 → findByPhone recovery)"
  - "Telegram contact-create path is race-safe (23505 → findByPhone recovery)"
  - "Consistent structured log line across three handlers: '[<source>/process] contact.unique_collision ...'"
affects: [107-04-form-callers, 108-channel-identities]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Webhook contact-create: lookup on phone_e164 + insert + catch 23505 + findByPhone recovery"
    - "Conditional lookup guard: only query phone_e164 when normalisePhone returns non-null (TS strictness + match index predicate)"
    - "Webhook handlers stay HTTP 200 — recovery never throws out (CLAUDE.md webhook rule)"

key-files:
  created: []
  modified:
    - "src/lib/whatsapp/process-message.ts (+imports, lookup→phone_e164, 23505 recovery)"
    - "src/lib/evolution/process-event.ts (+imports, lookup→phone_e164, 23505 recovery)"
    - "src/lib/telegram/process-update.ts (+imports, lookup→phone_e164, 23505 recovery)"

key-decisions:
  - "Telegram chat_id flows through phone_e164 normalization (digits-only) — works for partial UNIQUE matching but is not semantically a phone; Phase 108 channel_identities will replace this hack"
  - "Conditional lookup guard (phoneNorm ? ... : { data: null }) avoids TS null-strict error on .eq('phone_e164', string) while preserving identical runtime behavior to the previous raw-phone lookup"
  - "Non-23505 insert errors are logged but do not propagate (webhook still returns 200)"
  - "All three handlers exclude identity_status='archived_duplicate' on lookup to match the partial UNIQUE index predicate (Pitfall 1 in RESEARCH)"

patterns-established:
  - "Webhook collision log shape: console.log(`[<source>/process] contact.unique_collision source=<source> org_id=<id> contact_id=<id> matched_via=phone`)"

requirements-completed: [CID-07, CID-08]

# Metrics
duration: 5m 00s
completed: 2026-05-26
---

# Phase 107 Plan 03: Webhook unique-violation recovery (whatsapp / evolution / telegram) Summary

**Three webhook contact-creation paths now catch SQLSTATE 23505 from the new partial UNIQUE indexes, recover via `findByPhone`, and log a structured collision metric. Webhooks remain HTTP 200.**

## Performance

- **Duration:** ~5m (300s)
- **Tasks:** 3/3 complete
- **Files touched:** 3
- **Commits:** 3 (one per task) + 1 docs commit

## What changed

### Task 1 — `src/lib/whatsapp/process-message.ts`

- Added imports: `findByPhone` from `@/lib/contacts/server`, `normalisePhone` from `@/lib/contacts/zod-schemas`.
- Lookup switched from `.eq('phone', fromPhone)` to `.eq('phone_e164', normalisePhone(fromPhone))` + `.neq('identity_status', 'archived_duplicate')`. Wrapped in a `phoneNorm ? ... : { data: null }` guard so a null normalised value falls through to insert.
- INSERT now destructures `error: insErr`. On `insErr?.code === '23505'` → calls `findByPhone(supabase, orgId, fromPhone)` and uses the winner's id. Logs `[whatsapp/process] contact.unique_collision source=whatsapp org_id=... contact_id=... matched_via=phone`.
- Non-23505 errors logged + `contactId = null` (existing downstream tolerates null).
- Commit: `d81cd9a`

### Task 2 — `src/lib/evolution/process-event.ts`

- Same shape as Task 1, applied at the conversation-create branch (lines 217-241 pre-edit).
- Log prefix `[evolution/process]`, `source=evolution`.
- Commit: `a058807`

### Task 3 — `src/lib/telegram/process-update.ts`

- Same shape as Tasks 1-2.
- Telegram stores `chat_id` in the `contacts.phone` column (Telegram doesn't expose real phones). `normalisePhone(chatId)` returns the digits-only form (e.g. `"123456789"`), which flows through the `phone_e164` generated column unchanged, so the partial UNIQUE index protects against duplicate inserts on the same chat_id within an org.
- Added an inline comment noting Phase 108 (channel_identities) will replace this hack with proper Telegram numeric-id matching.
- Log prefix `[telegram/process]`, `source=telegram`.
- Commit: `cb470ef`

## RESEARCH correction applied

CONTEXT D-03a originally named Meta/Vapi/ManyChat as the unique-violation targets. RESEARCH proved via grep that those handlers do NOT create contact rows in this repo — the actual contact-creating webhooks are **whatsapp / evolution / telegram**. This plan implemented against the corrected targets. No changes were made to Meta/Vapi/ManyChat handlers.

## Verification

- `grep "findByPhone" src/lib/whatsapp/process-message.ts src/lib/evolution/process-event.ts src/lib/telegram/process-update.ts` → all three present.
- `grep "23505" ...same files...` → all three present.
- `grep "contact.unique_collision" ...same files...` → all three present.
- `grep "phone_e164" ...same files...` → all three present.
- `npm run build` → exit 0 (TypeScript + Next.js production build clean).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript strict-null guard on phone_e164 lookup**
- **Found during:** Task 1 first build attempt.
- **Issue:** `normalisePhone(fromPhone)` returns `string | null`, but `.eq('phone_e164', value)` requires `string`. Initial implementation broke `npm run build` with TS2345.
- **Fix:** Wrapped lookup in ternary: `phoneNorm ? await supabase...maybeSingle() : { data: null }`. When normalisation fails, falls through to insert (which is the same behavior as before — previous code with raw `phone` would also fail to match on a malformed phone). Same guard applied to Tasks 2 and 3 preemptively.
- **Files modified:** `src/lib/whatsapp/process-message.ts` (Task 1), preemptively applied to other two files.
- **Commit:** folded into Task 1 commit `d81cd9a`.

## Known Stubs

None.

## Self-Check: PASSED

All three modified files exist and contain the required tokens. All three commits exist on `main`:
- d81cd9a (whatsapp)
- a058807 (evolution)
- cb470ef (telegram)

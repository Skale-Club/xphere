---
phase: 137-product-cards-order-status
plan: 04
subsystem: crm
tags: [contacts, chat-route, email-upsert, commerce-events]

# Dependency graph
requires:
  - phase: 133-signed-context-identity-pinning
    provides: verified CommerceClaims.email (never from user input) pinned at chat-route step 6b
  - phase: 136-commerce-events-ingestion
    provides: emitCommerceEvent's inline find-or-create-by-email (the second consumer this plan delegates to the shared helper)
provides:
  - findOrCreateContactByEmail(supabase, orgId, email, options?) — the single canonical email-based contact upsert
  - linkVerifiedContact(supabase, orgId, conversationId, email) — throttled, org-scoped, fail-soft conversation-to-contact link
  - chat route links a verified-email visitor to a CRM contact right after writeCommerceContext
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "One canonical email-upsert helper (find-or-create-by-email.ts) now backs BOTH the chat route (via linkVerifiedContact) and Phase 136's emitCommerceEvent — no third inline copy"
    - "Throttle-then-atomic-guard: linkVerifiedContact reads contact_id first (cheap early skip) then still guards the UPDATE with .is('contact_id', null) — belt-and-suspenders against a race"

key-files:
  created:
    - src/lib/contacts/find-or-create-by-email.ts
    - src/lib/contacts/link-verified-contact.ts
    - tests/chat-route-contact-linking.test.ts
  modified:
    - src/app/api/chat/[token]/route.ts
    - src/lib/commerce/events.ts

key-decisions:
  - "events.ts WAS successfully refactored to delegate to the shared helper (the preferred, non-reverted outcome) — the hard gate (tests/commerce-events-route.test.ts + tests/commerce-events-emit.test.ts) stayed green after the change, so both consumers now share one upsert implementation"
  - "findOrCreateContactByEmail does NOT emit contact.created and does NOT touch conversations — callers (events.ts, link-verified-contact.ts) own those side effects, keeping the helper reusable without forcing commerce-specific behavior onto the chat-route path"

requirements-completed: [UIX-03]

# Metrics
duration: 22min
completed: 2026-07-17
---

# Phase 137 Plan 04: CRM Contact Linking Summary

**A verified commerce-context email now find-or-creates a CRM contact and links it to the conversation (throttled, org-scoped, fail-soft) via one shared `findOrCreateContactByEmail` helper — and Phase 136's `emitCommerceEvent` was successfully refactored to delegate to that same helper instead of keeping its own inline copy.**

## Performance

- **Duration:** 22 min
- **Started:** 2026-07-17T21:12:00Z
- **Completed:** 2026-07-17T21:34:00Z
- **Tasks:** 2
- **Files modified:** 5 (3 new, 2 modified)

## Accomplishments
- `src/lib/contacts/find-or-create-by-email.ts` is now THE single canonical email-based contact upsert: `email_normalized` lookup, `archived_duplicate` exclusion, insert with an options-driven payload (lifecycle stage / source / name fields), and an insert-race re-select — mirroring `leads/ingest.ts`'s subtle handling exactly.
- `src/lib/contacts/link-verified-contact.ts` throttles on an already-linked conversation (early read-skip), delegates the upsert to the shared helper, and guards its `conversations` UPDATE with `.is('contact_id', null)` — atomic "only if currently null" — every query scoped by `org_id`, whole body wrapped in try/catch so it can never throw.
- The chat route (`src/app/api/chat/[token]/route.ts`) calls `linkVerifiedContact` immediately after `writeCommerceContext`, only inside the verified-`claims` branch and only when `claims.email` is present — still inside the route's existing fail-soft try/catch, so a DB error never breaks the chat's 200 SSE response.
- `src/lib/commerce/events.ts`'s `emitCommerceEvent` now calls `findOrCreateContactByEmail` instead of its own inline `email_normalized` lookup + insert — the HARD GATE (`tests/commerce-events-route.test.ts` + `tests/commerce-events-emit.test.ts`) stayed green, so the delegation was **kept**, not reverted.

## Task Commits

Each task was committed atomically:

1. **Task 1: shared findOrCreateContactByEmail helper + linkVerifiedContact** - `2a01572b` (feat)
2. **Task 2: wire the chat route + delegate events.ts to the shared helper** - `019f1c18` (feat)

**Plan metadata:** (pending — recorded with this SUMMARY commit)

## Files Created/Modified
- `src/lib/contacts/find-or-create-by-email.ts` - new shared email-upsert helper
- `src/lib/contacts/link-verified-contact.ts` - new throttled/org-scoped/fail-soft conversation linker
- `src/app/api/chat/[token]/route.ts` - calls `linkVerifiedContact` after `writeCommerceContext` when `claims.email` is present
- `src/lib/commerce/events.ts` - `emitCommerceEvent`'s contact upsert now delegates to `findOrCreateContactByEmail`
- `tests/chat-route-contact-linking.test.ts` - helper (existing/new/insert-race/unusable-email/options) + linker (throttle/fresh-link/unusable-email/never-throws/org-scoping) coverage

## Decisions Made
- **events.ts delegation outcome: KEPT (not reverted).** Ran the plan's hard-gate command (`tests/chat-route-contact-linking.test.ts tests/commerce-events-route.test.ts` plus, additionally, `tests/commerce-events-emit.test.ts` which exercises `emitCommerceEvent`'s actual logic) — all 31 tests passed, `npm run build` stayed clean. The spy-based mock in `tests/commerce-events-emit.test.ts` records calls generically by table/method, so it was agnostic to which function (the old inline code or the new shared helper) issued the `contacts` select/insert calls; the `toMatchObject` assertion on the insert payload (`{ source: 'api', email: ... }`) matched the helper's payload shape without modification.
- `contactId` was changed from `let` to `const` in `events.ts` since it is no longer reassigned after the refactor (was previously mutated inside the inline if/else branches) — a minor cleanup with zero behavioral change, verified by re-running the same test suite before finalizing.

## Deviations from Plan

None — plan executed exactly as written, including the preferred (non-reverted) events.ts delegation outcome the plan called out as the "PREFERRED outcome per Q1 ruling."

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required. No migration: `conversations.contact_id`/`visitor_email` already existed (database.ts:2560/2551).

## Next Phase Readiness
- `findOrCreateContactByEmail` is now the canonical email-upsert entry point for any future email-based contact resolution in this codebase — new callers should use it rather than forking another inline copy.
- Phase 137's remaining wave-2 plans (137-03 order-status wiring, 137-05 widget renderer) are unaffected by this plan's file set (disjoint files) and unblocked to proceed independently.
- Phase 136's `tests/commerce-events-route.test.ts`/`tests/commerce-events-emit.test.ts` suites remain green post-refactor — no regression risk carried forward.

---
*Phase: 137-product-cards-order-status*
*Completed: 2026-07-17*

## Self-Check: PASSED

All created/modified files verified present on disk; all task commit hashes verified present in git log.

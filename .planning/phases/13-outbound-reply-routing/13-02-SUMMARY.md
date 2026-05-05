---
phase: 13-outbound-reply-routing
plan: 02
subsystem: api
tags: [meta, facebook, messenger, instagram, channel-routing, vitest, tdd]

# Dependency graph
requires:
  - phase: 13-01
    provides: sendMetaMessage lib + 8 RED test stubs (it.todo)
  - phase: 11-meta-webhook
    provides: channel_metadata field names (igsid/sender_id/page_id) from process-event.ts
  - phase: 10-meta-oauth
    provides: encrypted_page_access_token in meta_channels, decrypt() helper
provides:
  - Modified POST /api/chat/conversations/[id]/messages with channel branching
  - 8 GREEN tests covering all METAINBOX-03 behaviors
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Channel routing: if/else after DB insert — widget = no-op, messenger/instagram = Meta Send API"
    - "TypeScript cast: conv.channel_metadata as Record<string, string> for Json type"
    - "DB-first with structured error return: insert first, then Meta send, never roll back insert"
    - "maybeSingle() null check before decrypt to prevent runtime crash"

key-files:
  created:
    - .planning/phases/13-outbound-reply-routing/13-02-SUMMARY.md
  modified:
    - src/app/api/chat/conversations/[id]/messages/route.ts
    - tests/outbound-reply-routing.test.ts

key-decisions:
  - "sender_id used for messenger (not psid) — migration 020 comment is wrong, process-event.ts is authoritative"
  - "Channel branch placed after last_message update and before final return — widget path completely unchanged"
  - "createClient() used (not createServiceRoleClient()) — RLS scopes to org automatically"
  - "Synchronous Meta send (not after()) — admin waits for delivery confirmation"
  - "conv.channel === guard ensures type narrowing for messenger/instagram comparison"

requirements-completed: [METAINBOX-03]

# Metrics
duration: 15min
completed: 2026-05-04
---

# Phase 13 Plan 02: Outbound Reply Routing — Channel Branching Summary

**POST /api/chat/conversations/[id]/messages extended with channel routing: widget = DB-only, messenger/instagram = Meta Send API via sendMetaMessage after DB insert, with structured error classification for token-revoked (190), meta_send_failed, and channel_not_configured**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-05-04
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Extended `src/app/api/chat/conversations/[id]/messages/route.ts`:
  - Added `decrypt` and `sendMetaMessage` imports
  - Extended SELECT from `'id, org_id'` to `'id, org_id, channel, channel_metadata'`
  - Inserted channel routing block after `last_message` update, before final `Response.json({ message }, { status: 201 })`
  - Widget path completely unchanged (no outbound call, same 201 response)
  - messenger/instagram: fetch meta_channels by page_id + channel_type, decrypt token, extract recipientId, call sendMetaMessage
  - Error classification: code 190 → `{ error: 'token_revoked', channel }` 400; other Meta errors → `{ error: 'meta_send_failed', message }` 502; no meta_channel record → `{ error: 'channel_not_configured' }` 400
- Converted all 8 `it.todo()` stubs to `it()` implementations in `tests/outbound-reply-routing.test.ts`
- All 8 tests GREEN: widget no-op, messenger sender_id, instagram igsid, code-190 error, other-error 502, missing-channel 400, unauth 401, DB-fail 500
- `npm run build` exits 0 — TypeScript strict compliance confirmed

## Task Commits

Each task committed atomically:

1. **Task 1: Modify POST handler + GREEN tests** - `64963e1` (feat)
2. **Task 2: Build gate** - verification only (no file changes)

## Files Created/Modified

- `src/app/api/chat/conversations/[id]/messages/route.ts` — extended SELECT + channel routing block (2 import lines, 1 select change, 1 channel branch block)
- `tests/outbound-reply-routing.test.ts` — 8 it.todo() → 8 it() implementations, all GREEN

## Decisions Made

- Used `sender_id` (not `psid`) for messenger channel_metadata — verified from process-event.ts lines 93-96; migration 020 SQL comment is stale
- Channel branch inserted AFTER `last_message` update and BEFORE `const message: ConversationMessage = {...}` — ensures widget path is completely unchanged
- `conv.channel_metadata as Record<string, string>` cast to handle `Json` type from database.ts TypeScript strict mode
- Used `createClient()` (existing user-scoped client) — no `createServiceRoleClient()` needed since RLS auto-scopes to org

## Deviations from Plan

None - plan executed exactly as written. The merge of Plan 01 worktree branch and main branch was needed first (prerequisite files were in separate branches not yet in this worktree), then the plan was executed surgically.

## Known Stubs

None. All channel routing logic is fully wired: meta_channels lookup, token decryption, sendMetaMessage call, structured error responses.

## Self-Check: PASSED

- `src/app/api/chat/conversations/[id]/messages/route.ts` — FOUND (sendMetaMessage import, channel routing block)
- `tests/outbound-reply-routing.test.ts` — FOUND (8 GREEN tests)
- commit `64963e1` — FOUND
- `npm run build` — exits 0
- `npx vitest run tests/outbound-reply-routing.test.ts` — 8/8 PASSED

---
*Phase: 13-outbound-reply-routing*
*Completed: 2026-05-04*

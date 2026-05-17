---
phase: 11-meta-webhook
plan: "02"
subsystem: api
tags: [nextjs, meta, instagram, messenger, webhook, hmac, vitest, tdd, supabase, node-crypto]

# Dependency graph
requires:
  - phase: 11-meta-webhook plan 01
    provides: migration 022 (last_inbound_at + meta_channels.config), RED test stubs, updated TypeScript types
  - phase: 10-meta-oauth
    provides: meta_channels table with encrypted page tokens and automation_id FK
  - phase: 07-db-foundation
    provides: conversations + conversation_messages tables with channel/channel_metadata columns

provides:
  - src/lib/meta/process-event.ts — processMetaEvent function with full business logic
  - src/app/api/meta/webhook/route.ts — GET hub challenge + POST HMAC-verified webhook handler
  - All 29 METAEV tests GREEN across 5 test files
  - META_VERIFY_TOKEN documented in .env.local.example

affects: [12-inbox-ui, 13-outbound-reply]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Meta webhook pattern: request.text() BEFORE JSON.parse for HMAC-SHA256 verification"
    - "timingSafeEqual for constant-time HMAC comparison (prevents timing attacks)"
    - "after() from next/server for fire-and-forget async processing after 200 response"
    - "Service role client pattern for webhook handlers (no user auth context)"
    - "Supabase chainable mock pattern: vi.fn() per table with per-operation spies"
    - "processMetaEvent extracted to lib/ for independent testability without HTTP layer"

key-files:
  created:
    - src/lib/meta/process-event.ts
    - src/app/api/meta/webhook/route.ts
    - tests/meta-webhook-verification.test.ts (was todo stub, now 7 GREEN tests)
    - tests/meta-webhook-conversation.test.ts (was todo stub, now 9 GREEN tests)
    - tests/meta-webhook-automation.test.ts (was todo stub, now 4 GREEN tests)
    - tests/meta-webhook-keyword.test.ts (was todo stub, now 4 GREEN tests)
    - tests/meta-webhook-24h.test.ts (was todo stub, now 5 GREEN tests)
  modified:
    - .env.local.example (META_APP_SECRET + META_VERIFY_TOKEN documented)

key-decisions:
  - "processMetaEvent extracted to src/lib/meta/process-event.ts for testability without mocking HTTP layer"
  - "request.text() is called BEFORE JSON.parse in the route — HMAC must be over original bytes not re-serialized JSON"
  - "after() used for async dispatch — ensures Meta receives 200 before any DB work, preventing retry storms"
  - "widget_token set to '' for all Meta conversation inserts — NOT NULL column with no DEFAULT, Meta channels don't use widget tokens"
  - "Single try/catch wraps each messaging event iteration so one failure doesn't block processing of remaining events"
  - "24h window check uses existing?.last_inbound_at (null for new conversations = window not expired = automation fires)"

patterns-established:
  - "Supabase mock per-operation spies: insertConversationSpy/updateConversationSpy/insertMessageSpy give clean assertions without fragile builder traversal"
  - "vi.mock('next/server', { after: vi.fn((fn) => fn()) }) runs after() callback synchronously in tests"
  - "vi.resetModules() in beforeEach combined with dynamic import ensures fresh module state per test"

requirements-completed:
  - METAEV-01
  - METAEV-02
  - METAEV-03
  - METAEV-04
  - METAEV-05

# Metrics
duration: 10min
completed: "2026-05-04"
---

# Phase 11 Plan 02: Meta Webhook Implementation Summary

**Unified /api/meta/webhook handler with HMAC-SHA256 verification, async after() dispatch, conversation creation, keyword-triggered automation, and 24h window enforcement — all 29 METAEV tests GREEN**

## Performance

- **Duration:** 10 min
- **Started:** 2026-05-04T20:20:00Z
- **Completed:** 2026-05-04T20:29:00Z
- **Tasks:** 2 of 2
- **Files modified:** 8

## Accomplishments

- Created processMetaEvent handling Instagram (object=instagram) and Messenger (object=page) payloads, with echo filtering, conversation de-duplication, 24h window enforcement, keyword trigger matching, and GHL automation dispatch
- Created /api/meta/webhook route with GET hub challenge handler and POST HMAC-SHA256 verification using node:crypto timingSafeEqual; after() ensures 200 returns before DB work
- Turned all 29 RED todo stubs GREEN across 5 test files covering METAEV-01 through METAEV-05
- npm run build passes with /api/meta/webhook appearing in the compiled route list

## Task Commits

Each task was committed atomically:

1. **Task 1: processMetaEvent + 4 test files GREEN** - `1730611` (feat)
2. **Task 2: /api/meta/webhook route + verification tests GREEN** - `09cc8da` (feat)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `src/lib/meta/process-event.ts` — MetaWebhookPayload type + processMetaEvent with full business logic
- `src/app/api/meta/webhook/route.ts` — GET (hub challenge) + POST (HMAC-signed event) handlers, runtime='nodejs'
- `tests/meta-webhook-verification.test.ts` — 7 tests: GET challenge + POST HMAC (METAEV-01)
- `tests/meta-webhook-conversation.test.ts` — 9 tests: Instagram DM, Messenger, echo filtering (METAEV-02)
- `tests/meta-webhook-automation.test.ts` — 4 tests: automation dispatch logic (METAEV-03)
- `tests/meta-webhook-keyword.test.ts` — 4 tests: keyword trigger filtering (METAEV-04)
- `tests/meta-webhook-24h.test.ts` — 5 tests: 24h window enforcement (METAEV-05)
- `.env.local.example` — META_APP_SECRET and META_VERIFY_TOKEN documented with instructions

## Decisions Made

- processMetaEvent extracts to `src/lib/meta/process-event.ts` — tested without HTTP layer; route is a thin dispatcher
- `request.text()` before `JSON.parse` is non-negotiable; HMAC must cover original bytes
- Per-operation Supabase spies (insertConversationSpy, updateConversationSpy, insertMessageSpy) are cleaner than traversing `from.mock.results` chains
- `vi.mock('next/server', () => ({ after: vi.fn((fn) => fn()) }))` runs the after() callback synchronously in tests, enabling direct assertion of processMetaEvent calls

## Deviations from Plan

### Note: Plan criterion vs implementation

**[Acceptable Divergence] Plan grep criterion: "grep 'status: 403' returns exactly 1 match"**
- **Found during:** Task 2 acceptance verification
- **Issue:** The plan states "only HMAC failure returns 403" but the plan's own must_haves also specify GET returns 403 on token mismatch — both are correct behaviors, resulting in 2 occurrences of `status: 403` in the file
- **Fix:** No fix needed — 2 occurrences is correct per the plan's own must_haves (one in GET handler, one in POST HMAC failure path)
- **Verification:** Both 403 responses have the correct semantics; 29 tests pass including the 403 GET and POST tests

---

**Total deviations:** 1 non-change (plan criterion was imprecise; implementation is correct)
**Impact on plan:** Zero impact — all behaviors are correct and tested.

## Issues Encountered

The initial Supabase mock for conversation tests used a fragile pattern (traversing `from.mock.results` to find builders with specific methods). After running the tests, this failed because every `from('conversations')` call returned a builder with both `select` and `insert` methods. Replaced with per-operation named spies (insertConversationSpy, updateConversationSpy, insertMessageSpy) that are directly assertable. All 9 conversation tests then passed on the first run.

## Known Stubs

None — processMetaEvent is fully wired to createServiceRoleClient, executeAction, and decrypt. No hardcoded empty values or placeholder data flows to UI rendering.

## User Setup Required

**External configuration required before Meta can deliver events:**

1. **Add META_VERIFY_TOKEN to `.env.local`:** Generate with `openssl rand -hex 16` and add as `META_VERIFY_TOKEN=<value>`
2. **Add META_VERIFY_TOKEN to Vercel:** Settings → Environment Variables → `META_VERIFY_TOKEN`
3. **Register webhook in Meta App Dashboard:** App → Webhooks → Add Subscription → `https://operator.skale.club/api/meta/webhook`; paste the same META_VERIFY_TOKEN value as the Verify Token
4. **Confirm META_APP_SECRET is set in Vercel:** Should already be set from Phase 10; required for POST HMAC verification
5. **Run `npx supabase db push`** to apply migration 022 to the remote database (if not already done after Plan 11-01)

## Next Phase Readiness

- `/api/meta/webhook` is fully implemented and ready to receive production events
- processMetaEvent creates conversations and fires automations — Phase 12 (Inbox UI) can read the `channel` and `channel_metadata` columns to render Instagram/Messenger conversations alongside widget conversations
- Phase 13 (Outbound Reply Routing) will modify `src/app/api/chat/conversations/[id]/messages` to support Meta reply sending — the `last_inbound_at` + `window_expired` flag are already in place to gate outbound sends

---
*Phase: 11-meta-webhook*
*Completed: 2026-05-04*

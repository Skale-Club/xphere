---
phase: 11-meta-webhook
plan: "01"
subsystem: database
tags: [supabase, postgresql, typescript, vitest, tdd, meta, webhook]

# Dependency graph
requires:
  - phase: 10-meta-oauth
    provides: meta_channels table with page tokens
  - phase: 07-db-foundation
    provides: conversations table with channel/channel_metadata columns (migration 020)

provides:
  - Migration 022 adding last_inbound_at TIMESTAMPTZ to conversations
  - Migration 022 adding config JSONB to meta_channels
  - Partial index on conversations.last_inbound_at excluding widget channel
  - TypeScript types updated for both new columns (Row, Insert, Update)
  - RED test stubs for METAEV-01 through METAEV-05 (29 todos across 5 files)

affects: [11-meta-webhook, 12-inbox-ui, 13-outbound-reply]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Migration pattern: IF NOT EXISTS guards for safe re-runs"
    - "Partial index pattern: WHERE channel != 'widget' to keep index lean"
    - "TDD RED pattern: it.todo() stubs compile and exit 0, no implementation imports"

key-files:
  created:
    - supabase/migrations/022_conversation_inbound_at.sql
    - tests/meta-webhook-verification.test.ts
    - tests/meta-webhook-conversation.test.ts
    - tests/meta-webhook-automation.test.ts
    - tests/meta-webhook-keyword.test.ts
    - tests/meta-webhook-24h.test.ts
  modified:
    - src/types/database.ts

key-decisions:
  - "last_inbound_at is nullable (NULL = no inbound message ever received) to distinguish new conversations from timed-out ones"
  - "meta_channels.config defaults to '{}' (NOT NULL) so code can always JSON-access it without null checks"
  - "Partial index excludes widget channel since 24h window concept does not apply to widget conversations"

patterns-established:
  - "Test stubs: import only from 'vitest', no implementation file imports until Plan 11-02"
  - "One todo per METAEV requirement minimum; actual count is 29 covering all sub-behaviors"

requirements-completed:
  - METAEV-01
  - METAEV-02
  - METAEV-03
  - METAEV-04
  - METAEV-05

# Metrics
duration: 3min
completed: "2026-05-05"
---

# Phase 11 Plan 01: Meta Webhook Foundation Summary

**Migration 022 adds last_inbound_at and meta_channels.config; 29 RED test stubs cover all METAEV requirements as it.todo() contracts for Plan 11-02**

## Performance

- **Duration:** 3 min
- **Started:** 2026-05-05T00:10:25Z
- **Completed:** 2026-05-05T00:13:52Z
- **Tasks:** 2 of 2
- **Files modified:** 7

## Accomplishments

- Created migration 022 with both ALTER TABLE statements and a partial index; no existing data affected
- Updated conversations and meta_channels TypeScript types (Row, Insert, Update) with new columns; build passes cleanly
- Created 5 RED test stub files with 29 it.todo() cases; npx vitest run exits 0

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 022 and update TypeScript types** - `a70bd9b` (chore)
2. **Task 2: Write RED test stubs for METAEV-01 through METAEV-05** - `46061db` (test)

**Plan metadata:** (docs commit — see below)

## Files Created/Modified

- `supabase/migrations/022_conversation_inbound_at.sql` - Adds last_inbound_at TIMESTAMPTZ to conversations and config JSONB to meta_channels, with partial index
- `src/types/database.ts` - conversations and meta_channels Row/Insert/Update extended with new columns
- `tests/meta-webhook-verification.test.ts` - 7 todos: GET challenge verification + POST HMAC (METAEV-01)
- `tests/meta-webhook-conversation.test.ts` - 9 todos: Instagram DM, Messenger, echo filter (METAEV-02)
- `tests/meta-webhook-automation.test.ts` - 4 todos: automation dispatch logic (METAEV-03)
- `tests/meta-webhook-keyword.test.ts` - 4 todos: keyword trigger filtering (METAEV-04)
- `tests/meta-webhook-24h.test.ts` - 5 todos: 24h window enforcement (METAEV-05)

## Decisions Made

- `last_inbound_at` is nullable — NULL means no inbound message ever received, which is distinct from a timed-out conversation
- `meta_channels.config` is NOT NULL DEFAULT '{}' so handlers can always access `config->>'keyword_trigger'` without null guards
- Partial index excludes widget channel since the 24h messaging window is a Meta-only concept

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

Pre-existing TypeScript errors in test files (brand.test.ts, redis.test.ts, widget-asset.test.ts) complained about missing test runner globals — these are pre-existing and unrelated to this plan. The build (`npm run build`) passes cleanly.

## User Setup Required

After this plan, run `npx supabase db push` to apply migration 022 to the remote database before Plan 11-02 begins implementation.

## Next Phase Readiness

- Migration 022 is ready to push to remote DB
- TypeScript types compile cleanly with both new columns
- All 5 test files exist as RED stubs; Plan 11-02 turns them GREEN by implementing the Meta webhook handler

---
*Phase: 11-meta-webhook*
*Completed: 2026-05-05*

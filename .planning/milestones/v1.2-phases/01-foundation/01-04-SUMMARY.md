---
phase: 01-foundation
plan: "04"
subsystem: database
tags: [supabase, postgres, rls, typescript, migration]

requires:
  - phase: 01-01
    provides: Planning and brand context for v1.2 foundation

provides:
  - "chat_sessions table in Supabase with org_isolation RLS policy"
  - "chat_messages table in Supabase with org_isolation RLS policy"
  - "TypeScript Row/Insert/Update types for chat_sessions and chat_messages in database.ts"
  - "Migration 011_chat_schema.sql applied to remote Supabase"

affects:
  - "02-chat-api"
  - "03-ai-conversation"
  - "04-widget"

tech-stack:
  added: []
  patterns:
    - "service-role bypass pattern: public chat API writes via createServiceRoleClient() — no anon RLS policy needed"
    - "denormalized organization_id on chat_messages for RLS without join"
    - "last_active_at instead of updated_at for session freshness tracking"

key-files:
  created:
    - "supabase/migrations/011_chat_schema.sql"
  modified:
    - "src/types/database.ts"

key-decisions:
  - "No anon-role RLS policy on chat tables — Phase 2 writes via service-role client bypassing RLS entirely"
  - "organization_id denormalized on chat_messages for efficient RLS policy without joining sessions"
  - "idx_chat_sessions_last_active index added for Phase 3 session freshness queries"

patterns-established:
  - "RLS pattern: authenticated-only org_isolation policy for admin read access; service-role client for public write path"

requirements-completed:
  - INFRA-02

duration: 12min
completed: "2026-04-04"
---

# Phase 01 Plan 04: Chat Schema Summary

**Supabase migration 011 applied — chat_sessions and chat_messages tables live with org-scoped RLS and TypeScript types wired**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-04-04T00:00:00Z
- **Completed:** 2026-04-04T00:12:00Z
- **Tasks:** 3 (1 auto, 1 human-verify executed automatically, 1 auto)
- **Files modified:** 2

## Accomplishments
- Created migration 011_chat_schema.sql with both chat tables, 5 indexes, and authenticated-only RLS policies
- Applied migration to remote Supabase via `npx supabase db push`
- Added TypeScript Row/Insert/Update types for chat_sessions and chat_messages to database.ts
- Build passes clean — no TypeScript errors

## Task Commits

Each task was committed atomically:

1. **Task 1: Create migration 011_chat_schema.sql** - `37cab04` (feat)
2. **Task 3: Add TypeScript types for chat tables to database.ts** - `a151d6e` (feat)

**Plan metadata:** (docs commit below)

## Files Created/Modified
- `supabase/migrations/011_chat_schema.sql` - chat_sessions + chat_messages schema with RLS and indexes
- `src/types/database.ts` - Added chat_sessions and chat_messages type definitions

## Decisions Made
- No anon-role RLS policy created — the public chat API (Phase 2) writes via `createServiceRoleClient()` which bypasses RLS server-side. This avoids the multi-tenant data leak risk of anon policies where `get_current_org_id()` returns NULL.
- `organization_id` denormalized on `chat_messages` so the RLS policy can filter by org without a JOIN to `chat_sessions`.
- `last_active_at` index added (`idx_chat_sessions_last_active`) in preparation for Phase 3 session freshness queries.

## Deviations from Plan

None - plan executed exactly as written.

The Task 2 checkpoint (`npx supabase db push`) ran successfully in the automated context — the CLI prompted and applied the migration cleanly.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required beyond the migration push that was applied automatically.

## Next Phase Readiness
- `chat_sessions` and `chat_messages` tables exist in Supabase with correct schema and RLS
- TypeScript types are ready for Phase 2 chat API route handlers
- Phase 2 must use `createServiceRoleClient()` for all writes to these tables
- Phase 3 can use `last_active_at` for session freshness checks (index exists)

## Self-Check: PASSED

- FOUND: supabase/migrations/011_chat_schema.sql
- FOUND: src/types/database.ts
- FOUND: .planning/phases/01-foundation/01-04-SUMMARY.md
- FOUND: commit 37cab04
- FOUND: commit a151d6e

---
*Phase: 01-foundation*
*Completed: 2026-04-04*

---
phase: 12-multi-channel-inbox-ui
plan: "01"
subsystem: chat-inbox
tags: [schema, types, api, tdd, multi-channel]
dependency_graph:
  requires:
    - supabase/migrations/020_conversations_channel.sql
    - supabase/migrations/022_conversation_inbound_at.sql
    - src/types/database.ts (pre-existing conversations block)
  provides:
    - supabase/migrations/023_conversations_bot_status.sql
    - bot_status column in conversations table
    - Updated ConversationSummary type with channel, channelMetadata, botStatus, channelAccountName
    - Extended GET /api/chat/conversations with channel+meta_channels enrichment
    - 5 RED test stubs defining Wave 1 UI contracts
  affects:
    - src/app/api/chat/conversations/[id]/route.ts (auto-fixed to match new type)
    - Wave 1 (12-02) depends on all artifacts from this plan
tech_stack:
  added: []
  patterns:
    - Secondary Supabase query to join meta_channels.page_name for channel display names
    - RED test stub pattern using throw new Error('not yet implemented') for contract-first TDD
key_files:
  created:
    - supabase/migrations/023_conversations_bot_status.sql
    - tests/meta-inbox-channel-icons.test.ts
    - tests/meta-inbox-filter.test.ts
    - tests/meta-inbox-header.test.ts
    - tests/meta-inbox-24h-banner.test.ts
    - tests/meta-inbox-bot-toggle.test.ts
  modified:
    - src/types/database.ts
    - src/types/chat.ts
    - src/app/api/chat/conversations/route.ts
    - src/app/api/chat/conversations/[id]/route.ts
decisions:
  - bot_status column uses TEXT + CHECK constraint ('active'|'paused') rather than a boolean, matching the existing channel field pattern and leaving room for future states
  - Secondary meta_channels query is issued only when non-widget conversations exist, avoiding unnecessary DB round-trips for widget-only orgs
  - channelAccountName falls back to page_id when page_name is null, ensuring a non-empty display value for all Meta conversations
metrics:
  duration_seconds: 278
  completed_date: "2026-05-04"
  tasks_completed: 3
  tasks_total: 3
  files_created: 7
  files_modified: 4
---

# Phase 12 Plan 01: Schema Foundation + RED Test Stubs Summary

**One-liner:** Added bot_status column via migration 023, extended ConversationSummary with four multi-channel fields, enriched conversations API with meta_channels page-name lookup, and wrote 29 RED contract tests for Wave 1 UI work.

## What Was Built

**Migration 023** adds `bot_status TEXT NOT NULL DEFAULT 'active'` with a CHECK constraint to the `conversations` table. Applied to production via `npx supabase db push`.

**database.ts** gains `bot_status: string` in the conversations Row block, `bot_status?: string` in Insert and Update, reflecting the new column.

**ConversationSummary** (`src/types/chat.ts`) gains four new required/optional fields:
- `channel: string` — 'widget' | 'messenger' | 'instagram'
- `channelMetadata: Record<string, string>` — raw channel_metadata JSON
- `botStatus: string` — 'active' | 'paused'
- `channelAccountName?: string | null` — page_name from meta_channels

**GET /api/chat/conversations** extended SELECT includes `channel, channel_metadata, bot_status`. A secondary `meta_channels` query resolves `page_name` for all unique `page_id` values from non-widget conversations, building a `pageNameMap` used in the map() call.

**5 RED test stubs** define the Wave 1 UI contracts across METAINBOX-01, -02, -04, -05, -06. All 29 tests fail with "not yet implemented" messages and zero import errors, confirming the type system is valid.

## Commits

| Task | Commit | Description |
|------|--------|-------------|
| Task 1 | cdd43da | feat(12-01): add bot_status column + database.ts types |
| Task 2 | e567334 | feat(12-01): extend ConversationSummary type + enrich conversations API |
| Task 3 | 4490a6d | test(12-01): add RED stubs for multi-channel inbox contracts |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed [id] route to satisfy new ConversationSummary shape**
- **Found during:** Task 2
- **Issue:** `src/app/api/chat/conversations/[id]/route.ts` also constructs a `ConversationSummary` object. After adding required fields `channel`, `channelMetadata`, and `botStatus` to the interface, the [id] route would have failed TypeScript compilation.
- **Fix:** Extended the [id] route SELECT to include `channel, channel_metadata, bot_status` and updated the constructed object to populate all new required fields (channelAccountName is null since no secondary query is done per-conversation).
- **Files modified:** `src/app/api/chat/conversations/[id]/route.ts`
- **Commit:** e567334

## Known Stubs

None — all data flows are wired. The `channelAccountName` field returns `null` for widget conversations (by design, not a stub).

## Self-Check: PASSED

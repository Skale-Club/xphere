---
phase: 124-messages-templates-data-model-crud
plan: 01
subsystem: database
tags: [supabase, postgres, rls, server-actions, typescript]

# Dependency graph
requires:
  - phase: 114-billing-robustness (universal folders, migration 1225)
    provides: update_updated_at() trigger function convention (not moddatetime)
provides:
  - "message_templates table (migration 1233): org-scoped, RLS-protected, name/body/channel_overrides"
  - "Hand-written TypeScript Row/Insert/Update/Relationships types for message_templates in database.ts"
  - "Server action CRUD surface: listMessageTemplates, getMessageTemplate, createMessageTemplate, updateMessageTemplate, deleteMessageTemplate"
affects: [124-02-messages-templates-ui, 125-messages-preview-templates-nav-finalization]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lean, folder-less, status-free tenant table for a quick-reply template type (contrast with email_templates' builder-heavy shape)"
    - "channel_overrides as flexible JSONB (sms/email/whatsapp optional keys) instead of fixed columns, for future channel additions with zero migration"

key-files:
  created:
    - supabase/migrations/1233_message_templates.sql
    - src/app/(dashboard)/settings/message-templates/_actions/message-templates.ts
  modified:
    - src/types/database.ts

key-decisions:
  - "message_templates stays lean (id/org_id/name/body/channel_overrides/created_by/created_at/updated_at) — explicitly no folder_id/position/status/document/html_snapshot, since this template type has no approval workflow or folder hierarchy in this milestone"
  - "channel_overrides keys are exactly sms/email/whatsapp (lowercase), matching the existing campaigns.channel CHECK constraint values minus 'calls'"
  - "Migration file is a code deliverable only — not applied to the remote DB in this plan, per CLAUDE.md sensitive-paths guidance and the project's current pending-migrations backlog"

patterns-established:
  - "Pattern: org_id on insert sourced only from get_current_org_id() RPC result, never client-supplied input; reads rely entirely on RLS (no manual .eq('org_id', ...) filter)"

requirements-completed: [MSG-01, MSG-02, MSG-03, MSG-04]

# Metrics
duration: 28min
completed: 2026-07-03
---

# Phase 124 Plan 01: Messages Templates Data Model + CRUD Summary

**New org-scoped `message_templates` Postgres table (migration 1233) with RLS via `get_current_org_id()`, hand-written TypeScript types, and a 5-function server-action CRUD surface following the existing `email_templates/actions.ts` `ActionResult<T>` convention.**

## Performance

- **Duration:** 28 min (includes ~3 min polling for a concurrent build lock held by the parallel Phase 123 executor sharing the same `.next` build directory)
- **Started:** 2026-07-03T01:46:00Z
- **Completed:** 2026-07-03T02:14:13Z
- **Tasks:** 3 completed
- **Files modified:** 3 (1 new migration, 1 new server-actions module, 1 additive edit to database.ts)

## Accomplishments
- `message_templates` table exists with RLS policy scoped to `org_id = get_current_org_id()`, an `org_id, created_at desc` index, and the `update_updated_at()` trigger (not `moddatetime`, matching prod reality)
- `database.ts` Tables union extended with a matching Row/Insert/Update/Relationships block, inserted immediately after the `folders` block, verified with a full `npm run build`
- Full CRUD server-action surface (`listMessageTemplates`, `getMessageTemplate`, `createMessageTemplate`, `updateMessageTemplate`, `deleteMessageTemplate`) ready for the 124-02 UI plan to consume directly

## Task Commits

Each task was committed atomically:

1. **Task 1: Write migration 1233 for message_templates table** - `64a5090e` (feat)
2. **Task 2: Add message_templates TypeScript types to database.ts** - `ae428558` (feat)
3. **Task 3: Create message-templates server actions** - `548b68c6` (feat)

**Plan metadata:** (this commit) `docs: complete 124-01 plan`

_Note: Task 3 was flagged `tdd="true"` in the plan frontmatter, but the plan's own `<action>` block specified the exact implementation to write with no separate red/green test-file step defined in `<behavior>`/`<action>`; the plan's `<verify>` for Task 3 was `npm run build` (type-check), not a test-runner command. Implemented as specified in a single commit, consistent with the plan's concrete `<action>` code block and verification command._

## Files Created/Modified
- `supabase/migrations/1233_message_templates.sql` - New table, RLS policy, index, updated_at trigger; not applied to remote DB
- `src/types/database.ts` - Added `message_templates` Row/Insert/Update/Relationships block (additive only, 41 lines)
- `src/app/(dashboard)/settings/message-templates/_actions/message-templates.ts` - 5 server actions (list/get/create/update/delete) with `ChannelOverrides`/`MessageTemplateRow`/`MessageTemplateInput` types

## Decisions Made
- Kept the table lean per CONTEXT.md explicit instruction — no folder/status/position/document fields, since Messages templates have no approval workflow and no folder hierarchy this milestone
- `channel_overrides` uses flexible JSONB with `sms`/`email`/`whatsapp` optional keys rather than fixed columns, mirroring `campaigns.template_config`'s pattern and allowing future channels (e.g., push) with zero migration
- Did not run `npx supabase db push` — migration file is a deliverable only, consistent with explicit run instructions and CLAUDE.md's sensitive-paths guidance on `supabase/migrations/`

## Deviations from Plan

None - plan executed exactly as written. The exact DDL, TypeScript block, and server-action code specified in the plan's `<action>` blocks were used verbatim (only cosmetic whitespace matched the plan's own formatting).

## Issues Encountered
- A parallel executor agent (Phase 123, editing WhatsApp templates/settings-sub-nav files) held the shared Next.js `.next/lock` file twice while running its own `npm run build` concurrently in the same working directory, causing this plan's build verification to transiently fail with `Type error: File '.../admin/activity/page.ts' not found` and `Another next build process is already running.` Both were confirmed as build-directory races (not code errors) by polling for lock release and re-running; the final `npm run build` for each of Tasks 2 and 3 exited 0 with no type errors attributable to this plan's changes.

## User Setup Required

None - no external service configuration required. The migration must still be applied to the remote database by the operator (via `npx supabase db push` or the Supabase Management API) before the `message_templates` table actually exists in production — this was intentionally not done as part of this plan per explicit run instructions.

## Next Phase Readiness
- Plan 124-02 (Messages Templates UI: list/create/edit pages) can import `listMessageTemplates`, `getMessageTemplate`, `createMessageTemplate`, `updateMessageTemplate`, `deleteMessageTemplate` directly from `src/app/(dashboard)/settings/message-templates/_actions/message-templates.ts`
- Blocker/concern for the operator: migration 1233 is code-complete but NOT yet applied to the remote Supabase database — the table does not exist in production until `npx supabase db push` (or equivalent) is run. UI built on top of these actions will fail at runtime against prod until that migration is applied.

---
*Phase: 124-messages-templates-data-model-crud*
*Completed: 2026-07-03*

## Self-Check: PASSED

- FOUND: supabase/migrations/1233_message_templates.sql
- FOUND: src/app/(dashboard)/settings/message-templates/_actions/message-templates.ts
- FOUND: src/types/database.ts
- FOUND commit: 64a5090e
- FOUND commit: ae428558
- FOUND commit: 548b68c6

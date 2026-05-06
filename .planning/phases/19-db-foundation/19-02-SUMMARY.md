---
phase: 19-db-foundation
plan: 02
subsystem: database
tags: [typescript, supabase, tool-folders, server-actions, database-types]

# Dependency graph
requires:
  - phase: 19-01
    provides: migration 025_tool_folders.sql committed (tool_folders table, folder_id FK, dropped folder/tool_folder_order columns)
provides:
  - tool_folders TypeScript table type in database.ts (Row/Insert/Update/Relationships)
  - tool_configs.folder_id (UUID FK) replacing folder (string) in database.ts
  - organizations without tool_folder_order in database.ts
  - getFolders() server action returning ToolFolder[] ordered by position
  - createFolder(), updateFolder(), deleteFolder() server actions for CRUD
  - getFolderOrder() and saveFolderOrder() removed from actions.ts
  - createToolConfig/updateToolConfig updated to use folder_id (UUID) not folder (string)
affects: [19-03, tools-table.tsx, tool-config-form.tsx, tools/page.tsx]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ToolFolder type derived from Database['public']['Tables']['tool_folders']['Row']"
    - "getFolders() replaces getFolderOrder() — returns typed array ordered by position INT"
    - "folder_id UUID FK replaces folder TEXT on tool_configs mutations"

key-files:
  created: []
  modified:
    - src/types/database.ts
    - src/app/(dashboard)/tools/actions.ts

key-decisions:
  - "ToolFolder type defined inline in actions.ts (not imported from database.ts) for ergonomic server-action exports"
  - "createFolder sets position: 0 by default — reorder UI is Phase 20/21 concern"

patterns-established:
  - "Folder CRUD actions follow: getUser() auth gate + createClient() + rpc('get_current_org_id') for org scope + revalidatePath('/tools')"

requirements-completed: []

# Metrics
duration: 15min
completed: 2026-05-06
---

# Phase 19 Plan 02: TypeScript Types + Server Actions Summary

**database.ts updated with tool_folders table type and folder_id FK; actions.ts exports getFolders/createFolder/updateFolder/deleteFolder replacing getFolderOrder/saveFolderOrder**

## Performance

- **Duration:** ~15 min
- **Started:** 2026-05-06T14:30:00Z
- **Completed:** 2026-05-06T14:45:00Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Updated `database.ts`: removed `tool_folder_order` from organizations, replaced `folder: string | null` with `folder_id: string | null` in tool_configs, added `tool_configs_folder_id_fkey` relationship, added complete `tool_folders` table definition
- Rewrote `actions.ts`: exported `ToolFolder` type, `getFolders()`, `createFolder()`, `updateFolder()`, `deleteFolder()`; removed `getFolderOrder()` and `saveFolderOrder()`; updated `createToolConfig`/`updateToolConfig` to use `folder_id`
- Build errors are only in caller files (tools-table.tsx, page.tsx) — exactly as expected; actions.ts and database.ts have no TypeScript errors

## Task Commits

1. **Task 1: Update src/types/database.ts for new schema** - `f7d0f3f` (feat)
2. **Task 2: Rewrite server actions for relational folder model** - `80ad2af` (feat)

## Files Created/Modified
- `src/types/database.ts` - Added tool_folders table type, replaced folder with folder_id in tool_configs, removed tool_folder_order from organizations
- `src/app/(dashboard)/tools/actions.ts` - Added ToolFolder type and 4 folder CRUD actions, removed legacy folder order actions, updated tool mutations to use folder_id

## Decisions Made
- `ToolFolder` type defined directly in actions.ts rather than imported from database.ts — ergonomic for server action consumers
- `createFolder` sets `position: 0` as default — explicit reorder support is Plan 20/21 scope

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Build errors in caller files (tools-table.tsx, page.tsx) are expected and documented in the plan — they reference the removed `getFolderOrder`/`saveFolderOrder` exports and will be fixed in Plan 19-03.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 19-03 can now update the UI caller files (tools-table.tsx, tool-config-form.tsx, page.tsx) to consume the new folder_id and getFolders API
- All type contracts are stable: ToolFolder shape, getFolders return, createFolder/updateFolder/deleteFolder signatures

---
*Phase: 19-db-foundation*
*Completed: 2026-05-06*

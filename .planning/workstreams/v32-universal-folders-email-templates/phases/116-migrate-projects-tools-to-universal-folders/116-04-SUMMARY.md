---
phase: 116-migrate-projects-tools-to-universal-folders
plan: 04
subsystem: database
tags: [foldering, tools, tool-folders, supabase, server-actions, agents]

# Dependency graph
requires:
  - phase: 116-01
    provides: "FolderingContext contract (tools use default folder_id path)"
  - phase: 114-02
    provides: "src/lib/foldering/core.ts shared foldering core"
  - phase: 116-02
    provides: "migration 1227 (file) copying tool_folders -> folders, repointing tool_configs.folder_id FK"
provides:
  - "Tool folder actions in workflows/actions.ts delegate to the foldering core (entity_type='tool') while preserving legacy return shapes"
  - "agent tool-picker reads tool folders from folders(entity_type='tool')"
affects: [117-email-templates, phase-116-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Foldering-core delegation with a toLegacy() adapter mapping ActionResult<T> back to the bare-array / {error?}|void shapes the tools UI expects"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/workflows/actions.ts"
    - "src/app/(dashboard)/agents/_actions/tools.ts"

key-decisions:
  - "Tool folder actions delegate to core but ADAPT results back to legacy shapes (getFolders -> bare ToolFolder[]; mutations -> {error?}|void) so tools-table.tsx / inline-tool-name.tsx compile unchanged — different from 116-03 which keeps ActionResult"
  - "itemTable is '_legacy_tool_configs' (the tools-config table this module actually uses); default itemFolderColumn 'folder_id' matches tool_configs.folder_id"
  - "deleteFolder/deleteFolderWithTools/updateFolder(position) hit folders directly (scoped entity_type='tool') to preserve exact prior hard-delete/positional behavior; create/reorder/rename go through the core"
  - "moveToolToFolder keeps its direct _legacy_tool_configs.folder_id update (item column unchanged by the migration)"

patterns-established:
  - "toLegacy(res) adapter: return { error: res.error } on failure, undefined on success — bridges core ActionResult to legacy consumer contract"

requirements-completed: [UFE-05]

# Metrics
duration: 8min
completed: 2026-07-02
---

# Phase 116 Plan 04: Tools Code Swap to Universal Folders Summary

**Tools folder module repointed off `tool_folders` onto `folders(entity_type='tool')` — the seven folder actions in `workflows/actions.ts` delegate to the foldering core (or hit `folders` directly) while a `toLegacy()` adapter preserves the legacy bare-array / `{error?}|void` return shapes, and the agent tool-picker reads `folders(entity_type='tool')`.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-02T16:18:17Z
- **Completed:** 2026-07-02T16:26:29Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- Added a tool `FolderingContext` (`entity_type='tool'`, `itemTable='_legacy_tool_configs'`) plus a `toLegacy()` adapter to `workflows/actions.ts`.
- Rewrote all seven tool-folder functions: `getFolders` (core.listFolders → bare `ToolFolder[]`), `createFolder`/`reorderFolders` (core, adapted via `toLegacy`), `updateFolder` (name → core.renameFolder, position → direct `folders` update), `deleteFolder`/`deleteFolderWithTools` (direct `folders` delete scoped `entity_type='tool'`). `moveToolToFolder` kept its direct `_legacy_tool_configs.folder_id` update. `ToolFolder` type + all signatures preserved.
- Swapped the agent tool-picker (`agents/_actions/tools.ts`): `ToolPickerData.folders` type `tool_folders` Row → `folders` Row, and the query to `folders(entity_type='tool')`. `_legacy_tool_configs` query + `setAgentTools` untouched.
- Left `getToolConfigs`/`renameToolConfig`/`deleteToolConfig` and the `ToolConfigWithIntegration` type unchanged.

## Task Commits

Each task was committed atomically:

1. **Task 1: Delegate tool-folder actions to the foldering core (legacy shapes preserved)** - `6ef4d8bf` (feat)
2. **Task 2: Swap agent tool-picker folder query to folders** - `9ee2079c` (feat)

**Plan metadata:** committed with the final metadata commit (docs: complete 116-03 + 116-04).

## Files Created/Modified
- `src/app/(dashboard)/workflows/actions.ts` - Seven tool-folder actions now use `folders(entity_type='tool')` via core delegation + direct queries; `toLegacy()` adapter added; legacy shapes preserved.
- `src/app/(dashboard)/agents/_actions/tools.ts` - Tool-picker reads `folders(entity_type='tool')` with the `folders` Row type.

## Decisions Made
- **Return-shape adaptation (the critical contract):** The tools consumers (`tools-table.tsx`, `inline-tool-name.tsx`) expect LEGACY shapes — `getFolders()` returns a bare `ToolFolder[]`; the six mutations return `{ error?: string } | void` and are branched on `result?.error`. The core returns `ActionResult<T>`. I added a `toLegacy(res)` helper that returns `{ error: res.error }` on failure and `undefined` on success, and mapped `getFolders` via `res.ok ? res.data as unknown as ToolFolder[] : []`. This keeps both components unchanged. This is the deliberate difference from 116-03, where ActionResult is kept.
- Kept `deleteFolder`/`deleteFolderWithTools`/`updateFolder(position)` as direct `folders` queries (not core delegation) to preserve exact prior behavior — the old code hard-deleted the folder row (no soft-delete/`deleted_at`) and updated a single position; the core's delete path soft-deletes items and is heavier than needed here.

## Deviations from Plan

None - plan executed exactly as written. The return-shape adaptation described above was explicitly specified by the plan (`toLegacy` adapter + bare-array `getFolders`), so it is a planned behavior, not a deviation.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required at code level. NOTE: migration 1227 (from plan 116-02) is written as a FILE but NOT applied; it MUST run (after 1226) before this code deploys, or the Tools sidebar / agent tool-picker will show no folders. See PENDING-MIGRATIONS.md.

## Next Phase Readiness
- Tools module fully on `folders`; combined with 116-03 (Projects), all phase 116 code swaps are complete.
- Verification bar met: `npm run build` exits 0; `grep -rn "tool_folders" src/` reduces to only the generated `database.ts` type blocks.

## Self-Check: PASSED

- Files verified present: workflows/actions.ts, agents/_actions/tools.ts, 116-04-SUMMARY.md.
- Commits verified: `6ef4d8bf` (Task 1), `9ee2079c` (Task 2).
- `grep -rn "tool_folders" src/` → only `src/types/database.ts` (generated type blocks).
- `npm run build` exits 0.

---
*Phase: 116-migrate-projects-tools-to-universal-folders*
*Completed: 2026-07-02*

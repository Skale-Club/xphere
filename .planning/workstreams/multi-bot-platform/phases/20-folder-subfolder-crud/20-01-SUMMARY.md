---
phase: 20-folder-subfolder-crud
plan: 01
subsystem: ui
tags: [typescript, react, tools-ui, folder-model, server-actions, shadcn-select]

# Dependency graph
requires:
  - phase: 19-03
    provides: tool-config-form.tsx with folder_id schema stub and existingFolders:ToolFolder[] prop; actions.ts with deleteFolder() and ToolFolder type
provides:
  - deleteFolderWithTools(id) server action in actions.ts — deletes tool_configs in folder+subfolders, then deletes folder row
  - Folder Select FormField in tool-config-form.tsx — hierarchical folder picker with '__none__' sentinel for null
  - deleteFolderWithTools test stub describe block in tests/tools/actions.test.ts
affects: [20-02, 20-03, tools-table.tsx, tool-config-form.tsx]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Sentinel '__none__' for Radix Select null state — zod schema uses z.string() (not .uuid()); onSubmit converts '__none__' back to null"
    - "deleteFolderWithTools collects subfolder IDs in one query then batch-deletes tool_configs with .in('folder_id', folderIds)"
    - "Fragment used to render parent folder + indented subfolders in a flat SelectContent list"

key-files:
  created:
    - tests/tools/actions.test.ts (describe block added)
  modified:
    - src/app/(dashboard)/tools/actions.ts
    - src/components/tools/tool-config-form.tsx

key-decisions:
  - "Separate deleteFolderWithTools action (not a parameter on deleteFolder) — each action has one clear purpose"
  - "Sentinel '__none__' used instead of null for Radix Select empty state — Radix Select does not accept null values"
  - "Subfolder lookup is 1-level only (no recursion) — product enforces max 2 levels"

patterns-established:
  - "Folder Select pattern: z.string().optional().nullable() schema + '__none__' defaultValue + sentinel-to-null conversion in onSubmit"
  - "deleteFolderWithTools: collect child IDs first, batch delete tool_configs, then delete parent folder (DB cascade handles subfolder rows)"

requirements-completed:
  - FOLDER-03
  - SUBFOLDER-03
  - DISPLAY-01
  - DISPLAY-02

# Metrics
duration: 4min
completed: 2026-05-06
---

# Phase 20 Plan 01: deleteFolderWithTools action + Folder Select UI Summary

**`deleteFolderWithTools` server action added to actions.ts; folder Select FormField with hierarchical options wired into tool-config-form.tsx using '__none__' sentinel for null state**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-05-06T16:00:46Z
- **Completed:** 2026-05-06T16:04:46Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- Added `deleteFolderWithTools(id)` to `actions.ts` — collects subfolder IDs in one query, batch-deletes tool_configs with `.in('folder_id', folderIds)`, then deletes the folder row (DB cascade removes subfolder rows automatically)
- Added `describe('deleteFolderWithTools: ...')` stub block with 7 todo cases to `tests/tools/actions.test.ts`
- Added folder Select `<FormField>` to `tool-config-form.tsx` with hierarchical display (top-level folders + indented subfolders), sentinel `'__none__'` for null state, and correct sentinel-to-null conversion in `onSubmit`
- Updated `folder_id` zod schema from `z.string().uuid()` to `z.string()` to allow the `'__none__'` sentinel
- `npm run build` exits 0; `npx vitest run tests/tools/actions.test.ts` exits 0 (24 todo stubs, 0 failures)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add deleteFolderWithTools to actions.ts + test stub** - `fe9056b` (feat)
2. **Task 2: Add folder Select FormField to tool-config-form.tsx** - `d743566` (feat)

## Files Created/Modified
- `src/app/(dashboard)/tools/actions.ts` - Added `deleteFolderWithTools(id)` export after `deleteFolder`
- `src/components/tools/tool-config-form.tsx` - Added Fragment import, updated folder_id schema/defaultValues/payload, replaced Phase 20 placeholder comment with full folder Select FormField JSX
- `tests/tools/actions.test.ts` - Added `deleteFolderWithTools` describe block with 7 todo test stubs

## Decisions Made
- Separate `deleteFolderWithTools` action rather than a parameter on `deleteFolder` — clearer single-purpose API; the delete modal handler decides which to call
- Sentinel `'__none__'` for Radix Select null state — Radix Select does not accept null/undefined as value; `'__none__'` is converted back to null before the DB payload is sent
- 1-level subfolder lookup (no recursion) — the product enforces max 2 levels (folder > subfolder), making one `.eq('parent_id', id)` query sufficient

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None. Both tasks completed without errors. Build and tests passed on first attempt.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Plan 20-02 can now wire `handleAddFolder` in tools-table.tsx to `createFolder()`, add inline rename, subfolder rendering, and collapse toggle
- Plan 20-03 can wire the folder delete modal to `deleteFolder()` and `deleteFolderWithTools()` using the now-complete server actions
- `tool-config-form.tsx` stub resolved — tools can now be assigned to folders via the Select UI

---
*Phase: 20-folder-subfolder-crud*
*Completed: 2026-05-06*

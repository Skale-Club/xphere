---
phase: 116-migrate-projects-tools-to-universal-folders
plan: 03
subsystem: database
tags: [foldering, projects, spaces, supabase, mcp, server-actions]

# Dependency graph
requires:
  - phase: 116-01
    provides: "itemFolderColumn on FolderingContext (projects override 'space_id')"
  - phase: 114-02
    provides: "src/lib/foldering/core.ts shared foldering core"
  - phase: 116-02
    provides: "migration 1227 (file) copying project_spaces -> folders, repointing projects.space_id FK"
provides:
  - "projects/_actions/spaces.ts delegates space CRUD to the foldering core (entity_type='project', itemFolderColumn='space_id')"
  - "projects MCP tool validates/creates spaces against folders(entity_type='project')"
  - "projects layout renders spaces from folders via listSpaces() (no code change needed)"
affects: [117-email-templates, phase-116-verification]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-module 'use server' wrapper over foldering core, preserving legacy ActionResult<ProjectSpaceRow> export shapes"
    - "Bespoke archive/delete cascade against projects.space_id, folder reads from folders(entity_type='project')"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/projects/_actions/spaces.ts"
    - "src/lib/mcp/tools/projects.ts"

key-decisions:
  - "listSpaces/createSpace/renameSpace/updateSpaceMeta/reorderSpaces/moveSpace delegate to the core; archiveSpace/deleteSpace stay bespoke because the core cascade hardcodes 'folder_id' which does not match projects.space_id"
  - "spaces.ts return type kept as ProjectSpaceRow via `as unknown as` cast (folders Row is a structural superset) so ProjectSubNav/new-space-button/layout are untouched"
  - "MCP tool name project_spaces_create preserved (spec contract); only its internal table swapped to folders + entity_type:'project'"

patterns-established:
  - "Projects wrapper mirrors the Phase 115 workflow wrapper but passes itemFolderColumn:'space_id' and revalidatePath('/projects')"

requirements-completed: [UFE-04]

# Metrics
duration: 8min
completed: 2026-07-02
---

# Phase 116 Plan 03: Projects Code Swap to Universal Folders Summary

**Projects spaces module repointed off `project_spaces` onto `folders(entity_type='project')` — spaces.ts delegates to the foldering core with `itemFolderColumn:'space_id'`, the MCP tool validates/creates against `folders`, all export names/shapes preserved so the sub-nav is untouched.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-07-02T16:18:17Z
- **Completed:** 2026-07-02T16:26:29Z
- **Tasks:** 3 (Task 3 was a no-op guard/confirmation)
- **Files modified:** 2

## Accomplishments
- Rewrote `projects/_actions/spaces.ts` as thin `'use server'` delegations to `@/lib/foldering/core` bound to `{ entityType:'project', itemTable:'projects', itemFolderColumn:'space_id' }`; all 8 exports and their `ActionResult<ProjectSpaceRow>` shapes preserved.
- Kept `archiveSpace`/`deleteSpace` bespoke (the core cascade hardcodes `folder_id`) but swapped their folder-table reads/deletes from `project_spaces` to `folders(entity_type='project')` while preserving the `projects.space_id` cascade verbatim.
- Swapped the three `.from('project_spaces')` queries in `src/lib/mcp/tools/projects.ts` (space-exists check, parent check, space INSERT) to `folders` scoped by `entity_type='project'` (INSERT adds `entity_type:'project'`); MCP tool name `project_spaces_create` and the `projects.space_id` insert unchanged.
- Confirmed `projects/layout.tsx` already sources spaces via `listSpaces()` with `group_id: p.space_id` — no edit needed (Task 3 guard passed).

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite projects/_actions/spaces.ts as core delegations** - `ca8db3d4` (feat)
2. **Task 2: Swap projects MCP tool queries to folders** - `d4fa54ac` (feat)
3. **Task 3: Confirm layout sources spaces via listSpaces** - no-op guard (no code change; verified in read)

**Plan metadata:** committed with the final metadata commit (docs: complete 116-03 + 116-04).

## Files Created/Modified
- `src/app/(dashboard)/projects/_actions/spaces.ts` - Space CRUD now delegates to the foldering core (itemFolderColumn='space_id'); archive/delete keep projects.space_id cascades reading folder rows from `folders(entity_type='project')`.
- `src/lib/mcp/tools/projects.ts` - `projects_create` space check + `project_spaces_create` parent check/INSERT now use `folders(entity_type='project')`.

## Decisions Made
- Did NOT delegate `archiveSpace`/`deleteSpace` to `core.archiveFolder`/`core.deleteFolder`: those cascade items via a hardcoded `.in('folder_id', ...)`, which does not match the projects item column `space_id`. Kept the bespoke bodies and only swapped folder-table reads to `folders`.
- Returned folder rows cast to `ProjectSpaceRow` (`as unknown as`) because the `folders` Row is a structural superset — keeps consumer types stable with zero component changes.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None - no external service configuration required at code level. NOTE: migration 1227 (from plan 116-02) is written as a FILE but NOT applied; it MUST run (after 1226) before this code deploys, or the Projects sidebar will show no spaces. See PENDING-MIGRATIONS.md.

## Next Phase Readiness
- Projects module fully on `folders`; combined with 116-04 (Tools), phase 116 code swaps are complete.
- Verification bar met: `npm run build` exits 0; `grep -rn "project_spaces" src/` reduces to only the generated `database.ts` types plus the intentional MCP tool name and a code comment.

## Self-Check: PASSED

- Files verified present: spaces.ts, mcp/tools/projects.ts, 116-03-SUMMARY.md.
- Commits verified: `ca8db3d4` (Task 1), `d4fa54ac` (Task 2).
- `grep -rn "project_spaces" src/` → only `src/types/database.ts` (generated), the MCP tool name `project_spaces_create`, and a code comment in spaces.ts (all intentional).
- `npm run build` exits 0.

---
*Phase: 116-migrate-projects-tools-to-universal-folders*
*Completed: 2026-07-02*

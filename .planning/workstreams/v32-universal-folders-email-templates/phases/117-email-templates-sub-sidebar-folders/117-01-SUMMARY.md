---
phase: 117-email-templates-sub-sidebar-folders
plan: 01
subsystem: database
tags: [supabase, postgres, email-templates, folders, foldering-core, next]

# Dependency graph
requires:
  - phase: 114-universal-folders
    provides: "public.folders universal store + src/lib/foldering/core.ts (generic CRUD/move/reorder)"
provides:
  - "Migration 1228: email_templates.folder_id (FK -> folders, ON DELETE SET NULL) + position + index (committed, NOT applied)"
  - "PENDING-MIGRATIONS.md entry #4 for 1228 (Phase 117 / UFE-06)"
  - "email_templates Row/Insert/Update type carries folder_id + position (database.ts)"
  - "src/app/(dashboard)/email-templates/_actions/folders.ts — core-delegating 'use server' foldering module bound to entity_type='email_template'"
  - "listTemplates() selects folder_id + position; EmailTemplateBuilderRow carries them"
affects: [117-02, email-templates-ui, universal-folders]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-entity 'use server' foldering wrapper delegating to @/lib/foldering/core (mirrors workflows/_actions/folders.ts)"

key-files:
  created:
    - supabase/migrations/1228_email_templates_folders.sql
    - src/app/(dashboard)/email-templates/_actions/folders.ts
  modified:
    - src/types/database.ts
    - src/app/(dashboard)/email-templates/actions.ts
    - .planning/workstreams/v32-universal-folders-email-templates/PENDING-MIGRATIONS.md

key-decisions:
  - "revalidatePath('/settings/email-templates') is the canonical revalidate target (not /email-templates), matching Plan 02 routing"
  - "No lifecycle columns added to email_templates (archive/deleteFolder cascade paths are cast to any in core and not exercised in greenfield)"

patterns-established:
  - "Email-template foldering actions expose the full TreeNavActions surface + list/create + moveTemplateToFolder/reorderTemplatesInFolder"

requirements-completed: [UFE-06]

# Metrics
duration: 6min
completed: 2026-07-02
---

# Phase 117 Plan 01: Email Templates Foldering Backend Summary

**email_templates gains folder_id/position (migration 1228 + generated types) and a core-delegating email-template foldering action module (entity_type='email_template') ready for the Wave-2 sub-sidebar.**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-07-02T16:39:16Z
- **Completed:** 2026-07-02T16:45:00Z
- **Tasks:** 4
- **Files modified:** 5 (2 created, 3 modified)

## Accomplishments
- Migration `1228_email_templates_folders.sql` written (additive `folder_id` FK + `position` + index) — CODE-ONLY, not applied; PENDING ledger updated with a Phase 117 / UFE-06 entry.
- `email_templates` type in `database.ts` carries `folder_id` + `position` on Row/Insert/Update plus a `folders` FK relationship, so folder-aware queries type-check.
- New `email-templates/_actions/folders.ts` — thin `'use server'` wrappers over `@/lib/foldering/core`, bound to `entity_type='email_template'` / `itemTable='email_templates'`, exposing the full folder surface + `moveTemplateToFolder` / `reorderTemplatesInFolder`.
- `listTemplates()` now selects `folder_id` + `position`; `EmailTemplateBuilderRow` carries them.
- `npm run build` exits 0.

## Task Commits

1. **Task 1: Migration 1228 + PENDING ledger** - `52da96e8` (feat)
2. **Task 2: folder_id + position on email_templates type** - `51449008` (feat)
3. **Task 3: email-template folder actions + listTemplates select** - `0b8ccb6b` (feat)
4. **Task 4: production build type-check** - verification only (no commit; build green)

## Files Created/Modified
- `supabase/migrations/1228_email_templates_folders.sql` - Additive `folder_id`/`position`/index (NOT applied).
- `.planning/.../PENDING-MIGRATIONS.md` - Entry #4 for 1228 (apply after 1225, before deploy; LOW risk).
- `src/types/database.ts` - `folder_id`/`position` on `email_templates` Row/Insert/Update + `email_templates_folder_id_fkey`.
- `src/app/(dashboard)/email-templates/_actions/folders.ts` - Core-delegating foldering module (see exports below).
- `src/app/(dashboard)/email-templates/actions.ts` - `listTemplates()` selects `folder_id, position`; `EmailTemplateBuilderRow` extended.

## Exact Action Exports (for Plan 02 imports)

From `@/app/(dashboard)/email-templates/_actions/folders`:
`listFolders`, `createFolder`, `renameFolder`, `updateFolderMeta`, `reorderFolders`, `moveFolder`, `archiveFolder`, `deleteFolder`, `moveTemplateToFolder`, `reorderTemplatesInFolder` (plus type `EmailTemplateFolderRow`).

From `@/app/(dashboard)/email-templates/actions`:
`listTemplates()` (now returns `folder_id`/`position`), `deleteTemplate(id)` (hard delete → use for `onDeleteItem`).

## listTemplates select change
`...plain_text_snapshot, folder_id, position, created_by...` — added `folder_id, position` to the `.select(...)` string.

## Decisions Made
- Revalidate target is `/settings/email-templates` (canonical route per Plan 02), not `/email-templates`.
- Added the optional `folders` FK relationship in `database.ts` (nice-to-have from the plan) — internally consistent, no build impact.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None for code. Migration 1228 must be applied to production (`mwklvkmggmsintqcqfvu`) AFTER 1225, BEFORE deploying Phase 117 code — see PENDING-MIGRATIONS.md #4.

## Next Phase Readiness
- Backend contract complete; Plan 02 can import the action names above.
- Runtime folder behavior is unverifiable until 1225 + 1228 are applied (folders/email_templates.folder_id don't exist in the connected DB yet) — expected, not a gap.

---
*Phase: 117-email-templates-sub-sidebar-folders*
*Completed: 2026-07-02*

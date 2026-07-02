# Phase 115: Migrate Workflows to Universal Folders - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** code-only (production migration WRITTEN as a file + committed, NOT applied — see PENDING-MIGRATIONS.md; harness gates prod writes)

<domain>
## Phase Boundary

Repoint the **Workflows** module off `workflow_folders` and onto the universal `public.folders` store (entity_type='workflow'), with ZERO change to the sidebar UX. Deliver: (1) a data migration FILE that copies rows preserving UUIDs, repoints the `workflows.folder_id` FK, and retires the legacy table via RENAME (not DROP); (2) a code swap so the Workflows layout + sub-nav actions read/write `folders` via `src/lib/foldering/core.ts`. Build must pass. Do NOT touch Projects, Tools, or Email.
</domain>

<decisions>
## Implementation Decisions

### Migration file (write it; do NOT apply — append to next free number, confirm with `ls supabase/migrations/ | sort | tail -3`; 1225 is now the tip so use 1226)
Write EXACTLY this (idempotent-safe):
```sql
-- migration 1226: migrate workflow folders to universal folders (Phase 115, UFE-03)
-- Copies workflow_folders -> folders (entity_type='workflow') preserving UUIDs so
-- workflows.folder_id stays valid, repoints the FK, and retires the legacy table.

-- 1. copy rows, preserving ids (keeps workflows.folder_id references valid)
insert into public.folders (id, org_id, entity_type, name, color, icon, parent_id, position, created_by, created_at, updated_at)
select id, org_id, 'workflow', name, color, icon, parent_id, position, created_by, created_at, updated_at
from public.workflow_folders
on conflict (id) do nothing;

-- 2. repoint FK: workflows.folder_id -> folders(id)
alter table public.workflows drop constraint if exists workflows_folder_id_fkey;
alter table public.workflows
  add constraint workflows_folder_id_fkey
  foreign key (folder_id) references public.folders(id) on delete set null;

-- 3. retire legacy table (RENAME, do NOT drop — safety net; dropped later after parity confirmed)
alter table public.workflow_folders rename to workflow_folders_deprecated;
```
- The planner MUST first read `supabase/migrations/100_workflow_folders.sql` and grep for any OTHER foreign keys referencing `workflow_folders` (besides `workflows.folder_id`). If any exist, add matching repoint statements. If none, the three steps above are complete.
- `folders` UNIQUE(org_id, entity_type, parent_id, name) is compatible with the copied rows (all entity_type='workflow', mirrors the old UNIQUE(org_id, parent_id, name)).

### Code swap (keep export names + signatures identical so importers don't change)
- `src/app/(dashboard)/workflows/_actions/folders.ts`: rewrite each exported `'use server'` action (listFolders, createFolder, renameFolder, updateFolderMeta, reorderFolders, moveFolder, archiveFolder, deleteFolder) as a THIN wrapper that builds a `FolderingContext` (`{ supabase: await createClient(), entityType: 'workflow', itemTable: 'workflows' }`) and delegates to the matching `src/lib/foldering/core.ts` function, then calls `revalidatePath('/workflows')`. Keep the exact same exported names + return shapes the UI already consumes.
- `src/app/(dashboard)/workflows/_actions/workflows.ts`: rewrite `moveWorkflowToFolder` → `core.moveItemToFolder`, `reorderWorkflowsInFolder` → `core.reorderItemsInFolder` (same ctx). Leave the other workflow actions (rename/archive/trash of the workflow item itself) untouched unless they read workflow_folders.
- `src/app/(dashboard)/workflows/layout.tsx`: change the folders fetch from `.from('workflow_folders')...` to `.from('folders').select('*').eq('entity_type','workflow').order('position').order('created_at')`. Everything else (mapping to navFolders, WorkflowSubNav props) stays.
- Grep the whole `src/` for any other reference to `workflow_folders` (types, queries) and repoint to `folders` + entity_type filter, EXCEPT the migration files and the generated `database.ts` type block (leave `workflow_folders` type block; it now maps to the renamed `_deprecated` table but is harmless/unused — optionally add a `folders`-based usage).

### Verification bar (code-only)
- `npm run build` exits 0. That is the achievable verification here.
- Runtime/data parity (existing folders appear unchanged, CRUD works) CANNOT be verified until the migration is applied — record it as a deferred human-verify item, not a gap.
</decisions>

<code_context>
## Existing Code Insights
- `src/lib/foldering/core.ts` (built in Phase 114) — the shared functions to delegate to. Read its exact signatures.
- `src/app/(dashboard)/workflows/_actions/folders.ts` + `workflows.ts` — the current workflow-specific logic being replaced (source of truth for return shapes the UI expects).
- `src/components/workflows/workflow-sub-nav.tsx` — consumes those actions via the `TreeNavActions` contract; must keep working unchanged.
- `src/app/(dashboard)/workflows/layout.tsx` — the folders query to swap (currently `.from('workflow_folders')`).
- `supabase/migrations/100_workflow_folders.sql` — the table being migrated from (+ check for other inbound FKs).
</code_context>

<specifics>
## Specific Ideas
- Preserve UUIDs on copy — this is the whole reason the FK repoint is safe and production folders survive unchanged.
- RENAME to `_deprecated`, never DROP, until parity is confirmed post-apply (Phase 116 SC says it becomes safe to drop later).
- After writing both the migration file and the code swap, append the 1226 migration to `.planning/workstreams/v32-universal-folders-email-templates/PENDING-MIGRATIONS.md` with an "apply AFTER 1225, BEFORE deploy; MEDIUM-HIGH risk (production data + FK repoint)" note and a verify query (`select count(*) from public.folders where entity_type='workflow';` should match old `workflow_folders_deprecated` count).
</specifics>

<deferred>
## Deferred Ideas
- Dropping `workflow_folders_deprecated` → after post-apply parity confirmed (later).
- Projects/Tools migration → Phase 116. Email → 117.
</deferred>

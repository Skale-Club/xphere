# Phase 114: Universal Folders Backend - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — discuss skipped)

<domain>
## Phase Boundary

Stand up ONE shared, org-scoped, entity-typed folder store (`public.folders`) and a reusable foldering core module, WITHOUT switching any existing consumer. Workflows, Projects, and Tools continue to use their current per-entity tables until later phases (115, 116). Email Templates adopts in 117. This phase only creates the new backend and shared logic; it changes no existing behavior.

</domain>

<decisions>
## Implementation Decisions

### Data model
- New table `public.folders` with columns mirroring the existing per-entity folder tables plus an `entity_type` discriminator: `id uuid pk default gen_random_uuid()`, `org_id uuid not null references organizations(id) on delete cascade`, `entity_type text not null`, `name text not null`, `color text`, `icon text`, `parent_id uuid references folders(id) on delete cascade`, `position int not null default 0`, `created_by uuid references auth.users(id)`, `created_at/updated_at timestamptz`.
- Constraint `UNIQUE(org_id, entity_type, parent_id, name)` (mirrors `workflow_folders`' `UNIQUE(org_id, parent_id, name)` but scoped by entity_type).
- `entity_type` allowed values via CHECK: `'workflow' | 'project' | 'tool' | 'email_template'` (keep extensible; document that new modules add a value).
- RLS: `USING (org_id = get_current_org_id())` — same policy shape as `workflow_folders`.
- `moddatetime` trigger on `updated_at`; index on `(org_id, entity_type, parent_id, position)`.
- Each ENTITY keeps its own `folder_id` + `position` columns (FK → `folders.id`). Do NOT introduce a join table. This phase does NOT add those columns to any entity (that happens per-entity in 115/116/117).

### Shared core module
- `src/lib/foldering/core.ts` holds plain async functions (NOT `'use server'`) that take `(entityType, itemTable, supabase)` and implement: list folders, create, rename, updateMeta (color/icon), reorderFolders, moveFolder(parent), archiveFolder (cascade), deleteFolder (cascade soft-delete of items), moveItemToFolder, reorderItemsInFolder.
- Rationale for a plain core + thin per-module `'use server'` wrappers: Next.js Server Actions must be top-level exports of `'use server'` modules — they cannot be closures returned from a runtime factory. So the shared logic lives in core; each module keeps a tiny wrapper that satisfies the `TreeNavActions` contract. This phase delivers the core only; wrappers are added when each module migrates.
- The core's item operations write `folder_id`/`position` on the given `itemTable` — column names are consistent across entities.

### Scope guard
- No existing consumer is repointed in this phase. `npm run build` must pass and no workflow/project/tool folder behavior changes.

</decisions>

<code_context>
## Existing Code Insights

### Reference implementations to mirror (do NOT modify them in this phase)
- `supabase/migrations/100_workflow_folders.sql` — the canonical folder table schema (columns, RLS, trigger, unique constraint) to generalize.
- `supabase/migrations/1044_project_folders.sql`, `supabase/migrations/025_tool_folders.sql` — sibling copies (tool_folders is older/simpler, no color/icon).
- `src/app/(dashboard)/workflows/_actions/folders.ts` + `workflows.ts` — the CRUD + cascade + move/reorder logic to extract into `foldering/core.ts` (list/create/rename/updateFolderMeta/reorderFolders/moveFolder/archiveFolder/deleteFolder, moveWorkflowToFolder→moveItemToFolder, reorderWorkflowsInFolder→reorderItemsInFolder).

### Contract the core must satisfy (already generic)
- `src/components/layout/draggable-tree-nav.tsx` defines `interface TreeNavActions` (reorderFolders, deleteFolder(id, {cascadeChildren?}), renameFolder(id,{name}), updateFolderMeta(id,{color?,icon?}), optional uploadFolderIcon, moveItemToFolder(itemId, folderId|null), reorderItemsInFolder(folderId|null, orderedIds), optional renameItem). The per-module wrappers (future phases) must return this shape; the core should expose functions that map cleanly onto it.
- `TreeNavFolder` shape: `{ id, name, color, icon, parent_id, position }`.

### Migration + types conventions
- Migrations live in `supabase/migrations/` numbered; next number after `1097_email_template_builder.sql` is `1098`. Never edit old migrations.
- After migration: `npx supabase db push` (targets the linked/correct project) and update `src/types/database.ts` (add the `folders` table Row/Insert/Update types).
- `get_current_org_id()` (SECURITY DEFINER) resolves the active org; RLS auto-scopes.

</code_context>

<specifics>
## Specific Ideas

- Keep the migration additive and non-destructive: this phase only CREATEs `folders` (+ trigger/index/RLS). It must not alter `workflow_folders`, `project_folders`, `tool_folders`, or any entity table.
- `src/types/database.ts` is updated manually (or regenerated) to include `folders`.
- Prefer a small unit test or a typed smoke of `foldering/core.ts` signatures if a lightweight test fits existing `tests/` conventions (Vitest).

</specifics>

<deferred>
## Deferred Ideas

- Repointing Workflows → Phase 115. Projects/Tools → Phase 116. Email Templates adoption (adds `folder_id`/`position` to `email_templates`) → Phase 117.
- Dropping the legacy `*_folders` tables → after parity verified in their migration phases.

</deferred>

# Phase 116: Migrate Projects + Tools to Universal Folders - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** code-only (migration written as a committed FILE, NOT applied — PENDING-MIGRATIONS.md; harness gates prod writes). Verification bar: `npm run build` exits 0.

<domain>
## Phase Boundary
Repoint **Projects** (uses `project_spaces`, item column `projects.space_id`) and **Tools** (uses `tool_folders`, item column `tool_configs.folder_id`) onto the universal `public.folders` store, entity_type='project'/'tool'. Deliver: one migration file (copy preserving UUIDs → repoint FKs → RENAME both legacy tables to `_deprecated`); a small `foldering/core.ts` addition so a non-default item folder-column name is supported; and the code swaps for both modules. Build passes. Do NOT touch Workflows (done in 115) or Email.
</domain>

<decisions>
## Implementation Decisions

### Key facts discovered (do NOT re-derive; act on these)
- `project_spaces` (renamed from `project_folders` in mig 1157) has the SAME columns as `folders` (id, org_id, name, color, icon, parent_id, position, created_by, timestamps, UNIQUE(org_id, parent_id, name)) — clean copy, no extra columns.
- **Projects item column is `projects.space_id`** (renamed from folder_id in 1157), NOT folder_id. Its FK constraint may still be named `projects_folder_id_fkey` OR `projects_space_id_fkey` — the migration drops BOTH `if exists` then re-adds.
- `tool_folders` (mig 025) is simpler: columns id, org_id, name, parent_id, position, created_at, updated_at — NO color, NO icon, NO created_by. Item column is `tool_configs.folder_id`. It has `UNIQUE NULLS NOT DISTINCT (org_id, parent_id, name)` (two NULL-parent same-name folders are treated equal); `folders` uses plain `UNIQUE(org_id, entity_type, parent_id, name)` (NULLS DISTINCT). This slightly loosens top-level-name uniqueness for tools after migration — ACCEPTABLE, note it in the SUMMARY.

### `foldering/core.ts` addition (small, backward-compatible)
- Add optional `itemFolderColumn?: string` to `FolderingContext`, defaulting to `'folder_id'`.
- In `moveItemToFolder` and `reorderItemsInFolder`, use `ctx.itemFolderColumn ?? 'folder_id'` as the column name written on `ctx.itemTable` (instead of the hardcoded `folder_id`).
- Workflows (115) and Tools + Email keep the default 'folder_id'. Only Projects passes `'space_id'`. This is additive — 115's workflow wrappers keep working unchanged.

### Migration file (write, do NOT apply; confirm next number with `ls supabase/migrations/ | sort | tail -3`; tip is 1226 → use `1227_migrate_project_tool_folders.sql`)
```sql
-- migration 1227: migrate project + tool folders to universal folders (Phase 116, UFE-04/UFE-05)

-- ── Projects (project_spaces -> folders, entity_type='project') ────────────────
insert into public.folders (id, org_id, entity_type, name, color, icon, parent_id, position, created_by, created_at, updated_at)
select id, org_id, 'project', name, color, icon, parent_id, position, created_by, created_at, updated_at
from public.project_spaces
on conflict (id) do nothing;

alter table public.projects drop constraint if exists projects_folder_id_fkey;
alter table public.projects drop constraint if exists projects_space_id_fkey;
alter table public.projects
  add constraint projects_space_id_fkey
  foreign key (space_id) references public.folders(id) on delete set null;

alter table public.project_spaces rename to project_spaces_deprecated;

-- ── Tools (tool_folders -> folders, entity_type='tool'; no color/icon/created_by) ─
insert into public.folders (id, org_id, entity_type, name, color, icon, parent_id, position, created_by, created_at, updated_at)
select id, org_id, 'tool', name, null, null, parent_id, position, null, created_at, updated_at
from public.tool_folders
on conflict (id) do nothing;

alter table public.tool_configs drop constraint if exists tool_configs_folder_id_fkey;
alter table public.tool_configs
  add constraint tool_configs_folder_id_fkey
  foreign key (folder_id) references public.folders(id) on delete set null;

alter table public.tool_folders rename to tool_folders_deprecated;
```
- Planner MUST grep migrations for any OTHER inbound FK to `project_spaces`/`project_folders`/`tool_folders` beyond `projects.space_id` and `tool_configs.folder_id`; if found, add repoint statements.

### Code swaps (preserve export names/shapes so the sub-navs stay untouched)
- **Projects** — `src/app/(dashboard)/projects/_actions/spaces.ts`: rewrite the folder/space actions as thin `'use server'` delegations to core with ctx `{ supabase, entityType: 'project', itemTable: 'projects', itemFolderColumn: 'space_id' }`, revalidate the projects path. Swap the projects layout's `.from('project_spaces')` query → `.from('folders').eq('entity_type','project')`.
- **Tools** — find the tools folder actions + layout/sub-nav (grep for `tool_folders` and `tool_configs` folder usage). Rewrite to core with ctx `{ supabase, entityType: 'tool', itemTable: 'tool_configs' }` (default folder_id). Swap the tools folder query `.from('tool_folders')` → `.from('folders').eq('entity_type','tool')`.
- After swaps, `grep -rn "project_spaces\|tool_folders" src/` should reduce to only generated `database.ts` type blocks (leave them; they map to `_deprecated` tables).

### Verification bar (code-only)
- `npm run build` exit 0. Runtime/data parity (existing spaces + tool folders unchanged, CRUD works) is a post-apply human-verify — not a gap.
</decisions>

<code_context>
## Existing Code Insights
- `src/lib/foldering/core.ts` — add `itemFolderColumn`; read its current move/reorder item implementations first.
- `supabase/migrations/1044_project_folders.sql` + `1157_rename_project_folders_to_spaces.sql` — project_spaces schema + the space_id rename.
- `supabase/migrations/025_tool_folders.sql` — tool_folders schema + tool_configs.folder_id.
- `src/app/(dashboard)/projects/_actions/spaces.ts` — project space actions to rewrite.
- Tools folder actions + sub-nav — locate via `grep -rn "tool_folders" src/`.
</code_context>

<specifics>
## Specific Ideas
- Preserve UUIDs on both copies (keeps space_id / folder_id references valid).
- RENAME both legacy tables to `_deprecated`, never DROP.
- Append a 1227 entry to `PENDING-MIGRATIONS.md` (apply after 1226, before deploy; MEDIUM-HIGH risk; verify: folders count by entity_type='project'/'tool' matches old table counts).
</specifics>

<deferred>
## Deferred Ideas
- Dropping the three `_deprecated` tables → after post-apply parity confirmed.
- Email templates adoption → Phase 117.
</deferred>

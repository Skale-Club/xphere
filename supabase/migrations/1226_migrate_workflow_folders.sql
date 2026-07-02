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

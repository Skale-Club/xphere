-- migration 1227: migrate project + tool folders to universal folders (Phase 116, UFE-04/UFE-05)

-- Projects (project_spaces -> folders, entity_type='project')
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

-- Tools (tool_folders -> folders, entity_type='tool'; no color/icon/created_by)
insert into public.folders (id, org_id, entity_type, name, color, icon, parent_id, position, created_by, created_at, updated_at)
select id, org_id, 'tool', name, null, null, parent_id, position, null, created_at, updated_at
from public.tool_folders
on conflict (id) do nothing;

-- NOTE: tool_configs was renamed to _legacy_tool_configs on prod; that is the live tools item table.
alter table public._legacy_tool_configs drop constraint if exists tool_configs_folder_id_fkey;
alter table public._legacy_tool_configs drop constraint if exists _legacy_tool_configs_folder_id_fkey;
alter table public._legacy_tool_configs
  add constraint _legacy_tool_configs_folder_id_fkey
  foreign key (folder_id) references public.folders(id) on delete set null;

alter table public.tool_folders rename to tool_folders_deprecated;

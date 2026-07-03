-- migration 1230: drop deprecated legacy folder tables (superseded by public.folders)
-- Parity confirmed post-migration (1226/1227): 23 workflow_folders_deprecated rows =
-- 23 folders(entity_type='workflow'); 1 project_spaces_deprecated = 1 folders(entity_type='project');
-- 0 tool_folders_deprecated = 0 folders(entity_type='tool'). No external FKs reference them.
drop table if exists public.workflow_folders_deprecated;
drop table if exists public.project_spaces_deprecated;
drop table if exists public.tool_folders_deprecated;

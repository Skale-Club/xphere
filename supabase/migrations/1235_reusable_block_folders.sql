-- migration 1235: fold reusable_email_blocks (section templates) into the
-- universal folders system (v3.4 — section templates in the sidebar).
--
-- Adds folder linkage + ordering to reusable_email_blocks and registers a new
-- `reusable_email_block` folders entity_type so section templates get their own
-- (entity-scoped) folder tree, independent of email_template folders.

alter table public.reusable_email_blocks
  add column if not exists folder_id uuid references public.folders(id) on delete set null,
  add column if not exists position integer not null default 0;

create index if not exists reusable_email_blocks_folder_idx
  on public.reusable_email_blocks (folder_id, position);

-- Extend the folders entity_type check to allow section templates. The existing
-- allowed set is preserved (verified live: workflow, project, tool, email_template).
alter table public.folders drop constraint if exists folders_entity_type_check;
alter table public.folders add constraint folders_entity_type_check
  check (entity_type in ('workflow', 'project', 'tool', 'email_template', 'reusable_email_block'));

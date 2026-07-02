-- migration 1228: email_templates folder linkage (Phase 117, UFE-06)
alter table public.email_templates
  add column if not exists folder_id uuid references public.folders(id) on delete set null,
  add column if not exists position  integer not null default 0;
create index if not exists email_templates_folder_idx
  on public.email_templates (folder_id);

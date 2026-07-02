-- ─── migration 1225: universal folders (entity-typed folder store) ──────────
-- Phase 114 (UFE-01). Creates ONE shared, org-scoped folder table that later
-- phases repoint each module onto (workflow/project/tool/email_template).
-- ADDITIVE ONLY: does not touch any existing per-entity folder or entity table.

create table public.folders (
  id          uuid        primary key default gen_random_uuid(),
  org_id      uuid        not null references public.organizations(id) on delete cascade,
  entity_type text        not null,
  name        text        not null,
  color       text,                       -- optional hex, e.g. '#6366F1'
  icon        text,                       -- optional lucide icon name / emoji
  parent_id   uuid        references public.folders(id) on delete cascade,
  position    integer     not null default 0,
  created_by  uuid        references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint folders_entity_type_check
    check (entity_type in ('workflow', 'project', 'tool', 'email_template')),
  unique (org_id, entity_type, parent_id, name)
);

alter table public.folders enable row level security;

create policy "folders org members" on public.folders
  using (org_id = get_current_org_id())
  with check (org_id = get_current_org_id());

create index folders_org_entity_parent_pos_idx
  on public.folders (org_id, entity_type, parent_id, position);

create trigger trg_folders_updated_at
  before update on public.folders
  for each row execute function moddatetime(updated_at);

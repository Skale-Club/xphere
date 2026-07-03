-- migration 1233: message_templates (Phase 124, MSG-01..04)
-- New org-scoped "Messages" quick-reply template library. Explicitly distinct
-- from WhatsApp Business templates (whatsapp_templates / zernio_whatsapp_templates):
-- free-form text, no approval workflow, usable immediately after saving.

create table public.message_templates (
  id                uuid        primary key default gen_random_uuid(),
  org_id            uuid        not null references public.organizations(id) on delete cascade,
  name              text        not null,
  body              text        not null default '',
  channel_overrides jsonb       not null default '{}',
  created_by        uuid        references auth.users(id),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

alter table public.message_templates enable row level security;

create policy "message_templates org members" on public.message_templates
  using (org_id = get_current_org_id())
  with check (org_id = get_current_org_id());

create index message_templates_org_id_idx
  on public.message_templates (org_id, created_at desc);

create trigger trg_message_templates_updated_at
  before update on public.message_templates
  for each row execute function update_updated_at();

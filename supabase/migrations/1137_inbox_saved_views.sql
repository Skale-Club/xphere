create table if not exists inbox_saved_views (
  id          uuid primary key default gen_random_uuid(),
  org_id      uuid not null references organizations(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  name        text not null,
  filters     jsonb not null default '{}',
  is_default  boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table inbox_saved_views enable row level security;

-- Users can only see and manage their own saved views within their org
create policy "inbox_saved_views_owner" on inbox_saved_views
  for all using (
    user_id = auth.uid()
    and org_id = get_current_org_id()
  );

-- Only one default view per user per org
create unique index inbox_saved_views_default_idx
  on inbox_saved_views (org_id, user_id)
  where is_default = true;

create index inbox_saved_views_user_idx on inbox_saved_views (org_id, user_id);

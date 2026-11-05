-- Bootstrap for Xphere's self-hosted Postgres, run once on an EMPTY database
-- before restoring the dump of `public` and `supabase_migrations`.
--
-- It recreates what Supabase provides and Xphere's schema relies on:
-- the PostgREST roles, the `extensions` schema, a minimal `auth` schema
-- (uid/jwt/role read the JWT claims PostgREST sets), the per-role timeouts and
-- safeupdate, the schema-reload event trigger, and an empty
-- `supabase_realtime` publication so old migrations still apply.
-- Stub roles absorb GRANTs in the dump that name Supabase-internal roles.
-- Idempotent. The authenticator password is set separately (never in git).

-- ── Roles ──────────────────────────────────────────────────────────────────
do $$
declare r text;
begin
  foreach r in array array['anon','authenticated','service_role'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin noinherit', r);
    end if;
  end loop;
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator login noinherit;
  end if;
  -- Supabase-internal roles named by GRANTs in the dump. They never log in.
  foreach r in array array['supabase_admin','supabase_auth_admin','supabase_storage_admin',
    'supabase_realtime_admin','supabase_replication_admin','supabase_read_only_user',
    'supabase_etl_admin','supabase_privileged_role','dashboard_user','pgbouncer','cli_login_postgres'] loop
    if not exists (select 1 from pg_roles where rolname = r) then
      execute format('create role %I nologin', r);
    end if;
  end loop;
end $$;

alter role service_role bypassrls;
grant anon, authenticated, service_role to authenticator;

alter role anon set statement_timeout = '3s';
alter role authenticated set statement_timeout = '8s';
alter role authenticator set statement_timeout = '8s';
alter role authenticator set lock_timeout = '8s';
alter role authenticator set session_preload_libraries = 'safeupdate';

-- ── Extensions ─────────────────────────────────────────────────────────────
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
create extension if not exists vector schema extensions;
create extension if not exists btree_gist schema extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;

alter database postgres set search_path = "$user", public, extensions;

-- ── auth: only what policies and functions read ────────────────────────────
create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;

create or replace function auth.jwt() returns jsonb
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$$;

create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.sub', true),
    current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
  ), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claim.role', true),
    current_setting('request.jwt.claims', true)::jsonb ->> 'role'
  ), '')::text
$$;

grant execute on function auth.jwt(), auth.uid(), auth.role() to anon, authenticated, service_role;

-- ── PostgREST schema cache reload after DDL ────────────────────────────────
create or replace function extensions.pgrst_reload() returns event_trigger
language plpgsql as $$
begin
  notify pgrst, 'reload schema';
end $$;

drop event trigger if exists pgrst_ddl_watch;
create event trigger pgrst_ddl_watch on ddl_command_end execute function extensions.pgrst_reload();
drop event trigger if exists pgrst_drop_watch;
create event trigger pgrst_drop_watch on sql_drop execute function extensions.pgrst_reload();

-- ── Realtime publication stub (old migrations ALTER it) ────────────────────
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end $$;

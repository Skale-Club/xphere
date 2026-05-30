-- =============================================================================
-- Public read-only demo organization
-- =============================================================================
-- Creates the dedicated demo organization opened by the landing-page "See demo"
-- button via the /demo route. The org id is fixed so it can be referenced by the
-- DEMO_ORG_ID env var and by the read-only RLS policies (migration 1114).
--
-- The shared demo auth user must be created separately via Supabase Auth
-- (dashboard or admin API) — auth.users cannot be seeded from a migration.
-- After creating that user, link it to this org and register it as the demo
-- user (see migration 1114_demo_readonly.sql for public.demo_config):
--
--   INSERT INTO public.org_members (user_id, organization_id, role)
--   VALUES ('<DEMO_AUTH_USER_UUID>', '0000de00-0000-4000-8000-000000000001', 'member');
--
--   INSERT INTO public.demo_config (demo_user_id)
--   VALUES ('<DEMO_AUTH_USER_UUID>')
--   ON CONFLICT (singleton) DO UPDATE SET demo_user_id = EXCLUDED.demo_user_id;

INSERT INTO public.organizations (id, name, slug, is_active, widget_token)
VALUES (
  '0000de00-0000-4000-8000-000000000001',
  'Xphere Demo',
  'demo',
  true,
  'demo-org-widget'
)
ON CONFLICT (slug) DO NOTHING;

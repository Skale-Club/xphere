-- =============================================================================
-- Public demo: database-level read-only enforcement (defense-in-depth)
-- =============================================================================
-- The /demo route signs visitors into a single shared demo user. This migration
-- guarantees, at the database layer, that the demo user can never write — even
-- via a direct API call that bypasses the app-layer guard (lib/demo/guard.ts).
--
-- Mechanism: a RESTRICTIVE RLS policy is added per write operation on every
-- RLS-protected table. Restrictive policies AND with the existing permissive
-- policies, so:
--   * real users           -> is_demo_session() = false -> writes allowed (unchanged)
--   * the demo user        -> is_demo_session() = true  -> writes blocked
--   * service_role/webhooks -> bypass RLS entirely        -> unaffected
-- Superadmins editing the demo org use their OWN user (not the demo user), so
-- they keep full edit access.

-- ---------------------------------------------------------------------------
-- demo_config: single row holding the shared demo user's auth id.
-- Populated as a manual setup step after creating the demo auth user:
--   INSERT INTO public.demo_config (demo_user_id) VALUES ('<uuid>')
--   ON CONFLICT (singleton) DO UPDATE SET demo_user_id = EXCLUDED.demo_user_id;
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.demo_config (
  singleton boolean PRIMARY KEY DEFAULT true,
  demo_user_id uuid,
  CONSTRAINT demo_config_singleton CHECK (singleton)
);

-- Locked down: no policies => authenticated/anon get no access.
-- service_role bypasses RLS; is_demo_session() reads it as SECURITY DEFINER.
ALTER TABLE public.demo_config ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- is_demo_session(): true when the current auth user is the demo user.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_demo_session()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.demo_config
    WHERE demo_user_id IS NOT NULL
      AND demo_user_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.is_demo_session() FROM public;
GRANT EXECUTE ON FUNCTION public.is_demo_session() TO authenticated, anon, service_role;

-- ---------------------------------------------------------------------------
-- Apply the write-block to every RLS-protected table (except demo_config).
-- DROP-then-CREATE keeps this safe to re-run.
-- NOTE: tables created by FUTURE migrations are not covered here; the app-layer
-- guard still protects them, and new RLS tables should add the same block.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND c.relrowsecurity = true
      AND c.relname <> 'demo_config'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS demo_block_insert ON public.%I;', t.relname);
    EXECUTE format('DROP POLICY IF EXISTS demo_block_update ON public.%I;', t.relname);
    EXECUTE format('DROP POLICY IF EXISTS demo_block_delete ON public.%I;', t.relname);

    EXECUTE format(
      'CREATE POLICY demo_block_insert ON public.%I AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (NOT public.is_demo_session());',
      t.relname);
    EXECUTE format(
      'CREATE POLICY demo_block_update ON public.%I AS RESTRICTIVE FOR UPDATE TO authenticated USING (NOT public.is_demo_session()) WITH CHECK (NOT public.is_demo_session());',
      t.relname);
    EXECUTE format(
      'CREATE POLICY demo_block_delete ON public.%I AS RESTRICTIVE FOR DELETE TO authenticated USING (NOT public.is_demo_session());',
      t.relname);
  END LOOP;
END $$;

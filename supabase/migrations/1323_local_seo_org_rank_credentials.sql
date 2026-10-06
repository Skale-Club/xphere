-- =============================================================================
-- Migration 1323: Local SEO — per-org DataForSEO credentials
-- =============================================================================
-- Until now every geogrid scan ran on the platform's DataForSEO account and
-- was charged against the org's points quota. An org can now keep its own
-- DataForSEO login in Integrations, and the platform admin decides, per org,
-- whose account its scans run on:
--
--   integration_provider     gains 'dataforseo' (login in config.login, the
--                            API password in encrypted_api_key).
--   local_seo_org_settings   one row per org that is NOT on the default.
--                            rank_credentials = 'platform' (default, agency
--                            pays, points count against the plan quota) or
--                            'own' (org pays DataForSEO directly; points are
--                            ledgered with billable = false, so the quota and
--                            the platform daily cap ignore them).
--   local_seo_scans          remembers which account a scan was created on,
--                            so polling keeps using the same credentials even
--                            if the admin flips the setting mid-scan.
--
-- Write model: local_seo_org_settings is written only by the platform admin
-- through a service-role server action. Members can read their own org's row;
-- there is deliberately no write policy. It is a table and not a column on
-- organizations because the organizations UPDATE policy lets any member edit
-- that row.
--
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS throughout.
-- =============================================================================

ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'dataforseo';

CREATE TABLE IF NOT EXISTS public.local_seo_org_settings (
  org_id            UUID        PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  rank_credentials  TEXT        NOT NULL DEFAULT 'platform'
                                CHECK (rank_credentials IN ('platform', 'own')),
  updated_by        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.local_seo_org_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS local_seo_org_settings_select ON public.local_seo_org_settings;
CREATE POLICY local_seo_org_settings_select ON public.local_seo_org_settings
  FOR SELECT TO authenticated
  USING (org_id = public.get_current_org_id());

REVOKE INSERT, UPDATE, DELETE ON public.local_seo_org_settings FROM anon, authenticated;

ALTER TABLE public.local_seo_scans
  ADD COLUMN IF NOT EXISTS credential_source TEXT NOT NULL DEFAULT 'platform';

ALTER TABLE public.local_seo_scans
  DROP CONSTRAINT IF EXISTS local_seo_scans_credential_source_check;
ALTER TABLE public.local_seo_scans
  ADD CONSTRAINT local_seo_scans_credential_source_check
  CHECK (credential_source IN ('platform', 'own'));

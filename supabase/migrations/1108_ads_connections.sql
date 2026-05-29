-- =============================================================================
-- Migration 1108: Ads Connections — ads_connections table
-- Phase: Ads Module (beta, admin-only)
-- =============================================================================
-- One row per connected ad platform account per org.
-- encrypted_access_token: AES-256-GCM encrypted, same pattern as meta_channels.
-- platform: 'meta' | 'google' (google planned, not yet active)
-- ad_account_id: Meta = 'act_XXXXXX', Google = customer ID '123-456-7890'
-- =============================================================================

CREATE TABLE public.ads_connections (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  platform                TEXT        NOT NULL CHECK (platform IN ('meta', 'google')),
  ad_account_id           TEXT        NOT NULL,
  ad_account_name         TEXT,
  encrypted_access_token  TEXT        NOT NULL,
  token_expires_at        TIMESTAMPTZ,
  status                  TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  connection_error        TEXT,
  meta_app_scoped_user_id TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, platform, ad_account_id)
);

CREATE INDEX idx_ads_connections_org_id   ON public.ads_connections(org_id);
CREATE INDEX idx_ads_connections_platform ON public.ads_connections(org_id, platform);

ALTER TABLE public.ads_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.ads_connections
  FOR ALL
  TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

CREATE OR REPLACE FUNCTION update_ads_connections_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER ads_connections_updated_at
  BEFORE UPDATE ON public.ads_connections
  FOR EACH ROW EXECUTE FUNCTION update_ads_connections_updated_at();

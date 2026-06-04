-- Migration 1146: meta_audience_config — per-org Meta Custom Audience sync.
--
-- Each org may connect one Custom Audience on their Meta Ad Account.
-- The sync job (scripts/meta-audience-sync.ts) runs hourly on Hetzner, reads
-- contacts incrementally via updated_at watermark, SHA-256-hashes email/phone,
-- and pushes to the Meta Marketing API (/{audience_id}/users).
--
-- Connection model (MVP): agency — one META_SYSTEM_USER_TOKEN env var (Skale's
-- Business Manager system user) covers all org ad accounts.
-- AgencySystemUserProvider implements MetaConnectionProvider. Future OAuth-per-org
-- adds OrgOAuthProvider without touching this table or the sync logic.

CREATE TABLE public.meta_audience_config (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  meta_business_id    text,
  meta_ad_account_id  text        NOT NULL,     -- e.g. 'act_123456789'
  custom_audience_id  text,                     -- NULL until auto-created on first sync
  audience_name       text,                     -- display name for the audience in Meta
  sync_enabled        boolean     NOT NULL DEFAULT false,
  terms_accepted_at   timestamptz,              -- Customer List Custom Audiences terms
  consent_basis       text        NOT NULL DEFAULT 'CUSTOMER_FILE_WITH_CONSENT',
  last_synced_at      timestamptz,              -- watermark for incremental sync
  last_sync_stats     jsonb,                    -- { sent, removed, error_count }
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

ALTER TABLE public.meta_audience_config ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER meta_audience_config_updated_at
  BEFORE UPDATE ON public.meta_audience_config
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

CREATE POLICY "meta_audience_config_select" ON public.meta_audience_config
  FOR SELECT USING (org_id = public.get_current_org_id());

CREATE POLICY "meta_audience_config_insert" ON public.meta_audience_config
  FOR INSERT WITH CHECK (org_id = public.get_current_org_id());

CREATE POLICY "meta_audience_config_update" ON public.meta_audience_config
  FOR UPDATE USING (org_id = public.get_current_org_id());

CREATE POLICY "meta_audience_config_delete" ON public.meta_audience_config
  FOR DELETE USING (org_id = public.get_current_org_id());

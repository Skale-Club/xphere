-- =============================================================================
-- Migration 1100: WhatsApp Cloud API (Meta Official)
-- Adds the official Meta Cloud API as a separate integration alongside the
-- non-official providers (Evolution, Z-API, W-API in whatsapp_providers).
--
-- The Cloud API is required for outbound mass campaigns (template-based).
-- The non-official providers remain in use for inbox / 1:1 conversations.
--
-- Tables:
--   - whatsapp_cloud_accounts  : per-org Meta WABA + phone number connection
--   - whatsapp_templates       : cached approved templates synced from Meta
--
-- Schema extensions:
--   - campaigns                : whatsapp_template_id + whatsapp_variable_mapping
--   - campaign_recipients      : 'read' status, wamid, cost_usd, message_type
--   - contacts                 : whatsapp_opt_in + whatsapp_opted_at
-- =============================================================================

-- ─── whatsapp_cloud_accounts ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_cloud_accounts (
  id                              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                          UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  display_name                    TEXT        NOT NULL,
  waba_id                         TEXT        NOT NULL,
  phone_number_id                 TEXT        NOT NULL,
  phone_number_e164               TEXT,
  access_token_encrypted          TEXT        NOT NULL,
  app_secret_encrypted            TEXT,
  webhook_verify_token_encrypted  TEXT,
  status                          TEXT        NOT NULL DEFAULT 'connected'
                                              CHECK (status IN ('connected','disconnected','error')),
  is_active                       BOOLEAN     NOT NULL DEFAULT TRUE,
  last_synced_at                  TIMESTAMPTZ,
  last_error                      TEXT,
  created_by                      UUID        REFERENCES auth.users(id),
  created_at                      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_cloud_accounts_active_per_org
  ON public.whatsapp_cloud_accounts(org_id) WHERE is_active = TRUE;

CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_cloud_accounts_phone_number_id
  ON public.whatsapp_cloud_accounts(phone_number_id);

CREATE INDEX IF NOT EXISTS whatsapp_cloud_accounts_org_id
  ON public.whatsapp_cloud_accounts(org_id);

ALTER TABLE public.whatsapp_cloud_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_cloud_accounts_org_isolation"
  ON public.whatsapp_cloud_accounts
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ─── whatsapp_templates ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  cloud_account_id        UUID        NOT NULL REFERENCES public.whatsapp_cloud_accounts(id) ON DELETE CASCADE,
  meta_template_id        TEXT        NOT NULL,
  name                    TEXT        NOT NULL,
  language                TEXT        NOT NULL,
  category                TEXT        NOT NULL
                                      CHECK (category IN ('MARKETING','UTILITY','AUTHENTICATION')),
  status                  TEXT        NOT NULL
                                      CHECK (status IN ('APPROVED','PENDING','REJECTED','PAUSED','DISABLED')),
  components              JSONB       NOT NULL,
  body_variable_count     INT         NOT NULL DEFAULT 0,
  header_variable_count   INT         NOT NULL DEFAULT 0,
  synced_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cloud_account_id, name, language)
);

CREATE INDEX IF NOT EXISTS whatsapp_templates_org_id
  ON public.whatsapp_templates(org_id);

CREATE INDEX IF NOT EXISTS whatsapp_templates_cloud_account_status
  ON public.whatsapp_templates(cloud_account_id, status);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "whatsapp_templates_org_isolation"
  ON public.whatsapp_templates
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ─── campaigns: template + variable mapping ──────────────────────────────────

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS whatsapp_template_id UUID
    REFERENCES public.whatsapp_templates(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS whatsapp_variable_mapping JSONB;

COMMENT ON COLUMN public.campaigns.whatsapp_variable_mapping IS
  'Variable resolution for the chosen template. Shape: { body: [{ source: "contact.first_name" | "literal:Hello" }, ...], header: [...] }';

-- ─── campaign_recipients: read status, wamid, cost, message_type ─────────────

ALTER TABLE public.campaign_recipients
  DROP CONSTRAINT IF EXISTS campaign_recipients_status_check;

ALTER TABLE public.campaign_recipients
  ADD CONSTRAINT campaign_recipients_status_check
    CHECK (status IN ('pending','sent','delivered','read','failed','skipped','unsubscribed'));

ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS wamid        TEXT,
  ADD COLUMN IF NOT EXISTS cost_usd     NUMERIC(10,4),
  ADD COLUMN IF NOT EXISTS message_type TEXT
    CHECK (message_type IS NULL OR message_type IN ('marketing','utility','authentication','service'));

CREATE INDEX IF NOT EXISTS campaign_recipients_wamid
  ON public.campaign_recipients(wamid)
  WHERE wamid IS NOT NULL;

-- ─── contacts: whatsapp opt-in ───────────────────────────────────────────────

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in   BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS whatsapp_opted_at TIMESTAMPTZ;

COMMENT ON COLUMN public.contacts.whatsapp_opt_in IS
  'Contact has explicitly opted in to WhatsApp messaging (set automatically on first inbound from Cloud API; required for MARKETING templates).';

-- ─── updated_at trigger for new tables ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public.touch_whatsapp_cloud_accounts_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_cloud_accounts_set_updated_at
  ON public.whatsapp_cloud_accounts;
CREATE TRIGGER whatsapp_cloud_accounts_set_updated_at
  BEFORE UPDATE ON public.whatsapp_cloud_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_whatsapp_cloud_accounts_updated_at();

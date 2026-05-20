-- Migration 093: WhatsApp Multi-Provider abstraction (SEED-031)
-- Adds a generic whatsapp_providers table to support Evolution Go, Z-API, and
-- W-API. One active provider per org via partial unique index. Tokens stored
-- AES-256-GCM encrypted (JSON blob in config_encrypted) via lib/crypto.ts.

BEGIN;

-- ---------------------------------------------------------------------------
-- Provider type enum
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'whatsapp_provider_type') THEN
    CREATE TYPE public.whatsapp_provider_type AS ENUM ('evolution', 'zapi', 'wapi');
  END IF;
END$$;

-- ---------------------------------------------------------------------------
-- whatsapp_providers: one active provider per org (Evolution / Z-API / W-API)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.whatsapp_providers (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  provider                  public.whatsapp_provider_type NOT NULL,
  display_name              text NOT NULL DEFAULT '',
  phone_number              text,
  status                    text NOT NULL DEFAULT 'disconnected'
                              CHECK (status IN ('disconnected', 'connecting', 'connected', 'qr_pending', 'error')),
  is_active                 boolean NOT NULL DEFAULT false,
  config_encrypted          text NOT NULL,
  webhook_secret_encrypted  text,
  last_error                text,
  connected_at              timestamptz,
  created_by                uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

-- Only one active provider per org
CREATE UNIQUE INDEX IF NOT EXISTS whatsapp_providers_org_active_idx
  ON public.whatsapp_providers (org_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS whatsapp_providers_org_idx
  ON public.whatsapp_providers (org_id);

CREATE INDEX IF NOT EXISTS whatsapp_providers_provider_idx
  ON public.whatsapp_providers (provider);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_whatsapp_providers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_providers_touch ON public.whatsapp_providers;
CREATE TRIGGER trg_whatsapp_providers_touch
  BEFORE UPDATE ON public.whatsapp_providers
  FOR EACH ROW EXECUTE FUNCTION public.touch_whatsapp_providers_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: org isolation via get_current_org_id()
-- ---------------------------------------------------------------------------

ALTER TABLE public.whatsapp_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS whatsapp_providers_org_isolation ON public.whatsapp_providers;
CREATE POLICY whatsapp_providers_org_isolation
  ON public.whatsapp_providers
  FOR ALL
  TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

COMMIT;

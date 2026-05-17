-- Migration 053: Evolution Go WhatsApp Integration (SEED-004)
-- Each org connects its own Evolution Go instance (self-hosted whatsmeow server)
-- to receive/send WhatsApp messages. Tokens are AES-256-GCM encrypted via lib/crypto.ts.

BEGIN;

-- ---------------------------------------------------------------------------
-- evolution_instances: one row per (org, instance_name)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.evolution_instances (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                    uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  instance_name             text        NOT NULL,
  base_url                  text        NOT NULL,
  token_encrypted           text        NOT NULL,
  webhook_secret_encrypted  text,
  status                    text        NOT NULL DEFAULT 'disconnected'
                                          CHECK (status IN ('disconnected', 'connecting', 'connected', 'qr_pending')),
  phone_number              text,
  connected_at              timestamptz,
  last_error                text,
  is_active                 boolean     NOT NULL DEFAULT true,
  created_by                uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_evolution_instances_org_name
  ON public.evolution_instances (org_id, instance_name);

CREATE INDEX IF NOT EXISTS idx_evolution_instances_phone
  ON public.evolution_instances (org_id, phone_number)
  WHERE phone_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_evolution_instances_org
  ON public.evolution_instances (org_id);

-- Keep updated_at fresh
CREATE OR REPLACE FUNCTION public.touch_evolution_instances_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_evolution_instances_touch ON public.evolution_instances;
CREATE TRIGGER trg_evolution_instances_touch
  BEFORE UPDATE ON public.evolution_instances
  FOR EACH ROW EXECUTE FUNCTION public.touch_evolution_instances_updated_at();

-- ---------------------------------------------------------------------------
-- RLS: org isolation via get_current_org_id()
-- ---------------------------------------------------------------------------

ALTER TABLE public.evolution_instances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS evolution_instances_org_isolation ON public.evolution_instances;
CREATE POLICY evolution_instances_org_isolation
  ON public.evolution_instances
  FOR ALL
  TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- Add FK on conversations to route outbound through the right instance
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS evolution_instance_id uuid
    REFERENCES public.evolution_instances(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_evolution_instance
  ON public.conversations (evolution_instance_id)
  WHERE evolution_instance_id IS NOT NULL;

COMMIT;

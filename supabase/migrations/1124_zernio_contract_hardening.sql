-- Migration 1124: Zernio contract hardening
-- Adds zernio to the real agent_channel enum and records processed Zernio
-- webhook event ids for retry-safe ingestion.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'agent_channel'
      AND e.enumlabel = 'zernio'
  ) THEN
    ALTER TYPE public.agent_channel ADD VALUE 'zernio';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.zernio_webhook_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid       NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id        text       NOT NULL,
  event_type      text       NOT NULL,
  processed_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uniq_zernio_webhook_events_org_event UNIQUE (organization_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_zernio_webhook_events_org_processed
  ON public.zernio_webhook_events (organization_id, processed_at DESC);

ALTER TABLE public.zernio_webhook_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.zernio_webhook_events IS
  'Processed Zernio webhook event ids for idempotent retry handling. Service-role webhook path only.';

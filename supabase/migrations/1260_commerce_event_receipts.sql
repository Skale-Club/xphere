-- Migration 1260: idempotency ledger for inbound Medusa commerce events (contract §5).
CREATE TABLE IF NOT EXISTS public.commerce_event_receipts (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_id   text        NOT NULL,
  type       text        NOT NULL,
  payload    jsonb       NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT commerce_event_receipts_org_event_unique UNIQUE (org_id, event_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_event_receipts_org_created
  ON public.commerce_event_receipts (org_id, created_at DESC);

ALTER TABLE public.commerce_event_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS commerce_event_receipts_org_isolation ON public.commerce_event_receipts;
CREATE POLICY commerce_event_receipts_org_isolation ON public.commerce_event_receipts
  FOR ALL TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.commerce_event_receipts IS
  'Immutable receipts for inbound Medusa commerce webhooks (order.placed, customer.created). UNIQUE(org_id,event_id) makes sender retries idempotent.';

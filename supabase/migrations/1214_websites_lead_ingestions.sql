-- Xphere v3.1: durable, idempotent receipts for Skale Club Websites leads.

CREATE TABLE IF NOT EXISTS public.lead_ingestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  source_product text NOT NULL,
  source_tenant_ref text NOT NULL,
  external_event_id text NOT NULL,
  schema_version text NOT NULL,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  payload_hash text NOT NULL,
  workflow_dispatch_id uuid REFERENCES public.event_dispatches(id) ON DELETE SET NULL,
  CONSTRAINT lead_ingestions_external_event_unique
    UNIQUE (org_id, source_product, external_event_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_ingestions_org_received
  ON public.lead_ingestions (org_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_lead_ingestions_contact
  ON public.lead_ingestions (org_id, contact_id, received_at DESC);

ALTER TABLE public.lead_ingestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lead_ingestions_org_isolation ON public.lead_ingestions;
CREATE POLICY lead_ingestions_org_isolation ON public.lead_ingestions
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.lead_ingestions IS
  'Immutable receipts for externally captured inbound leads. Contact identity deduplication is independent from event idempotency.';

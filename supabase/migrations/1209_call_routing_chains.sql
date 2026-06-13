-- Migration 1209: Call routing chains (simultaneous-ring + ordered fallback)
-- Reconstructed from prod, where it was applied 2026-06-12 as version
-- 20260612144218 (the .sql file was never committed). Filed as 1209 because
-- 1207/1208 are taken by in-flight billing migrations. The prod ledger tracks
-- this by its timestamp version, so the repo number only matters for fresh
-- setups. Idempotent — safe to re-run.
CREATE TABLE IF NOT EXISTS public.call_routing_chains (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  is_active   boolean     NOT NULL DEFAULT true,
  stages      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS call_routing_chains_org_idx
  ON public.call_routing_chains (org_id);

ALTER TABLE public.call_routing_chains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_routing_chains_org ON public.call_routing_chains;
CREATE POLICY call_routing_chains_org
  ON public.call_routing_chains
  FOR ALL
  USING (org_id = (SELECT get_current_org_id()))
  WITH CHECK (org_id = (SELECT get_current_org_id()));

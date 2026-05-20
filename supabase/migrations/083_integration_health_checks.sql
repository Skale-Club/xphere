-- =============================================================================
-- Migration 083: Integration Health Checks History (SEED-025 Phase D)
-- =============================================================================
-- Append-only audit trail of every health probe. The integrations table
-- holds the current state (health_status, last_checked_at, failure_count);
-- this table preserves the full history for debugging flapping behavior
-- and incident forensics.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.integration_health_checks (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id  uuid        NOT NULL REFERENCES public.integrations(id) ON DELETE CASCADE,
  organization_id uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  status          text        NOT NULL
    CHECK (status IN ('connected', 'degraded', 'disconnected')),
  latency_ms      integer,
  error           text,
  checked_at      timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.integration_health_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_integration_health_checks ON public.integration_health_checks
  FOR SELECT
  USING (organization_id = (SELECT public.get_current_org_id()));

CREATE INDEX idx_integration_health_checks_integration
  ON public.integration_health_checks (integration_id, checked_at DESC);

CREATE INDEX idx_integration_health_checks_org
  ON public.integration_health_checks (organization_id, checked_at DESC);

-- Auto-prune: keep 30 days of history. Older rows are tail of the index
-- so this is cheap to run nightly.
-- (Scheduler not declared here — invoked by the integration-health Edge
-- Function or a separate pg_cron job.)

-- ---------------------------------------------------------------------------
-- RPC: mark_workflows_blocked_by_integration / clear_workflows_blocked_by_integration
-- ---------------------------------------------------------------------------
-- Called by the integration-health Edge Function when an integration flips
-- between connected and disconnected. Scans current workflow versions for
-- action nodes whose credential_ref matches the integration id and updates
-- the workflows.health_blocked flag accordingly.

CREATE OR REPLACE FUNCTION public.mark_workflows_blocked_by_integration(
  p_integration_id uuid,
  p_reason         text
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  WITH targets AS (
    SELECT w.id
    FROM public.workflows w
    JOIN public.workflow_versions v ON v.id = w.current_version_id
    WHERE w.current_version_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v.definition->'nodes') AS node
        WHERE node->'data'->>'credential_ref' = p_integration_id::text
      )
  )
  UPDATE public.workflows
    SET health_blocked = true,
        health_blocked_reason = p_reason,
        updated_at = now()
    WHERE id IN (SELECT id FROM targets);

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_workflows_blocked_by_integration(
  p_integration_id uuid
) RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  affected integer;
BEGIN
  WITH targets AS (
    SELECT w.id
    FROM public.workflows w
    JOIN public.workflow_versions v ON v.id = w.current_version_id
    WHERE w.current_version_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v.definition->'nodes') AS node
        WHERE node->'data'->>'credential_ref' = p_integration_id::text
      )
  )
  UPDATE public.workflows
    SET health_blocked = false,
        health_blocked_reason = NULL,
        updated_at = now()
    WHERE id IN (SELECT id FROM targets)
      AND health_blocked = true;

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_workflows_blocked_by_integration(uuid, text)
  TO service_role;

GRANT EXECUTE ON FUNCTION public.clear_workflows_blocked_by_integration(uuid)
  TO service_role;

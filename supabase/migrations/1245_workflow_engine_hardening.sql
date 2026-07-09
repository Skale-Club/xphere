-- =============================================================================
-- Migration 1245: Workflow engine hardening
-- =============================================================================
-- Additive, follow-up hardening for the unified workflow system:
--
--  1) GIN index on workflows.trigger_config — every event-dispatch path filters
--     with `trigger_config @> {event}` (calendar/pipeline/contact/lead/phone
--     emitters + the calendar-tick cron). Without it those are seq scans.
--
--  2) Atomic idempotency for scheduled_opportunity_ticks. The scheduler used a
--     SELECT-then-INSERT dedupe with no unique constraint, so two overlapping
--     cron runs could both miss the existing row and double-dispatch. Add a
--     UTC-day generated column + unique index so the DB enforces "at most once
--     per (workflow, opportunity, event) per day" and the app relies on the
--     insert conflict instead of a racy pre-check.
--
--  3) clear_workflows_blocked_by_integration must not unblock a workflow that
--     still references ANOTHER disconnected integration.
-- =============================================================================

-- ─── 1) GIN index on workflows.trigger_config ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workflows_trigger_config_gin
  ON public.workflows USING gin (trigger_config jsonb_path_ops);

-- ─── 2) Atomic per-day idempotency for opportunity ticks ─────────────────────
ALTER TABLE public.scheduled_opportunity_ticks
  ADD COLUMN IF NOT EXISTS fire_day date
  GENERATED ALWAYS AS (((fire_at AT TIME ZONE 'UTC'))::date) STORED;

-- Remove any pre-existing same-day duplicates (keep the earliest) so the unique
-- index can be created cleanly.
DELETE FROM public.scheduled_opportunity_ticks t
USING public.scheduled_opportunity_ticks keep
WHERE t.workflow_id = keep.workflow_id
  AND t.opportunity_id = keep.opportunity_id
  AND t.event_type = keep.event_type
  AND t.fire_day = keep.fire_day
  AND t.created_at > keep.created_at;

CREATE UNIQUE INDEX IF NOT EXISTS uq_scheduled_opportunity_ticks_per_day
  ON public.scheduled_opportunity_ticks (workflow_id, opportunity_id, event_type, fire_day);

-- ─── 3) Health-clear must respect other disconnected integrations ────────────
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
  UPDATE public.workflows w
    SET health_blocked = false,
        health_blocked_reason = NULL,
        updated_at = now()
    FROM public.workflow_versions v
    WHERE v.id = w.current_version_id
      AND w.health_blocked = true
      -- The workflow references the integration that just reconnected …
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v.definition->'nodes') AS node
        WHERE node->'data'->>'credential_ref' = p_integration_id::text
      )
      -- … and no OTHER referenced integration is still unhealthy/inactive.
      AND NOT EXISTS (
        SELECT 1
        FROM jsonb_array_elements(v.definition->'nodes') AS node
        JOIN public.integrations i
          ON i.id::text = node->'data'->>'credential_ref'
        WHERE node->'data'->>'credential_ref' <> p_integration_id::text
          AND (i.is_active = false OR i.health_status NOT IN ('connected', 'degraded'))
      );

  GET DIAGNOSTICS affected = ROW_COUNT;
  RETURN affected;
END;
$$;

GRANT EXECUTE ON FUNCTION public.clear_workflows_blocked_by_integration(uuid)
  TO service_role;

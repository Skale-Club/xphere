-- 1249_tool_run_logging.sql
-- SEED-025 follow-up: run-log for kind='tool' workflow executions.
--
-- Phase F froze action_logs (log-action.ts became a no-op stub) but nothing
-- replaced it for tool-kind workflows: workflow_runs only ever received
-- kind='flow' executions. Consequences: Vapi tool-calls left no trace (empty
-- call timelines) and the Workflow logs page only showed legacy rows.
--
-- This migration:
--   1) extends workflow_runs so a single insert can record a completed
--      tool execution (kind + tool_name + vapi_call_id + execution_ms);
--   2) allows a 'timeout' terminal status (tool executions distinguish
--      timeout from error, mirroring the legacy action_logs contract);
--   3) links manychat_events to the run that handled them (the legacy
--      action_log_id FK stays for historical rows);
--   4) creates the workflow_tool_logs view: new tool runs UNION legacy
--      action_logs projected into one shape, so the call timeline and the
--      Workflow logs page read a single source with exact pagination.

-- ─── 1) workflow_runs: tool-execution columns ────────────────────────────────

ALTER TABLE public.workflow_runs
  ADD COLUMN IF NOT EXISTS kind         text NOT NULL DEFAULT 'flow',
  ADD COLUMN IF NOT EXISTS tool_name    text,
  ADD COLUMN IF NOT EXISTS vapi_call_id text,
  ADD COLUMN IF NOT EXISTS execution_ms integer;

COMMENT ON COLUMN public.workflow_runs.kind IS
  'flow = DAG execution (engine/run-flow-sync); tool = single-action kind=tool workflow execution (logToolRun).';
COMMENT ON COLUMN public.workflow_runs.vapi_call_id IS
  'Execution context ref. Bare Vapi call id for voice tool-calls; prefixed pseudo-ids for other channels (e.g. manychat:<eventId>), matching the legacy action_logs convention.';

ALTER TABLE public.workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_kind_check;
ALTER TABLE public.workflow_runs ADD CONSTRAINT workflow_runs_kind_check
  CHECK (kind IN ('flow','tool'));

-- 2) 'timeout' terminal status (existing set from 075 + 1154)
ALTER TABLE public.workflow_runs DROP CONSTRAINT IF EXISTS workflow_runs_status_check;
ALTER TABLE public.workflow_runs ADD CONSTRAINT workflow_runs_status_check
  CHECK (status IN ('queued','running','succeeded','failed','cancelled','waiting','timeout'));

-- Call-detail timeline lookup: all tool runs for one Vapi call.
CREATE INDEX IF NOT EXISTS idx_workflow_runs_vapi_call
  ON public.workflow_runs (vapi_call_id)
  WHERE vapi_call_id IS NOT NULL;

-- Workflow logs page: newest tool runs per org.
CREATE INDEX IF NOT EXISTS idx_workflow_runs_org_tool_created
  ON public.workflow_runs (org_id, created_at DESC)
  WHERE kind = 'tool';

-- ─── 3) manychat_events → run linkage ────────────────────────────────────────

ALTER TABLE public.manychat_events
  ADD COLUMN IF NOT EXISTS workflow_run_id uuid
  REFERENCES public.workflow_runs(id) ON DELETE SET NULL;

-- ─── 4) unified read view ────────────────────────────────────────────────────
-- security_invoker: both branches keep their own org RLS for the dashboard
-- (authenticated) client; service-role readers bypass as usual.

CREATE OR REPLACE VIEW public.workflow_tool_logs
WITH (security_invoker = true) AS
SELECT
  r.id,
  r.org_id                              AS organization_id,
  NULL::uuid                            AS tool_config_id,
  r.workflow_id,
  COALESCE(r.vapi_call_id, '')          AS vapi_call_id,
  COALESCE(r.tool_name, '')             AS tool_name,
  CASE r.status
    WHEN 'succeeded' THEN 'success'
    WHEN 'timeout'   THEN 'timeout'
    ELSE 'error'
  END                                   AS status,
  COALESCE(
    r.execution_ms,
    GREATEST(0, (EXTRACT(EPOCH FROM (r.ended_at - r.started_at)) * 1000))::integer,
    0
  )                                     AS execution_ms,
  r.trigger_payload                     AS request_payload,
  r.state                               AS response_payload,
  r.error                               AS error_detail,
  NULL::uuid                            AS agent_invocation_id,
  NULL::uuid                            AS trace_id,
  r.created_at,
  'run'::text                           AS source
FROM public.workflow_runs r
WHERE r.kind = 'tool'
UNION ALL
SELECT
  a.id,
  a.organization_id,
  a.tool_config_id,
  NULL::uuid                            AS workflow_id,
  a.vapi_call_id,
  a.tool_name,
  a.status,
  a.execution_ms,
  a.request_payload,
  a.response_payload,
  a.error_detail,
  a.agent_invocation_id,
  a.trace_id,
  a.created_at,
  'legacy'::text                        AS source
FROM public.action_logs a;

GRANT SELECT ON public.workflow_tool_logs TO authenticated, service_role;

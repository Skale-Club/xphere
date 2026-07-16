-- 1250_tool_log_call_index.sql
-- Follow-up to 1249: the workflow_tool_logs view exposes
-- COALESCE(vapi_call_id, '') so the call-detail lookup
-- (WHERE vapi_call_id = <call id>) compiles to
-- COALESCE(r.vapi_call_id, '') = $1, which the plain-column partial index
-- from 1249 cannot serve. Replace it with an expression index whose partial
-- predicate (kind = 'tool') is provable from the view definition.

DROP INDEX IF EXISTS public.idx_workflow_runs_vapi_call;

CREATE INDEX IF NOT EXISTS idx_workflow_runs_vapi_call
  ON public.workflow_runs ((COALESCE(vapi_call_id, '')))
  WHERE kind = 'tool';

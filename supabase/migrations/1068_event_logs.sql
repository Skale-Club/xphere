-- =============================================================================
-- Migration 1068: AI Logs and Observability System
--
-- Adds the event_logs table for structured operational memory. Both humans
-- and AI agents can inspect, search, and diagnose what happened inside the
-- app. Covers: app events, errors, workflow runs, webhook calls, integration
-- failures, AI/tool actions, cron jobs.
--
-- Depends on: organizations table (all prior migrations)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.event_logs (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid        REFERENCES public.organizations(id) ON DELETE CASCADE,  -- nullable for platform-level events
  event_type     text        NOT NULL,           -- e.g. 'workflow.run', 'webhook.received', 'action.executed', 'cron.tick'
  source         text        NOT NULL,           -- e.g. 'action-engine', 'vapi-webhook', 'meta-webhook', 'cron'
  severity       text        NOT NULL DEFAULT 'info', -- 'debug','info','warn','error','fatal'
  status         text        NOT NULL DEFAULT 'ok',   -- 'ok','failed','retried','skipped'
  correlation_id uuid,                           -- groups related events for a single request/run
  actor_type     text,                           -- 'system','user','agent','webhook'
  actor_id       text,
  payload        jsonb       NOT NULL DEFAULT '{}',
  error_message  text,
  error_stack    text,
  duration_ms    integer,
  created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.event_logs IS
  'Structured operational event log. Ingested via service-role only. '
  'Readable by authenticated org members for their own org (RLS). '
  'Platform-level events have org_id = NULL and are readable by everyone.';

COMMENT ON COLUMN public.event_logs.event_type IS
  'Dot-namespaced event name, e.g. workflow.run.started, action.executed, webhook.received';

COMMENT ON COLUMN public.event_logs.source IS
  'Origin subsystem, e.g. action-engine, vapi-webhook, meta-webhook, cron, agent-runtime';

COMMENT ON COLUMN public.event_logs.severity IS
  'Log level: debug | info | warn | error | fatal';

COMMENT ON COLUMN public.event_logs.status IS
  'Outcome: ok | failed | retried | skipped';

COMMENT ON COLUMN public.event_logs.correlation_id IS
  'Optional UUID grouping a related sequence of events (e.g. one webhook invocation chain)';

-- Primary read path: per-org timeline
CREATE INDEX IF NOT EXISTS idx_event_logs_org_created
  ON public.event_logs (org_id, created_at DESC);

-- Event-type drill-down
CREATE INDEX IF NOT EXISTS idx_event_logs_type_created
  ON public.event_logs (event_type, created_at DESC);

-- Severity-based alert queries
CREATE INDEX IF NOT EXISTS idx_event_logs_severity_created
  ON public.event_logs (severity, created_at DESC);

-- Correlation chain lookup (sparse — only indexed where non-null)
CREATE INDEX IF NOT EXISTS idx_event_logs_correlation_id
  ON public.event_logs (correlation_id)
  WHERE correlation_id IS NOT NULL;

-- ----- RLS ---------------------------------------------------------------

ALTER TABLE public.event_logs ENABLE ROW LEVEL SECURITY;

-- Org members see their own org's logs plus platform-level (org_id IS NULL) events.
CREATE POLICY "org members read own logs"
  ON public.event_logs
  FOR SELECT
  TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()) OR org_id IS NULL);

-- Only the service role may insert (bypasses RLS by default; this policy is
-- a safety net for any future role that might be granted INSERT explicitly).
CREATE POLICY "service role insert"
  ON public.event_logs
  FOR INSERT
  WITH CHECK (true);

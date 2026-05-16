-- =============================================================================
-- Migration: 037_agent_invocations
-- Phase: v2.0 Multi-Bot Platform — Phase 33 Schema Foundation
-- Creates: agent_invocation_status + agent_invocation_mode enums
--          public.agent_invocations (OBS-01)
--          additive nullable agent_invocation_id + trace_id on public.action_logs (OBS-02)
-- Indexes: 4 mandatory on agent_invocations per D-33-13 + 1 on action_logs.trace_id per D-33-14
-- RLS:     SELECT-only for authenticated; INSERT/UPDATE service-role only (runtime writes via service-role client)
-- Decisions: D-33-01 (migration 4 of 6)
--            D-33-13 (4 indexes), D-33-14 (action_logs.trace_id index)
--            D-33-17 (status: success | error | aborted | skipped | denied)
--            D-33-18 (mode: production | playground)
-- Source: .planning/research/ARCHITECTURE.md Migration 037 (extended per D-33-17/18)
-- =============================================================================

-- Enums

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_invocation_status') THEN
    CREATE TYPE public.agent_invocation_status AS ENUM (
      'success', 'error', 'aborted', 'skipped', 'denied'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_invocation_mode') THEN
    CREATE TYPE public.agent_invocation_mode AS ENUM (
      'production', 'playground'
    );
  END IF;
END $$;

-- agent_invocations: one row per runAgent() call (OBS-01)

CREATE TABLE IF NOT EXISTS public.agent_invocations (
  id                   UUID                              PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID                              NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id             UUID                              NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  parent_invocation_id UUID                              REFERENCES public.agent_invocations(id) ON DELETE SET NULL,
  trace_id             UUID                              NOT NULL,
  channel              public.agent_channel              NOT NULL,
  conversation_id      UUID,
  session_id           TEXT,
  depth                INTEGER                           NOT NULL DEFAULT 0,
  status               public.agent_invocation_status    NOT NULL,
  mode                 public.agent_invocation_mode      NOT NULL DEFAULT 'production',
  user_message         TEXT,
  assistant_reply      TEXT,
  tool_calls           JSONB                             NOT NULL DEFAULT '[]'::jsonb,
  partner_calls        JSONB                             NOT NULL DEFAULT '[]'::jsonb,
  tokens_in            INTEGER,
  tokens_out           INTEGER,
  cost_usd             NUMERIC(10,6),
  model                TEXT,
  duration_ms          INTEGER,
  error_detail         TEXT,
  created_at           TIMESTAMPTZ                       NOT NULL DEFAULT now()
);

ALTER TABLE public.agent_invocations ENABLE ROW LEVEL SECURITY;

-- 4 mandatory indexes per D-33-13
CREATE INDEX IF NOT EXISTS idx_agent_invocations_org_created
  ON public.agent_invocations(organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_invocations_trace
  ON public.agent_invocations(trace_id);

CREATE INDEX IF NOT EXISTS idx_agent_invocations_parent
  ON public.agent_invocations(parent_invocation_id)
  WHERE parent_invocation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_agent_invocations_agent_created
  ON public.agent_invocations(agent_id, created_at DESC);

-- SELECT-only RLS for authenticated users; runtime writes via service-role client (bypasses RLS)
DROP POLICY IF EXISTS "agent_invocations_select" ON public.agent_invocations;
CREATE POLICY "agent_invocations_select" ON public.agent_invocations
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.agent_invocations IS
  'Phase 33 (v2.0): OBS-01 observability sink. One row per runAgent() call. Writes are service-role only (Phase 34 runtime). RLS-isolated reads for dashboard. status enum per D-33-17; mode per D-33-18.';

-- ---------------------------------------------------------------------------
-- action_logs additive columns (OBS-02)
-- ---------------------------------------------------------------------------

ALTER TABLE public.action_logs
  ADD COLUMN IF NOT EXISTS agent_invocation_id UUID
    REFERENCES public.agent_invocations(id) ON DELETE SET NULL;

ALTER TABLE public.action_logs
  ADD COLUMN IF NOT EXISTS trace_id UUID;

CREATE INDEX IF NOT EXISTS idx_action_logs_trace
  ON public.action_logs(trace_id)
  WHERE trace_id IS NOT NULL;

COMMENT ON COLUMN public.action_logs.agent_invocation_id IS
  'Phase 33 (v2.0): OBS-02 back-reference to agent_invocations. NULL = legacy v1.x action (e.g. Vapi tool call). Additive — does not break existing consumers.';

COMMENT ON COLUMN public.action_logs.trace_id IS
  'Phase 33 (v2.0): OBS-02 cross-table trace correlation. Same trace_id appears on the parent agent_invocation row + every action_logs row spawned by that invocation.';

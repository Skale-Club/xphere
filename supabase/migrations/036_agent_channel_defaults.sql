-- =============================================================================
-- Migration: 036_agent_channel_defaults
-- Phase: v2.0 Multi-Bot Platform — Phase 33 Schema Foundation
-- Creates: public.agent_channel_defaults — (org_id, channel) -> agent_id resolver mapping
-- RLS:     org-scoped via (SELECT public.get_current_org_id())
-- Decisions: D-33-01 (migration 3 of 6)
--            D-33-09 (Phase 33 only seeds 'web_widget'; other channels populated by Phase 36 admin)
-- Source: .planning/research/ARCHITECTURE.md Migration 036
-- =============================================================================

-- agent_channel_defaults: which agent owns inbound for (org, channel)

CREATE TABLE IF NOT EXISTS public.agent_channel_defaults (
  id              UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID                  NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel         public.agent_channel  NOT NULL,
  agent_id        UUID                  NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ           NOT NULL DEFAULT now(),
  CONSTRAINT uniq_agent_channel_defaults_org_channel UNIQUE (organization_id, channel)
);

ALTER TABLE public.agent_channel_defaults ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_channel_defaults_org_channel
  ON public.agent_channel_defaults(organization_id, channel);

DROP POLICY IF EXISTS "agent_channel_defaults_all" ON public.agent_channel_defaults;
CREATE POLICY "agent_channel_defaults_all" ON public.agent_channel_defaults
  FOR ALL TO authenticated
  USING      (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS trg_agent_channel_defaults_updated_at ON public.agent_channel_defaults;
CREATE TRIGGER trg_agent_channel_defaults_updated_at
  BEFORE UPDATE ON public.agent_channel_defaults
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.agent_channel_defaults IS
  'Phase 33 (v2.0): resolves (org, channel) -> default agent for inbound dispatch. Phase 33 seeds only web_widget per D-33-09; other channels populated via Phase 36 admin UI.';

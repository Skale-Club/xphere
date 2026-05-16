-- =============================================================================
-- Migration: 035_agent_prompt_versions
-- Phase: v2.0 Multi-Bot Platform — Phase 33 Schema Foundation
-- Creates: public.agent_prompt_versions + adds agents.active_prompt_version_id FK
-- RLS:     org-scoped via (SELECT public.get_current_org_id())
-- Decisions: D-33-01 (migration 2 of 6)
--            D-33-06 (active_prompt_version_id added as nullable FK; seed handles version=1
--                     chicken-and-egg via UPDATE-after-INSERT)
--            D-33-16 (NO auto-snapshot trigger here — that lands in Phase 41)
-- Source: .planning/research/ARCHITECTURE.md Migration 035
-- =============================================================================

-- agent_prompt_versions: append-only version history per agent

CREATE TABLE IF NOT EXISTS public.agent_prompt_versions (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id        UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  version         INTEGER      NOT NULL,
  system_prompt   TEXT         NOT NULL,
  created_by      UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uniq_agent_prompt_versions_per_agent UNIQUE (agent_id, version),
  CONSTRAINT chk_agent_prompt_version_positive    CHECK (version >= 1)
);

ALTER TABLE public.agent_prompt_versions ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_prompt_versions_agent
  ON public.agent_prompt_versions(agent_id, version DESC);

DROP POLICY IF EXISTS "agent_prompt_versions_all" ON public.agent_prompt_versions;
CREATE POLICY "agent_prompt_versions_all" ON public.agent_prompt_versions
  FOR ALL TO authenticated
  USING      (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.agent_prompt_versions IS
  'Phase 33 (v2.0): append-only prompt history per agent. Auto-snapshot trigger lands in Phase 41 (D-33-16). Phase 33 only seeds version=1 for the Main Agent backfill.';

-- agents.active_prompt_version_id: pointer to the version the runtime should load
-- (Phase 34 runtime will read agents.system_prompt directly; Phase 41 switches to following this pointer)

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS active_prompt_version_id UUID
    REFERENCES public.agent_prompt_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_agents_active_prompt_version
  ON public.agents(active_prompt_version_id)
  WHERE active_prompt_version_id IS NOT NULL;

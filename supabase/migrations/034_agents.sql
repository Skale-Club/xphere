-- =============================================================================
-- Migration: 034_agents
-- Phase: v2.0 Multi-Bot Platform — Phase 33 Schema Foundation
-- Creates: agent_channel enum + public.agents + public.agent_tools + public.agent_partners
-- RLS:     org-scoped via (SELECT public.get_current_org_id()) (canonical pattern)
-- Decisions: D-33-01 (6-migration split, this is migration 1 of 6)
--            D-33-02 (CREATE TABLE IF NOT EXISTS for idempotency; canonical RLS)
--            D-33-19 (agent_channel enum: web_widget, whatsapp, messenger, instagram, manychat, telegram)
-- Source: .planning/research/ARCHITECTURE.md Schema sketch Migration 034
--         + 33-CONTEXT.md Migration Splitting
-- =============================================================================

-- Enums

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'agent_channel') THEN
    CREATE TYPE public.agent_channel AS ENUM (
      'web_widget', 'whatsapp', 'messenger', 'instagram', 'manychat', 'telegram'
    );
  END IF;
END $$;

-- agents: first-class entity, per-org, text channels only

CREATE TABLE IF NOT EXISTS public.agents (
  id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name                TEXT         NOT NULL,
  slug                TEXT         NOT NULL,
  description         TEXT,
  system_prompt       TEXT         NOT NULL,
  model               TEXT         NOT NULL DEFAULT 'anthropic/claude-haiku-4-5',
  fallback_message    TEXT         NOT NULL DEFAULT 'I cannot help with that right now.',
  max_history         INTEGER      NOT NULL DEFAULT 10,
  kb_scope            TEXT[],
  channel_overrides   JSONB        NOT NULL DEFAULT '{}'::jsonb,
  allowed_channels    public.agent_channel[] NOT NULL DEFAULT ARRAY['web_widget']::public.agent_channel[],
  is_active           BOOLEAN      NOT NULL DEFAULT true,
  created_by          UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by          UUID         REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uniq_agents_org_slug UNIQUE (organization_id, slug)
);

ALTER TABLE public.agents ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agents_org_active ON public.agents(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_agents_org_slug   ON public.agents(organization_id, slug);

DROP POLICY IF EXISTS "agents_select" ON public.agents;
CREATE POLICY "agents_select" ON public.agents
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS "agents_insert" ON public.agents;
CREATE POLICY "agents_insert" ON public.agents
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS "agents_update" ON public.agents;
CREATE POLICY "agents_update" ON public.agents
  FOR UPDATE TO authenticated
  USING      (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS "agents_delete" ON public.agents;
CREATE POLICY "agents_delete" ON public.agents
  FOR DELETE TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS trg_agents_updated_at ON public.agents;
CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON public.agents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

COMMENT ON TABLE public.agents IS
  'Phase 33 (v2.0): first-class chat agent entity. Per-org. Text channels only — Vapi voice unchanged. Audit fields per AGENT-09.';

-- agent_tools: junction granting an agent permission to use a tool_config (TOOL-01)

CREATE TABLE IF NOT EXISTS public.agent_tools (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id         UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  tool_config_id   UUID         NOT NULL REFERENCES public.tool_configs(id) ON DELETE CASCADE,
  allowed_channels public.agent_channel[],
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uniq_agent_tools_pair UNIQUE (agent_id, tool_config_id)
);

ALTER TABLE public.agent_tools ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_tools_agent ON public.agent_tools(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_tools_tool  ON public.agent_tools(tool_config_id);

DROP POLICY IF EXISTS "agent_tools_all" ON public.agent_tools;
CREATE POLICY "agent_tools_all" ON public.agent_tools
  FOR ALL TO authenticated
  USING      (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.agent_tools IS
  'Phase 33 (v2.0): TOOL-01 junction. (agent_id, tool_config_id) UNIQUE. allowed_channels NULL = all channels.';

-- agent_partners: directed edge agent_id -> partner_agent_id (DELEG-01)

CREATE TABLE IF NOT EXISTS public.agent_partners (
  id                     UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id        UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_id               UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  partner_agent_id       UUID         NOT NULL REFERENCES public.agents(id) ON DELETE CASCADE,
  invocation_description TEXT         NOT NULL,
  created_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT chk_agent_partners_no_self CHECK (agent_id <> partner_agent_id),
  CONSTRAINT uniq_agent_partners_pair   UNIQUE (agent_id, partner_agent_id)
);

ALTER TABLE public.agent_partners ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_agent_partners_agent ON public.agent_partners(agent_id);

DROP POLICY IF EXISTS "agent_partners_all" ON public.agent_partners;
CREATE POLICY "agent_partners_all" ON public.agent_partners
  FOR ALL TO authenticated
  USING      (organization_id = (SELECT public.get_current_org_id()))
  WITH CHECK (organization_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.agent_partners IS
  'Phase 33 (v2.0): DELEG-01 directed-edge junction. invocation_description is LLM-facing (synthetic call_partner_<slug> tool description in Phase 38).';

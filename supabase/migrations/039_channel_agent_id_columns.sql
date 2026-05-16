-- =============================================================================
-- Migration: 039_channel_agent_id_columns
-- Phase: v2.0 Multi-Bot Platform — Phase 33 Schema Foundation
-- Adds:    nullable agent_id UUID FK column to public.manychat_rules + public.meta_channels (CHAN-06)
-- Indexes: partial index per new column WHERE agent_id IS NOT NULL (future dispatcher lookup)
-- RLS:     NOT MODIFIED — both tables retain their existing RLS policies from origin migrations
-- Backfill: NONE per D-33-11 — existing rows keep tool_config_id-based dispatch until admin opts in
-- Constraint: NO XOR CHECK between agent_id and tool_config_id per D-33-12 (lands in Phase 37)
-- Decisions: D-33-01 (migration 6 of 6)
--            D-33-11 (no backfill)
--            D-33-12 (no XOR CHECK in Phase 33)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- public.manychat_rules: add nullable agent_id
-- NULL = legacy dispatch via tool_config_id (existing v1.x behavior preserved)
-- NON-NULL (Phase 36+ admin opts in) = dispatch via runAgent(agent_id)
-- ---------------------------------------------------------------------------

ALTER TABLE public.manychat_rules
  ADD COLUMN IF NOT EXISTS agent_id UUID
    REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_manychat_rules_agent_id
  ON public.manychat_rules(agent_id)
  WHERE agent_id IS NOT NULL;

COMMENT ON COLUMN public.manychat_rules.agent_id IS
  'Phase 33 (v2.0): CHAN-06 — optional v2.0 agent dispatch. NULL = legacy v1.x dispatch via tool_config_id. Phase 36 admin UI lets users opt rules into v2.0 agents. XOR CHECK constraint deferred to Phase 37 per D-33-12.';

-- ---------------------------------------------------------------------------
-- public.meta_channels: add nullable agent_id
-- ---------------------------------------------------------------------------

ALTER TABLE public.meta_channels
  ADD COLUMN IF NOT EXISTS agent_id UUID
    REFERENCES public.agents(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_meta_channels_agent_id
  ON public.meta_channels(agent_id)
  WHERE agent_id IS NOT NULL;

COMMENT ON COLUMN public.meta_channels.agent_id IS
  'Phase 33 (v2.0): CHAN-06 — optional v2.0 agent dispatch. NULL = legacy v1.x dispatch via tool_config_id. Phase 36 admin UI lets users opt channels into v2.0 agents. XOR CHECK constraint deferred to Phase 37 per D-33-12.';

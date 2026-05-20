-- =============================================================================
-- Migration 080: Unified Workflow Schema (SEED-025 Phase A)
-- =============================================================================
-- Extends `workflows` with the fields needed to host both legacy Action Engine
-- "tools" (kind='tool') and Visual Flow Builder flows (kind='flow') in a
-- single table.
--
-- This migration is RUNTIME-NEUTRAL: no code reads these new columns yet.
-- Old code keeps reading from `tool_configs`; new code (SEED-025 Phase B)
-- will read from `workflows WHERE kind='tool'`.
-- =============================================================================

ALTER TABLE public.workflows
  ADD COLUMN IF NOT EXISTS kind                  text        NOT NULL DEFAULT 'flow'
    CHECK (kind IN ('flow', 'tool')),
  ADD COLUMN IF NOT EXISTS tool_name             text,
  ADD COLUMN IF NOT EXISTS trigger_type          text        NOT NULL DEFAULT 'manual'
    CHECK (trigger_type IN ('tool_call', 'event', 'schedule', 'manual', 'webhook_url')),
  ADD COLUMN IF NOT EXISTS trigger_config        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS health_blocked        boolean     NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS health_blocked_reason text,
  ADD COLUMN IF NOT EXISTS legacy_tool_config_id uuid;

-- Tool names are unique within an org for `kind='tool'` workflows (the rule
-- that webhook callers rely on to resolve a tool by name).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_workflows_org_tool_name
  ON public.workflows (org_id, tool_name)
  WHERE kind = 'tool' AND tool_name IS NOT NULL;

-- Fast lookup paths the resolver will use in Phase B.
CREATE INDEX IF NOT EXISTS idx_workflows_kind
  ON public.workflows (org_id, kind);

CREATE INDEX IF NOT EXISTS idx_workflows_trigger_type
  ON public.workflows (org_id, trigger_type)
  WHERE health_blocked = false;

CREATE INDEX IF NOT EXISTS idx_workflows_legacy_tool_config_id
  ON public.workflows (legacy_tool_config_id)
  WHERE legacy_tool_config_id IS NOT NULL;

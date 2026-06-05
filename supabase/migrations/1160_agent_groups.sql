-- Migration 1160: Agent groups (folders) for the Agents sub-sidebar tree.
-- Port of 1044_project_folders.sql / 100_workflow_folders.sql for the agents module.
-- Agents have no trash/archive lifecycle of their own (they use is_active), so we
-- only add group linkage + ordering — NO archived_at/deleted_at columns.

CREATE TABLE IF NOT EXISTS agent_groups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  color       TEXT,                       -- optional hex, e.g. '#6366F1'
  icon        TEXT,                       -- optional emoji or image URL
  parent_id   UUID REFERENCES agent_groups(id) ON DELETE CASCADE,
  position    INTEGER NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES auth.users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, parent_id, name)
);

ALTER TABLE agent_groups ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_groups org members" ON agent_groups;
CREATE POLICY "agent_groups org members"
  ON agent_groups
  USING (org_id = get_current_org_id())
  WITH CHECK (org_id = get_current_org_id());

CREATE INDEX IF NOT EXISTS agent_groups_org_parent_idx
  ON agent_groups(org_id, parent_id);

-- Extend agents with group linkage + ordering.
-- group_id is ON DELETE SET NULL: deleting a group UNFILES its agents (they fall
-- back to "Unfiled", still active) rather than deleting/deactivating them.
ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS group_id UUID REFERENCES agent_groups(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS position INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS agents_group_idx
  ON public.agents(group_id);

-- Keep updated_at fresh on group rows.
CREATE OR REPLACE FUNCTION touch_agent_group_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_agent_groups_touch ON agent_groups;
CREATE TRIGGER trg_agent_groups_touch
  BEFORE UPDATE ON agent_groups
  FOR EACH ROW
  EXECUTE FUNCTION touch_agent_group_updated_at();

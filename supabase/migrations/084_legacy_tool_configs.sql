-- Migration 084: Retire tool_configs → _legacy_tool_configs (SEED-025 Phase F)
--
-- All new workflows live in the `workflows` table (since migration 082 backfill).
-- tool_configs is now read-only data; app code no longer writes to it.
-- Renaming to _legacy_tool_configs signals that it is frozen and will be
-- dropped in a future migration once all read paths confirm the data is
-- safely mirrored.
--
-- FK constraints from action_logs, manychat_rules, meta_channels, ghl_channels,
-- and agent_tools all reference tool_configs by OID — they survive the rename
-- automatically in PostgreSQL.
--
-- The agent_tools_resolved VIEW stores query text with the old table name, so
-- it must be dropped and recreated.

-- 1. Drop the view that references tool_configs by name.
DROP VIEW IF EXISTS agent_tools_resolved;

-- 2. Rename the table.
ALTER TABLE public.tool_configs RENAME TO _legacy_tool_configs;

-- 3. Rename indexes so they stay identifiable.
ALTER INDEX IF EXISTS idx_tool_configs_org_id    RENAME TO idx_legacy_tool_configs_org_id;
ALTER INDEX IF EXISTS idx_tool_configs_org_tool  RENAME TO idx_legacy_tool_configs_org_tool;
ALTER INDEX IF EXISTS idx_tool_configs_folder    RENAME TO idx_legacy_tool_configs_folder;

-- 4. Recreate the unified view using the renamed table.
CREATE OR REPLACE VIEW agent_tools_resolved AS
SELECT
  at.id,
  at.organization_id,
  at.agent_id,
  at.allowed_channels,
  at.created_at,
  'tool_config'::text AS source,
  tc.tool_name,
  tc.action_type::text AS action_type,
  tc.config,
  tc.is_active,
  tc.id AS source_id,
  NULL::uuid AS workflow_id,
  NULL::text AS workflow_kind
FROM agent_tools at
JOIN _legacy_tool_configs tc ON tc.id = at.tool_config_id
WHERE at.tool_config_id IS NOT NULL

UNION ALL

SELECT
  at.id,
  at.organization_id,
  at.agent_id,
  at.allowed_channels,
  at.created_at,
  'workflow'::text AS source,
  w.tool_name,
  w.kind::text AS action_type,
  COALESCE(wv.definition, '{}'::jsonb) AS config,
  (w.is_active AND NOT w.health_blocked) AS is_active,
  w.id AS source_id,
  w.id AS workflow_id,
  w.kind::text AS workflow_kind
FROM agent_tools at
JOIN workflows w ON w.id = at.workflow_id
LEFT JOIN workflow_versions wv ON wv.id = w.current_version_id
WHERE at.workflow_id IS NOT NULL;

-- =============================================================================
-- Migration 082: Backfill tool_configs → workflows (SEED-025 Phase A)
-- =============================================================================
-- Every existing `tool_configs` row gets a matching `workflows` row with
-- kind='tool' plus a single-node `workflow_versions` snapshot. Idempotent:
-- safe to re-run (uses legacy_tool_config_id as the dedup key).
--
-- After this migration runs, `workflows WHERE kind='tool'` is a complete
-- mirror of `tool_configs`. The Action Engine still resolves tools from
-- the original table — that switchover happens in SEED-025 Phase B.
-- =============================================================================

DO $$
DECLARE
  tc           record;
  new_wf_id    uuid;
  new_ver_id   uuid;
  derived_slug text;
  flow_def     jsonb;
BEGIN
  FOR tc IN
    SELECT *
    FROM public.tool_configs
    WHERE id NOT IN (
      SELECT legacy_tool_config_id
      FROM public.workflows
      WHERE legacy_tool_config_id IS NOT NULL
    )
  LOOP
    -- Derive a slug from tool_name. tool_name is already UNIQUE per org so
    -- the derived slug will also be unique per org for these migrated rows.
    derived_slug := lower(regexp_replace(tc.tool_name, '[^a-zA-Z0-9]+', '-', 'g'));
    derived_slug := trim(both '-' from derived_slug);
    IF derived_slug = '' THEN
      derived_slug := 'tool-' || substr(tc.id::text, 1, 8);
    END IF;

    -- Construct the 1-node FlowDefinition that represents this tool.
    -- Shape mirrors src/lib/flows/schema.ts (FlowDefinition).
    flow_def := jsonb_build_object(
      'nodes', jsonb_build_array(
        jsonb_build_object(
          'id', 'trigger',
          'type', 'trigger',
          'position', jsonb_build_object('x', 0, 'y', 0),
          'data', jsonb_build_object(
            'kind', 'trigger',
            'event_type', 'tool_call',
            'label', tc.tool_name
          )
        ),
        jsonb_build_object(
          'id', 'action',
          'type', 'action',
          'position', jsonb_build_object('x', 280, 'y', 0),
          'data', jsonb_build_object(
            'kind', 'action',
            'action_type', tc.action_type::text,
            'config', tc.config,
            'credential_ref', tc.integration_id::text,
            'label', tc.action_type::text,
            'fallback_message', tc.fallback_message
          )
        )
      ),
      'edges', jsonb_build_array(
        jsonb_build_object(
          'id', 'trigger->action',
          'source', 'trigger',
          'target', 'action'
        )
      ),
      'variables', jsonb_build_array(),
      'metadata', jsonb_build_object(
        'migrated_from', 'tool_configs',
        'legacy_tool_config_id', tc.id::text,
        'migrated_at', now()
      )
    );

    -- Insert the workflow header. Slug is derived; tool_name and
    -- legacy_tool_config_id let downstream resolvers find this row by either key.
    INSERT INTO public.workflows (
      org_id,
      name,
      slug,
      description,
      is_active,
      kind,
      tool_name,
      trigger_type,
      trigger_config,
      legacy_tool_config_id,
      created_at,
      updated_at
    ) VALUES (
      tc.organization_id,
      tc.tool_name,
      derived_slug,
      'Migrated from Action Engine tool (' || tc.action_type::text || ')',
      tc.is_active,
      'tool',
      tc.tool_name,
      'tool_call',
      jsonb_build_object('tool_name', tc.tool_name),
      tc.id,
      tc.created_at,
      tc.updated_at
    )
    RETURNING id INTO new_wf_id;

    -- Insert the initial workflow_versions snapshot.
    INSERT INTO public.workflow_versions (
      workflow_id,
      version_number,
      definition,
      notes,
      created_at
    ) VALUES (
      new_wf_id,
      1,
      flow_def,
      'Initial backfill from tool_configs (SEED-025 Phase A)',
      tc.created_at
    )
    RETURNING id INTO new_ver_id;

    -- Wire current_version_id on the workflow row.
    UPDATE public.workflows
      SET current_version_id = new_ver_id
      WHERE id = new_wf_id;
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────────
-- Sanity check: every tool_config now has a matching workflow row.
-- ──────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  orphan_count integer;
BEGIN
  SELECT COUNT(*) INTO orphan_count
  FROM public.tool_configs tc
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.workflows w
    WHERE w.legacy_tool_config_id = tc.id
  );

  IF orphan_count > 0 THEN
    RAISE EXCEPTION 'SEED-025 backfill incomplete: % tool_configs still without matching workflow', orphan_count;
  END IF;
END $$;

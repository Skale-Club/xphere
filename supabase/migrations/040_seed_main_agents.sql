-- =============================================================================
-- Migration: 040_seed_main_agents
-- Phase: v2.0 Multi-Bot Platform — Phase 33 Schema Foundation
-- Seeds:   One 'Main Agent' per existing org, byte-identical to v1.4 chat behavior
-- Decisions: D-33-03 (per-org ${orgName} substitution at seed time)
--            D-33-04 (source of truth: src/lib/chat/stream.ts:107)
--            D-33-05 (NULL/empty org name -> literal 'your team')
--            D-33-06 (version=1 row + UPDATE agents.active_prompt_version_id)
--            D-33-07 (grant every active tool_config to the Main Agent; allowed_channels=NULL)
--            D-33-08 (inactive tool_configs NOT granted)
--            D-33-09 (insert agent_channel_defaults(org, 'web_widget', main_agent_id))
--            D-33-10 (other channels get NO default — Phase 36 admin populates)
-- Idempotency: every INSERT uses WHERE NOT EXISTS keyed on (organization_id, name='Main Agent').
--              Safe to re-run; safe to apply to a partially-seeded DB.
-- =============================================================================

-- Pure-SQL DO block: one transaction, deterministic order, no application code.

DO $migration$
DECLARE
  org           RECORD;
  v_agent_id    UUID;
  v_version_id  UUID;
  v_prompt      TEXT;
BEGIN
  FOR org IN
    SELECT id, name
    FROM public.organizations
    ORDER BY created_at ASC
  LOOP
    -- Skip orgs that already have a Main Agent (idempotency)
    IF EXISTS (
      SELECT 1 FROM public.agents
      WHERE organization_id = org.id AND name = 'Main Agent'
    ) THEN
      CONTINUE;
    END IF;

    -- D-33-03/04/05: substitute ${orgName} from org.name; fallback to 'your team'.
    -- Source template (src/lib/chat/stream.ts:107) WITHOUT trailing ${kbContext}
    -- (kbContext is appended at runtime per D-33-03).
    v_prompt := 'You are a helpful assistant for '
             || COALESCE(NULLIF(org.name, ''), 'your team')
             || '. Answer questions accurately and concisely using the provided context. If you don''t know the answer, say so.';

    -- Step 1: INSERT agent (model overrides the haiku default to sonnet, matching v1.4 chat default)
    INSERT INTO public.agents (
      organization_id,
      name,
      slug,
      description,
      system_prompt,
      model,
      is_active,
      allowed_channels
    ) VALUES (
      org.id,
      'Main Agent',
      'main-agent',
      'Legacy default agent — backfilled from v1.4 chat behavior at Phase 33.',
      v_prompt,
      'anthropic/claude-sonnet-4-6',
      true,
      ARRAY['web_widget']::public.agent_channel[]
    )
    RETURNING id INTO v_agent_id;

    -- Step 2: INSERT agent_prompt_versions row (version=1) per D-33-06
    INSERT INTO public.agent_prompt_versions (
      organization_id,
      agent_id,
      version,
      system_prompt
    ) VALUES (
      org.id,
      v_agent_id,
      1,
      v_prompt
    )
    RETURNING id INTO v_version_id;

    -- Step 3: UPDATE agents.active_prompt_version_id to close the chicken-and-egg cycle (D-33-06)
    UPDATE public.agents
      SET active_prompt_version_id = v_version_id
      WHERE id = v_agent_id;

    -- Step 4: INSERT agent_tools rows for every ACTIVE tool_config owned by this org (D-33-07, D-33-08)
    -- allowed_channels=NULL means "all channels" (preserves v1.4 behavior — chat had access to all org tools)
    INSERT INTO public.agent_tools (organization_id, agent_id, tool_config_id, allowed_channels)
    SELECT
      tc.organization_id,
      v_agent_id,
      tc.id,
      NULL
    FROM public.tool_configs tc
    WHERE tc.organization_id = org.id
      AND tc.is_active = true
    ON CONFLICT (agent_id, tool_config_id) DO NOTHING;

    -- Step 5: INSERT agent_channel_defaults row for web_widget (D-33-09)
    INSERT INTO public.agent_channel_defaults (organization_id, channel, agent_id)
    VALUES (org.id, 'web_widget', v_agent_id)
    ON CONFLICT (organization_id, channel) DO NOTHING;

    RAISE NOTICE 'Seeded Main Agent for org % (id=%)', COALESCE(org.name, '<NULL>'), org.id;
  END LOOP;
END
$migration$;

COMMENT ON TABLE public.agents IS
  'Phase 33 (v2.0): first-class chat agent entity. Per-org. Text channels only — Vapi voice unchanged. Audit fields per AGENT-09. Migration 040 seeds one ''Main Agent'' per existing org backfilling v1.4 chat behavior.';

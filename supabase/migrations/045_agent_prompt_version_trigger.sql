-- =============================================================================
-- Migration: 045_agent_prompt_version_trigger
-- Phase: 41 — Prompt Versioning UX
-- Creates: DB trigger to auto-snapshot agents.system_prompt on UPDATE
-- Decision: D-33-16 (deferred from Phase 33 — lands here as planned)
-- =============================================================================

-- Helper function: compute next version number per agent
CREATE OR REPLACE FUNCTION public.next_agent_prompt_version(p_agent_id UUID)
  RETURNS INTEGER
  LANGUAGE sql
  STABLE
  SECURITY DEFINER
  SET search_path = public
AS $$
  SELECT COALESCE(MAX(version), 0) + 1
  FROM public.agent_prompt_versions
  WHERE agent_id = p_agent_id;
$$;

-- Trigger function: insert version row when system_prompt changes
CREATE OR REPLACE FUNCTION public.trg_agent_prompt_version_snapshot()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
AS $$
DECLARE
  v_version INTEGER;
BEGIN
  -- Only fire when system_prompt actually changed
  IF NEW.system_prompt IS NOT DISTINCT FROM OLD.system_prompt THEN
    RETURN NEW;
  END IF;

  -- Compute next version atomically (UNIQUE constraint on (agent_id, version) is the safety net)
  v_version := public.next_agent_prompt_version(NEW.id);

  INSERT INTO public.agent_prompt_versions (
    organization_id,
    agent_id,
    version,
    system_prompt,
    created_by,
    created_at
  ) VALUES (
    NEW.organization_id,
    NEW.id,
    v_version,
    NEW.system_prompt,
    NEW.updated_by,   -- set by server action before UPDATE
    now()
  );

  RETURN NEW;
END;
$$;

-- Drop if exists to allow idempotent re-run
DROP TRIGGER IF EXISTS trg_agent_prompt_version_snapshot ON public.agents;

CREATE TRIGGER trg_agent_prompt_version_snapshot
  AFTER UPDATE OF system_prompt ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_agent_prompt_version_snapshot();

COMMENT ON TRIGGER trg_agent_prompt_version_snapshot ON public.agents IS
  'Phase 41: auto-snapshot system_prompt into agent_prompt_versions on every UPDATE (D-33-16).';

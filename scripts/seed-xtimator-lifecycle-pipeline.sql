-- =============================================================================
-- One-off seed: "Xtimator Lifecycle" pipeline for the Xtimator org.
--
-- Already seeded in prod: the "Xtimator Lifecycle" pipeline exists and the
-- integration is live. Kept for reference / re-provisioning; safe to re-run
-- (idempotent — see below). Depends on migration 1237 (renumbered from 1213).
-- Creates the dedicated subscription-lifecycle pipeline that
-- POST /api/xtimator/webhook resolves by name. The org's existing generic
-- "Sales" pipeline is left untouched (stays the default).
--
-- Stage names MUST match exactly (incl. the em dash "—") — the webhook and the
-- Xtimator mapping.ts both reference these literals.
--
-- Idempotent: re-running is a no-op once the pipeline exists.
-- =============================================================================

DO $$
DECLARE
  v_org      uuid := 'aa2af131-ded1-454c-a404-cfc39fb34cba'; -- Xtimator org
  v_pipeline uuid;
BEGIN
  SELECT id INTO v_pipeline
    FROM public.pipelines
   WHERE org_id = v_org AND name = 'Xtimator Lifecycle'
   LIMIT 1;

  IF v_pipeline IS NULL THEN
    INSERT INTO public.pipelines (org_id, name, is_default, position)
    VALUES (v_org, 'Xtimator Lifecycle', false, 1)
    RETURNING id INTO v_pipeline;

    INSERT INTO public.pipeline_stages
      (pipeline_id, org_id, name, position, color, is_won, is_lost)
    VALUES
      (v_pipeline, v_org, 'Trial',             0, '#6366F1', false, false),
      (v_pipeline, v_org, 'Active — Pro',      1, '#10B981', true,  false),
      (v_pipeline, v_org, 'Active — Business', 2, '#059669', true,  false),
      (v_pipeline, v_org, 'Churned',           3, '#EF4444', false, true);
  END IF;
END $$;

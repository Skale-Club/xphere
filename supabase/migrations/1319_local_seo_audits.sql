-- =============================================================================
-- Migration 1319: Local SEO audits
-- =============================================================================
-- Phase 5 of .planning/local-seo/SPEC.md. One row per audit run: the overall
-- score, a score per pillar (profile, reviews, website, visibility,
-- competition) and every check with its Good/OK/Poor verdict, explanation
-- and suggested action. Keeping each run makes the score a trend.
--
-- Written by the server after the local_seo.manage check; users read.
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.local_seo_audits (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id       UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  score             INTEGER     NOT NULL CHECK (score BETWEEN 0 AND 100),
  pillar_scores     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  checks            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  -- Inputs worth showing later (website fetch result, competitor baseline).
  context           JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_by        UUID,
  tasks_created_at  TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_seo_audits_location
  ON public.local_seo_audits (location_id, created_at DESC);

ALTER TABLE public.local_seo_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.local_seo_audits;
CREATE POLICY "org_read" ON public.local_seo_audits
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

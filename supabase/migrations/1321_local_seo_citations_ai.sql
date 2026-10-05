-- =============================================================================
-- Migration 1321: Local SEO citations (NAP) and AI visibility
-- =============================================================================
-- Phase 7 of .planning/local-seo/SPEC.md, option B (own lightweight check;
-- the BrightLocal API stays a later option).
--
--   local_seo_citation_checks  one row per directory per check: was the
--                              business found there, at which URL, and do
--                              name / address / phone match the profile
--   local_seo_ai_checks        one row per (prompt, model) run: did an AI
--                              assistant with web search mention the
--                              business, at which position, plus a short
--                              excerpt of the answer
--
-- Server-written (they spend provider credits); users read.
-- Idempotent.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.local_seo_citation_checks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id  UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  run_id       UUID        NOT NULL,
  directory    TEXT        NOT NULL,
  domain       TEXT        NOT NULL,
  found        BOOLEAN     NOT NULL DEFAULT false,
  url          TEXT,
  listed_name  TEXT,
  snippet      TEXT,
  name_match   BOOLEAN,
  phone_match  BOOLEAN,
  address_match BOOLEAN,
  error        TEXT,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_seo_citation_checks_location
  ON public.local_seo_citation_checks (location_id, checked_at DESC);

ALTER TABLE public.local_seo_citation_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.local_seo_citation_checks;
CREATE POLICY "org_read" ON public.local_seo_citation_checks
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

CREATE TABLE IF NOT EXISTS public.local_seo_ai_checks (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id  UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  run_id       UUID        NOT NULL,
  prompt       TEXT        NOT NULL,
  model        TEXT        NOT NULL,
  mentioned    BOOLEAN     NOT NULL DEFAULT false,
  -- 1-based position among the businesses the answer listed, when found.
  position     INTEGER,
  competitors  TEXT[]      NOT NULL DEFAULT '{}',
  excerpt      TEXT,
  error        TEXT,
  checked_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_seo_ai_checks_location
  ON public.local_seo_ai_checks (location_id, checked_at DESC);

ALTER TABLE public.local_seo_ai_checks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.local_seo_ai_checks;
CREATE POLICY "org_read" ON public.local_seo_ai_checks
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

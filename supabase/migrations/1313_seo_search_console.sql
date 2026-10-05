-- 1313_seo_search_console.sql
--
-- SEO module, phase 2: Google Search Console.
-- Spec: .planning/seo-module/SPEC.md (Fase 2, decision D2).
--
-- * integration_provider gains 'google_search_console'. Without the enum value
--   the OAuth callback's upsert fails silently (the 1253 google_calendar bug).
-- * seo_sites gains the linked GSC property and its sync bookkeeping.
--   gsc_next_sync_at doubles as the sync lease: claim_gsc_syncs() pushes it
--   30 minutes out, the job sets it to ~a day out on success.
-- * seo_gsc_daily: clicks/impressions/CTR/position per day and device —
--   16 months of history is ~1,500 rows per site.
-- * seo_gsc_top: top 500 queries and pages for a rolling 28-day window,
--   snapshotted weekly, kept 26 weeks (prune_seo_gsc_top).
--
-- Writes come only from the cron (service role). Idempotent: safe to re-run.

ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'google_search_console';

ALTER TABLE public.seo_sites
  ADD COLUMN IF NOT EXISTS gsc_property      TEXT,
  ADD COLUMN IF NOT EXISTS gsc_next_sync_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gsc_synced_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gsc_backfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gsc_last_error    TEXT;

CREATE INDEX IF NOT EXISTS idx_seo_sites_gsc_due
  ON public.seo_sites(gsc_next_sync_at) WHERE gsc_property IS NOT NULL;

-- ---------------------------------------------------------------------------
-- seo_gsc_daily
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_gsc_daily (
  org_id       UUID     NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id      UUID     NOT NULL REFERENCES public.seo_sites(id) ON DELETE CASCADE,
  date         DATE     NOT NULL,
  device       TEXT     NOT NULL CHECK (device IN ('desktop', 'mobile', 'tablet')),
  clicks       INTEGER  NOT NULL DEFAULT 0,
  impressions  INTEGER  NOT NULL DEFAULT 0,
  ctr          REAL     NOT NULL DEFAULT 0,
  position     REAL     NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, date, device)
);

CREATE INDEX IF NOT EXISTS idx_seo_gsc_daily_org ON public.seo_gsc_daily(org_id);

ALTER TABLE public.seo_gsc_daily ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_read" ON public.seo_gsc_daily;
CREATE POLICY "org_read" ON public.seo_gsc_daily
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- seo_gsc_top
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_gsc_top (
  id           UUID     PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID     NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id      UUID     NOT NULL REFERENCES public.seo_sites(id) ON DELETE CASCADE,
  window_end   DATE     NOT NULL,
  dimension    TEXT     NOT NULL CHECK (dimension IN ('query', 'page')),
  key          TEXT     NOT NULL,
  clicks       INTEGER  NOT NULL DEFAULT 0,
  impressions  INTEGER  NOT NULL DEFAULT 0,
  ctr          REAL     NOT NULL DEFAULT 0,
  position     REAL     NOT NULL DEFAULT 0,
  UNIQUE (site_id, window_end, dimension, key)
);

CREATE INDEX IF NOT EXISTS idx_seo_gsc_top_site_window
  ON public.seo_gsc_top(site_id, dimension, window_end DESC);
CREATE INDEX IF NOT EXISTS idx_seo_gsc_top_org ON public.seo_gsc_top(org_id);

ALTER TABLE public.seo_gsc_top ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_read" ON public.seo_gsc_top;
CREATE POLICY "org_read" ON public.seo_gsc_top
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- claim_gsc_syncs: lease sites whose Search Console data is due
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_gsc_syncs(p_limit INTEGER)
RETURNS SETOF public.seo_sites
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH due AS (
    SELECT id
    FROM public.seo_sites
    WHERE gsc_property IS NOT NULL
      AND (gsc_next_sync_at IS NULL OR gsc_next_sync_at <= NOW())
    ORDER BY gsc_next_sync_at NULLS FIRST
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.seo_sites s
  SET gsc_next_sync_at = NOW() + INTERVAL '30 minutes'
  FROM due
  WHERE s.id = due.id
  RETURNING s.*;
$$;

-- ---------------------------------------------------------------------------
-- prune_seo_gsc_top: keep 26 weeks of top-query/page snapshots
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.prune_seo_gsc_top()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  DELETE FROM public.seo_gsc_top WHERE window_end < (CURRENT_DATE - INTERVAL '26 weeks');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_gsc_syncs(INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_seo_gsc_top() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_gsc_syncs(INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_seo_gsc_top() TO service_role;

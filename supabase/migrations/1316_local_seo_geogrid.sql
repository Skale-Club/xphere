-- =============================================================================
-- Migration 1316: Local SEO geogrid — scans, points, SERP results, competitors
-- =============================================================================
-- Phase 1 of .planning/local-seo/SPEC.md. A geogrid scan asks a Maps SERP
-- provider "what ranks for <keyword>" from every point of a grid laid over a
-- location, and records where the business (and everyone else) shows up.
--
--   local_seo_scans                 one scan = one keyword x one grid, with the
--                                   aggregated metrics (ARP/ATRP/SoLV/found%)
--   local_seo_scan_points           one row per grid point; the work queue
--   local_seo_serp_results          top 20 per point; pruned after 60 days
--                                   (Supabase Free plan — see SPEC 4.5)
--   local_seo_competitor_snapshots  per-scan competitor aggregate; small and
--                                   kept forever, so trends survive pruning
--
-- Queue: claim_local_seo_points() hands out queued points with
-- FOR UPDATE SKIP LOCKED so overlapping ticks never double-fetch a point.
-- Point lifecycle: queued -> in_flight -> done | failed (in_flight -> queued on
-- a transient error, until attempts run out).
--
-- Write model: everything here is written by the worker with the service-role
-- client; authenticated users get SELECT only.
--
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS throughout.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- local_seo_scans
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_scans (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id        UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  keyword_id         UUID        REFERENCES public.local_seo_keywords(id) ON DELETE SET NULL,
  -- Snapshot of the search, so a deleted/renamed keyword keeps its history.
  keyword            TEXT        NOT NULL,
  language           TEXT        NOT NULL,
  country            TEXT        NOT NULL,
  schedule_id        UUID,
  provider           TEXT        NOT NULL CHECK (provider IN ('dataforseo', 'serpapi', 'fake')),
  provider_mode      TEXT        NOT NULL CHECK (provider_mode IN ('sync', 'async')),
  grid_size          INTEGER     NOT NULL CHECK (grid_size IN (3, 5, 7, 9, 11, 13)),
  spacing_m          INTEGER     NOT NULL CHECK (spacing_m BETWEEN 100 AND 20000),
  shape              TEXT        NOT NULL CHECK (shape IN ('square', 'circle')),
  zoom               INTEGER     NOT NULL DEFAULT 13,
  depth              INTEGER     NOT NULL DEFAULT 20,
  center_lat         DOUBLE PRECISION NOT NULL,
  center_lng         DOUBLE PRECISION NOT NULL,
  -- Hash of everything that changes what a point "sees". Only scans sharing it
  -- are compared against each other.
  comparable_key     TEXT        NOT NULL,
  status             TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN (
                       'queued', 'running', 'partial', 'completed', 'failed', 'cancelled')),
  points_total       INTEGER     NOT NULL DEFAULT 0,
  points_done        INTEGER     NOT NULL DEFAULT 0,
  points_failed      INTEGER     NOT NULL DEFAULT 0,
  arp                NUMERIC(5, 2),
  atrp               NUMERIC(5, 2),
  solv               NUMERIC(5, 2),
  found_pct          NUMERIC(5, 2),
  est_cost_usd       NUMERIC(12, 6) NOT NULL DEFAULT 0,
  cost_usd           NUMERIC(12, 6),
  triggered_by       TEXT        NOT NULL CHECK (triggered_by IN ('manual', 'schedule', 'workflow', 'mcp')),
  triggered_by_user  UUID,
  error              TEXT,
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_seo_scans_location
  ON public.local_seo_scans (org_id, location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS local_seo_scans_keyword
  ON public.local_seo_scans (keyword_id, created_at DESC);
CREATE INDEX IF NOT EXISTS local_seo_scans_comparable
  ON public.local_seo_scans (location_id, comparable_key, created_at DESC);
CREATE INDEX IF NOT EXISTS local_seo_scans_open
  ON public.local_seo_scans (created_at) WHERE status IN ('queued', 'running');

ALTER TABLE public.local_seo_scans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.local_seo_scans;
CREATE POLICY "org_read" ON public.local_seo_scans
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- The usage ledger (1315) predates this table; attach its FK now.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'local_seo_usage_ledger_scan_fk'
  ) THEN
    ALTER TABLE public.local_seo_usage_ledger
      ADD CONSTRAINT local_seo_usage_ledger_scan_fk
      FOREIGN KEY (scan_id) REFERENCES public.local_seo_scans(id) ON DELETE SET NULL;
  END IF;
END $$;

-- -----------------------------------------------------------------------------
-- local_seo_scan_points (the work queue)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_scan_points (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scan_id           UUID        NOT NULL REFERENCES public.local_seo_scans(id) ON DELETE CASCADE,
  row_idx           INTEGER     NOT NULL,
  col_idx           INTEGER     NOT NULL,
  lat               DOUBLE PRECISION NOT NULL,
  lng               DOUBLE PRECISION NOT NULL,
  status            TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'in_flight', 'done', 'failed')),
  -- 1..depth when the business was found; NULL = not in the results ("20+").
  rank              INTEGER,
  match_method      TEXT        CHECK (match_method IN ('place_id', 'cid', 'name')),
  -- Top 3 of this point, kept after the full results are pruned.
  top3              JSONB,
  results_count     INTEGER,
  provider_task_id  TEXT,
  attempts          INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at        TIMESTAMPTZ,
  last_error        TEXT,
  cost_usd          NUMERIC(12, 6),
  fetched_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, row_idx, col_idx)
);

CREATE UNIQUE INDEX IF NOT EXISTS local_seo_scan_points_task
  ON public.local_seo_scan_points (provider_task_id) WHERE provider_task_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS local_seo_scan_points_queue
  ON public.local_seo_scan_points (next_attempt_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS local_seo_scan_points_in_flight
  ON public.local_seo_scan_points (claimed_at) WHERE status = 'in_flight';
CREATE INDEX IF NOT EXISTS local_seo_scan_points_scan
  ON public.local_seo_scan_points (scan_id);

ALTER TABLE public.local_seo_scan_points ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.local_seo_scan_points;
CREATE POLICY "org_read" ON public.local_seo_scan_points
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- local_seo_serp_results (retention: 60 days)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_serp_results (
  id          BIGSERIAL   PRIMARY KEY,
  org_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scan_id     UUID        NOT NULL REFERENCES public.local_seo_scans(id) ON DELETE CASCADE,
  point_id    UUID        NOT NULL REFERENCES public.local_seo_scan_points(id) ON DELETE CASCADE,
  position    INTEGER     NOT NULL,
  place_id    TEXT,
  cid         TEXT,
  title       TEXT        NOT NULL,
  rating      NUMERIC(2, 1),
  reviews     INTEGER,
  category    TEXT,
  address     TEXT,
  is_target   BOOLEAN     NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_seo_serp_results_point
  ON public.local_seo_serp_results (point_id, position);
CREATE INDEX IF NOT EXISTS local_seo_serp_results_scan
  ON public.local_seo_serp_results (scan_id);
CREATE INDEX IF NOT EXISTS local_seo_serp_results_created
  ON public.local_seo_serp_results (created_at);

ALTER TABLE public.local_seo_serp_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.local_seo_serp_results;
CREATE POLICY "org_read" ON public.local_seo_serp_results
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- local_seo_competitor_snapshots (permanent, one row per competitor per scan)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_competitor_snapshots (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scan_id      UUID        NOT NULL REFERENCES public.local_seo_scans(id) ON DELETE CASCADE,
  location_id  UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  keyword_id   UUID        REFERENCES public.local_seo_keywords(id) ON DELETE SET NULL,
  -- place_id when the provider gave one, otherwise a normalised-title key.
  competitor_key TEXT      NOT NULL,
  place_id     TEXT,
  title        TEXT        NOT NULL,
  is_target    BOOLEAN     NOT NULL DEFAULT false,
  appearances  INTEGER     NOT NULL,
  avg_rank     NUMERIC(5, 2),
  solv         NUMERIC(5, 2),
  rating       NUMERIC(2, 1),
  reviews      INTEGER,
  category     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (scan_id, competitor_key)
);

CREATE INDEX IF NOT EXISTS local_seo_competitor_snapshots_location
  ON public.local_seo_competitor_snapshots (location_id, created_at DESC);

ALTER TABLE public.local_seo_competitor_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.local_seo_competitor_snapshots;
CREATE POLICY "org_read" ON public.local_seo_competitor_snapshots
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- claim_local_seo_points: hand out due points to one worker tick
-- -----------------------------------------------------------------------------
-- Server-only (service role), like every queue claimer since 1311. Marks the
-- claimed rows in_flight and bumps attempts in the same statement, so a tick
-- that dies mid-flight leaves rows the reaper can find by claimed_at.
CREATE OR REPLACE FUNCTION public.claim_local_seo_points(p_limit integer)
RETURNS SETOF public.local_seo_scan_points
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $func$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT p.id
      FROM public.local_seo_scan_points p
      JOIN public.local_seo_scans s ON s.id = p.scan_id
     WHERE p.status = 'queued'
       AND p.next_attempt_at <= now()
       AND s.status IN ('queued', 'running')
     ORDER BY p.next_attempt_at, p.scan_id, p.row_idx, p.col_idx
     LIMIT greatest(p_limit, 0)
     FOR UPDATE OF p SKIP LOCKED
  )
  UPDATE public.local_seo_scan_points p
     SET status = 'in_flight',
         claimed_at = now(),
         attempts = p.attempts + 1
    FROM due
   WHERE p.id = due.id
  RETURNING p.*;
END;
$func$;

REVOKE EXECUTE ON FUNCTION public.claim_local_seo_points(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_local_seo_points(integer) TO service_role;

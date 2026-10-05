-- 1312_seo_module.sql
--
-- SEO module, phase 1: sites, technical audits, crawled pages and issues.
-- Spec: .planning/seo-module/SPEC.md
--
-- Execution model: an audit is a resumable job driven by /api/cron/seo-tick.
-- The crawl frontier lives in seo_audit_pages (status = 'queued'), so a deploy
-- that kills a tick loses nothing: the audit's lease expires and the next tick
-- claims it and carries on. claim_seo_audits() is that lease — there is no
-- separate "reclaim stale" step, an expired lease IS the reclaim.
--
-- Writes to pages/issues come only from the cron (service role). Members read
-- them through RLS and create sites/audits through server actions.
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- seo_sites: one row per website an org audits
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_sites (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name             TEXT        NOT NULL,
  root_url         TEXT        NOT NULL,
  host             TEXT        NOT NULL,
  crawl_max_pages  INTEGER     NOT NULL DEFAULT 200 CHECK (crawl_max_pages BETWEEN 1 AND 5000),
  audit_schedule   TEXT        NOT NULL DEFAULT 'weekly' CHECK (audit_schedule IN ('off', 'weekly', 'monthly')),
  next_audit_at    TIMESTAMPTZ,
  created_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (org_id, host)
);

CREATE INDEX IF NOT EXISTS idx_seo_sites_next_audit
  ON public.seo_sites(next_audit_at) WHERE audit_schedule <> 'off';

ALTER TABLE public.seo_sites ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_isolation" ON public.seo_sites;
CREATE POLICY "org_isolation" ON public.seo_sites
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS seo_sites_updated_at ON public.seo_sites;
CREATE TRIGGER seo_sites_updated_at
  BEFORE UPDATE ON public.seo_sites
  FOR EACH ROW EXECUTE FUNCTION public.trigger_update_updated_at();

-- ---------------------------------------------------------------------------
-- seo_audits: one crawl + analysis run of a site
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_audits (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  site_id            UUID        NOT NULL REFERENCES public.seo_sites(id) ON DELETE CASCADE,
  status             TEXT        NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'running', 'completed', 'failed')),
  -- running audits: 'setup' (robots/sitemap/probes) → 'crawl' → 'finalize'
  stage              TEXT        NOT NULL DEFAULT 'setup' CHECK (stage IN ('setup', 'crawl', 'finalize', 'done')),
  trigger            TEXT        NOT NULL DEFAULT 'manual' CHECK (trigger IN ('manual', 'schedule', 'workflow', 'mcp')),
  max_pages          INTEGER     NOT NULL DEFAULT 200,
  pages_discovered   INTEGER     NOT NULL DEFAULT 0,
  pages_crawled      INTEGER     NOT NULL DEFAULT 0,
  health_score       SMALLINT    CHECK (health_score BETWEEN 0 AND 100),
  summary            JSONB,
  site_checks        JSONB       NOT NULL DEFAULT '{}'::jsonb,
  -- Full sitemap URL set while crawling (marks link-discovered pages as
  -- in_sitemap). Cleared when the audit finishes.
  sitemap_urls       TEXT[],
  attempts           INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at    TIMESTAMPTZ,
  lease_expires_at   TIMESTAMPTZ,
  last_tick_at       TIMESTAMPTZ,
  error_message      TEXT,
  details_pruned_at  TIMESTAMPTZ,
  created_by         UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  started_at         TIMESTAMPTZ,
  finished_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one active audit per site: double-clicks and schedule/manual races
-- collapse into the existing run.
CREATE UNIQUE INDEX IF NOT EXISTS idx_seo_audits_site_active
  ON public.seo_audits(site_id) WHERE status IN ('pending', 'running');
CREATE INDEX IF NOT EXISTS idx_seo_audits_site_created
  ON public.seo_audits(site_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seo_audits_org
  ON public.seo_audits(org_id);
CREATE INDEX IF NOT EXISTS idx_seo_audits_claimable
  ON public.seo_audits(last_tick_at NULLS FIRST, created_at) WHERE status IN ('pending', 'running');

ALTER TABLE public.seo_audits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_isolation" ON public.seo_audits;
CREATE POLICY "org_isolation" ON public.seo_audits
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS seo_audits_updated_at ON public.seo_audits;
CREATE TRIGGER seo_audits_updated_at
  BEFORE UPDATE ON public.seo_audits
  FOR EACH ROW EXECUTE FUNCTION public.trigger_update_updated_at();

-- ---------------------------------------------------------------------------
-- seo_audit_pages: the crawl frontier and its results
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_audit_pages (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  audit_id          UUID        NOT NULL REFERENCES public.seo_audits(id) ON DELETE CASCADE,
  url               TEXT        NOT NULL,
  depth             SMALLINT    NOT NULL DEFAULT 0,
  status            TEXT        NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'fetched', 'failed', 'skipped')),
  in_sitemap        BOOLEAN     NOT NULL DEFAULT false,
  http_status       SMALLINT,
  redirect_to       TEXT,
  redirect_hops     SMALLINT    NOT NULL DEFAULT 0,
  ttfb_ms           INTEGER,
  content_type      TEXT,
  bytes             INTEGER,
  title             TEXT,
  meta_description  TEXT,
  h1                TEXT,
  h1_count          SMALLINT,
  word_count        INTEGER,
  canonical         TEXT,
  indexable         BOOLEAN,
  content_hash      TEXT,
  -- Normalised internal links on the page (the link graph for cross-page checks).
  links             TEXT[],
  inlinks           INTEGER,
  outlinks          INTEGER,
  error             TEXT,
  fetched_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (audit_id, url)
);

CREATE INDEX IF NOT EXISTS idx_seo_audit_pages_frontier
  ON public.seo_audit_pages(audit_id, depth, created_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_seo_audit_pages_org
  ON public.seo_audit_pages(org_id);

ALTER TABLE public.seo_audit_pages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_read" ON public.seo_audit_pages;
CREATE POLICY "org_read" ON public.seo_audit_pages
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- seo_audit_issues: one row per (issue code, page) — page_id NULL = site-wide
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.seo_audit_issues (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  audit_id    UUID        NOT NULL REFERENCES public.seo_audits(id) ON DELETE CASCADE,
  page_id     UUID        REFERENCES public.seo_audit_pages(id) ON DELETE CASCADE,
  url         TEXT,
  code        TEXT        NOT NULL,
  severity    TEXT        NOT NULL CHECK (severity IN ('error', 'warning', 'notice')),
  -- 'page' = raised when the page was fetched; 'final' = raised by the
  -- cross-page/site pass (replaced wholesale if finalisation re-runs).
  source      TEXT        NOT NULL DEFAULT 'page' CHECK (source IN ('page', 'final')),
  details     JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_seo_audit_issues_audit_code
  ON public.seo_audit_issues(audit_id, code);
CREATE INDEX IF NOT EXISTS idx_seo_audit_issues_page
  ON public.seo_audit_issues(page_id);
CREATE INDEX IF NOT EXISTS idx_seo_audit_issues_org
  ON public.seo_audit_issues(org_id);

ALTER TABLE public.seo_audit_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org_read" ON public.seo_audit_issues;
CREATE POLICY "org_read" ON public.seo_audit_issues
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- ---------------------------------------------------------------------------
-- claim_seo_audits: lease up to p_limit runnable audits for this tick
-- ---------------------------------------------------------------------------
-- Least-recently-worked first (last_tick_at), so concurrent audits from
-- different orgs advance round-robin instead of one big site starving others.
CREATE OR REPLACE FUNCTION public.claim_seo_audits(p_limit INTEGER, p_lease_seconds INTEGER)
RETURNS SETOF public.seo_audits
LANGUAGE sql
SET search_path = public, pg_temp
AS $$
  WITH claimable AS (
    SELECT id
    FROM public.seo_audits
    WHERE status IN ('pending', 'running')
      AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
      AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
    ORDER BY last_tick_at NULLS FIRST, created_at
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.seo_audits a
  SET status = 'running',
      started_at = COALESCE(a.started_at, NOW()),
      lease_expires_at = NOW() + make_interval(secs => p_lease_seconds),
      last_tick_at = NOW()
  FROM claimable
  WHERE a.id = claimable.id
  RETURNING a.*;
$$;

-- ---------------------------------------------------------------------------
-- enqueue_due_seo_audits: create scheduled audits whose time has come
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_due_seo_audits()
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  WITH due AS (
    SELECT id, org_id, crawl_max_pages, audit_schedule
    FROM public.seo_sites
    WHERE audit_schedule <> 'off'
      AND next_audit_at IS NOT NULL
      AND next_audit_at <= NOW()
    FOR UPDATE SKIP LOCKED
  ),
  bumped AS (
    UPDATE public.seo_sites s
    SET next_audit_at = NOW() + CASE due.audit_schedule WHEN 'monthly' THEN INTERVAL '30 days' ELSE INTERVAL '7 days' END
    FROM due
    WHERE s.id = due.id
    RETURNING s.id
  ),
  inserted AS (
    INSERT INTO public.seo_audits (org_id, site_id, trigger, max_pages)
    SELECT due.org_id, due.id, 'schedule', due.crawl_max_pages
    FROM due
    JOIN bumped ON bumped.id = due.id
    ON CONFLICT (site_id) WHERE status IN ('pending', 'running') DO NOTHING
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;
  RETURN v_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- prune_seo_audit_details: retention for the Supabase Free budget
-- ---------------------------------------------------------------------------
-- Keeps page/issue detail for the newest p_keep completed audits of each site
-- plus each site's newest audit whatever its status (so a failed run can be
-- inspected). Older audits keep only health_score + summary, which feed the
-- history chart. Works in batches of p_batch audits per call.
CREATE OR REPLACE FUNCTION public.prune_seo_audit_details(p_keep INTEGER DEFAULT 3, p_batch INTEGER DEFAULT 20)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_ids UUID[];
BEGIN
  WITH ranked AS (
    SELECT id, status, details_pruned_at,
           ROW_NUMBER() OVER (PARTITION BY site_id ORDER BY created_at DESC) AS rn_all,
           ROW_NUMBER() OVER (PARTITION BY site_id, (status = 'completed') ORDER BY created_at DESC) AS rn_status
    FROM public.seo_audits
  )
  SELECT ARRAY(
    SELECT id FROM ranked
    WHERE details_pruned_at IS NULL
      AND status IN ('completed', 'failed')
      AND rn_all > 1
      AND NOT (status = 'completed' AND rn_status <= p_keep)
    LIMIT p_batch
  ) INTO v_ids;

  IF COALESCE(array_length(v_ids, 1), 0) = 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.seo_audit_issues WHERE audit_id = ANY (v_ids);
  DELETE FROM public.seo_audit_pages WHERE audit_id = ANY (v_ids);
  UPDATE public.seo_audits SET details_pruned_at = NOW(), sitemap_urls = NULL WHERE id = ANY (v_ids);
  RETURN array_length(v_ids, 1);
END;
$$;

-- Cron-only entry points: no API role may call them (see 1311).
REVOKE EXECUTE ON FUNCTION public.claim_seo_audits(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enqueue_due_seo_audits() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prune_seo_audit_details(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_seo_audits(INTEGER, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.enqueue_due_seo_audits() TO service_role;
GRANT EXECUTE ON FUNCTION public.prune_seo_audit_details(INTEGER, INTEGER) TO service_role;

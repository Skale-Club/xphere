-- =============================================================================
-- Migration 1315: Local SEO foundation — locations, keywords, usage ledger
-- =============================================================================
-- First slice of the Local SEO module (.planning/local-seo/SPEC.md, Phase 0).
--
--   local_seo_locations     the businesses an org tracks on Google Maps. A
--                           location is identified by its Google place_id and
--                           carries the coordinates every geogrid scan is
--                           centred on. Optionally linked to a tenant_location
--                           (the org's own address book) and to a
--                           google_business_profiles row (SerpAPI reviews +
--                           widget).
--   local_seo_keywords      search terms tracked per location.
--   local_seo_usage_ledger  one row per scan charge: points consumed and the
--                           real provider cost. The monthly sum is what the
--                           points quota is checked against.
--
-- Write model:
--   * locations and keywords are operator-owned configuration: authenticated
--     users read and write them through RLS (server actions also gate on the
--     local_seo.manage permission).
--   * the usage ledger is written only by the server (service role) when a
--     scan is created; authenticated users can read it, never forge it.
--
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS throughout.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- local_seo_locations
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_locations (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- Operator-facing label ("Bigode - Downtown"); business_name is the name as
  -- Google shows it, used by the name-based matching fallback.
  name                        TEXT        NOT NULL,
  business_name               TEXT        NOT NULL,
  place_id                    TEXT,
  cid                         TEXT,
  address                     TEXT,
  lat                         DOUBLE PRECISION NOT NULL,
  lng                         DOUBLE PRECISION NOT NULL,
  is_service_area             BOOLEAN     NOT NULL DEFAULT false,
  timezone                    TEXT,
  primary_category            TEXT,
  website_url                 TEXT,
  phone                       TEXT,
  rating                      NUMERIC(2, 1),
  reviews_count               INTEGER,
  -- Default search parameters for scans of this location.
  language                    TEXT        NOT NULL DEFAULT 'en',
  country                     TEXT        NOT NULL DEFAULT 'us',
  default_grid_size           INTEGER     NOT NULL DEFAULT 7 CHECK (default_grid_size IN (3, 5, 7, 9, 11, 13)),
  default_spacing_m           INTEGER     NOT NULL DEFAULT 1000 CHECK (default_spacing_m BETWEEN 100 AND 20000),
  default_shape               TEXT        NOT NULL DEFAULT 'square' CHECK (default_shape IN ('square', 'circle')),
  tenant_location_id          UUID        REFERENCES public.tenant_locations(id) ON DELETE SET NULL,
  google_business_profile_id  UUID        REFERENCES public.google_business_profiles(id) ON DELETE SET NULL,
  -- Filled once the Business Profile API connection lands (Phase 3).
  gbp_location_name           TEXT,
  gbp_connection_id           UUID,
  is_active                   BOOLEAN     NOT NULL DEFAULT true,
  created_by                  UUID,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS local_seo_locations_org_place
  ON public.local_seo_locations (org_id, place_id) WHERE place_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS local_seo_locations_org
  ON public.local_seo_locations (org_id, created_at);

ALTER TABLE public.local_seo_locations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_local_seo_locations" ON public.local_seo_locations;
CREATE POLICY "org_local_seo_locations" ON public.local_seo_locations
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS local_seo_locations_updated_at ON public.local_seo_locations;
CREATE TRIGGER local_seo_locations_updated_at
  BEFORE UPDATE ON public.local_seo_locations
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- -----------------------------------------------------------------------------
-- local_seo_keywords
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.local_seo_keywords (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id  UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  keyword      TEXT        NOT NULL CHECK (char_length(btrim(keyword)) BETWEEN 1 AND 200),
  -- NULL = inherit the location's language/country.
  language     TEXT,
  country      TEXT,
  tags         TEXT[]      NOT NULL DEFAULT '{}',
  is_active    BOOLEAN     NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS local_seo_keywords_unique
  ON public.local_seo_keywords (location_id, lower(btrim(keyword)), coalesce(language, ''));
CREATE INDEX IF NOT EXISTS local_seo_keywords_org
  ON public.local_seo_keywords (org_id);

ALTER TABLE public.local_seo_keywords ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_local_seo_keywords" ON public.local_seo_keywords;
CREATE POLICY "org_local_seo_keywords" ON public.local_seo_keywords
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS local_seo_keywords_updated_at ON public.local_seo_keywords;
CREATE TRIGGER local_seo_keywords_updated_at
  BEFORE UPDATE ON public.local_seo_keywords
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- -----------------------------------------------------------------------------
-- local_seo_usage_ledger (server-written)
-- -----------------------------------------------------------------------------
-- scan_id has no FK yet: local_seo_scans arrives in migration 1316, which adds
-- the constraint. Keeping the column here lets the ledger exist from day one.
CREATE TABLE IF NOT EXISTS public.local_seo_usage_ledger (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  scan_id     UUID,
  points      INTEGER     NOT NULL CHECK (points >= 0),
  -- Estimated at charge time, replaced by the real cost when the scan closes.
  cost_usd    NUMERIC(12, 6) NOT NULL DEFAULT 0,
  provider    TEXT        NOT NULL,
  -- false when the org paid the provider with its own key: those points are
  -- recorded for visibility but never count against the plan quota.
  billable    BOOLEAN     NOT NULL DEFAULT true,
  -- First day of the month the points count against (UTC).
  period      DATE        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS local_seo_usage_ledger_period
  ON public.local_seo_usage_ledger (org_id, period);
CREATE INDEX IF NOT EXISTS local_seo_usage_ledger_day
  ON public.local_seo_usage_ledger (created_at);

ALTER TABLE public.local_seo_usage_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.local_seo_usage_ledger;
CREATE POLICY "org_read" ON public.local_seo_usage_ledger
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

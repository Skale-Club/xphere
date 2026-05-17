-- =============================================================================
-- Migration 050: Google Reviews via SerpAPI (v2.1)
-- Replaces v1.3 Google Places API approach (migration 018).
--
-- New design:
--   - Per-org SerpAPI key (encrypted) instead of platform-wide Google API key
--   - Unlimited reviews per business (vs 5 from Places API)
--   - Reviewer photos + review photo galleries
--   - Soft-removal tracking (is_removed flag)
--   - Daily scrape via GitHub Action
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Drop the legacy v1.3 tables (google_locations + google_reviews v1.3 schema)
-- ---------------------------------------------------------------------------
DROP TABLE IF EXISTS public.google_reviews CASCADE;
DROP TABLE IF EXISTS public.google_locations CASCADE;

-- ---------------------------------------------------------------------------
-- 2. google_business_profiles — one Google Business per org
-- ---------------------------------------------------------------------------
CREATE TABLE public.google_business_profiles (
  id                      UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                  UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  place_id                TEXT         NOT NULL,
  business_name           TEXT,
  address                 TEXT,
  serpapi_key_encrypted   TEXT         NOT NULL,
  scrape_interval_hours   INT          NOT NULL DEFAULT 24,
  last_scraped_at         TIMESTAMPTZ,
  last_scrape_status      TEXT,        -- 'success' | 'error' | 'quota_exceeded'
  last_scrape_error       TEXT,
  total_reviews_count     INT,
  average_rating          NUMERIC(2,1),
  is_active               BOOLEAN      NOT NULL DEFAULT true,
  widget_token            TEXT         NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  created_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (org_id, place_id)
);

CREATE INDEX idx_gbp_org_id       ON public.google_business_profiles(org_id);
CREATE INDEX idx_gbp_widget_token ON public.google_business_profiles(widget_token);
CREATE INDEX idx_gbp_active       ON public.google_business_profiles(is_active) WHERE is_active = true;

ALTER TABLE public.google_business_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.google_business_profiles
  FOR ALL
  TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

-- ---------------------------------------------------------------------------
-- 3. google_reviews — individual reviews scraped from SerpAPI
-- ---------------------------------------------------------------------------
CREATE TABLE public.google_reviews (
  id                       UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                   UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  profile_id               UUID         NOT NULL REFERENCES public.google_business_profiles(id) ON DELETE CASCADE,
  review_id                TEXT         NOT NULL,            -- native SerpAPI/Google id
  reviewer_name            TEXT,
  reviewer_photo_url       TEXT,                              -- Hetzner URL (or original CDN until storage ready)
  reviewer_profile_url     TEXT,
  rating                   INT          NOT NULL CHECK (rating BETWEEN 1 AND 5),
  text                     TEXT,
  date_text                TEXT,                              -- relative date as Google shows ("2 weeks ago")
  date_iso                 TIMESTAMPTZ,                       -- parsed absolute when available
  is_local_guide           BOOLEAN      NOT NULL DEFAULT false,
  local_guide_reviews_count INT,
  helpful_count            INT          NOT NULL DEFAULT 0,
  owner_response           TEXT,
  owner_response_date      TEXT,
  is_removed               BOOLEAN      NOT NULL DEFAULT false,
  first_seen_at            TIMESTAMPTZ  NOT NULL DEFAULT now(),
  last_seen_at             TIMESTAMPTZ  NOT NULL DEFAULT now(),
  created_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ  NOT NULL DEFAULT now(),
  UNIQUE (profile_id, review_id)
);

CREATE INDEX idx_gr_profile_id   ON public.google_reviews(profile_id);
CREATE INDEX idx_gr_org_id       ON public.google_reviews(org_id);
CREATE INDEX idx_gr_active       ON public.google_reviews(profile_id, is_removed) WHERE is_removed = false;
CREATE INDEX idx_gr_rating       ON public.google_reviews(profile_id, rating);

ALTER TABLE public.google_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.google_reviews
  FOR ALL
  TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

-- Public widget endpoint reads via service-role client, so RLS does not block it.
-- But also allow anon SELECT for non-removed rows when accessed via service role:
-- (intentionally NOT adding anon policy here — service-role bypasses RLS)

-- ---------------------------------------------------------------------------
-- 4. google_review_photos — photos attached to reviews
-- ---------------------------------------------------------------------------
CREATE TABLE public.google_review_photos (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  review_id     UUID         NOT NULL REFERENCES public.google_reviews(id) ON DELETE CASCADE,
  position      INT          NOT NULL DEFAULT 0,
  original_url  TEXT         NOT NULL,
  hetzner_url   TEXT,                                          -- nullable until Hetzner upload ready
  width         INT,
  height        INT,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE INDEX idx_grp_review_id ON public.google_review_photos(review_id);
CREATE INDEX idx_grp_org_id    ON public.google_review_photos(org_id);

ALTER TABLE public.google_review_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.google_review_photos
  FOR ALL
  TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

-- ---------------------------------------------------------------------------
-- 5. updated_at trigger helper (reuse if exists, define if not)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE FUNCTION public.set_updated_at() RETURNS trigger AS $fn$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
END $$;

CREATE TRIGGER trg_gbp_updated_at
  BEFORE UPDATE ON public.google_business_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_gr_updated_at
  BEFORE UPDATE ON public.google_reviews
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

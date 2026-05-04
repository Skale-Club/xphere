-- =============================================================================
-- Migration 018: Google Reviews — google_locations + google_reviews tables
-- Phase: 07-db-foundation (v1.3)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- google_locations: one Google Place per org (many allowed, MVP typically 1)
-- review_token is the public embed token (mirrors widget_token on organizations)
-- fetched_at tracks cache age — required for Google Places ToS compliance
-- ---------------------------------------------------------------------------
CREATE TABLE public.google_locations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  place_id        TEXT        NOT NULL,
  name            TEXT        NOT NULL,
  address         TEXT,
  maps_url        TEXT,
  category        TEXT,
  client_name     TEXT,
  review_token    TEXT        NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  fetched_at      TIMESTAMPTZ,
  last_fetch_error TEXT,
  review_count    INT         NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, place_id)
);

CREATE INDEX idx_google_locations_org_id       ON public.google_locations(org_id);
CREATE INDEX idx_google_locations_review_token ON public.google_locations(review_token);

ALTER TABLE public.google_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.google_locations
  FOR ALL
  TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

-- ---------------------------------------------------------------------------
-- google_reviews: up to 5 cached reviews per location (Google Places API limit)
-- google_review_id is the stable dedup key from Places API response
-- display_order preserves Google relevance ranking
-- org_id denormalized for efficient RLS without joins
-- ---------------------------------------------------------------------------
CREATE TABLE public.google_reviews (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id      UUID        NOT NULL REFERENCES public.google_locations(id) ON DELETE CASCADE,
  org_id           UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  google_review_id TEXT        NOT NULL,
  author_name      TEXT        NOT NULL,
  author_photo_url TEXT,
  author_uri       TEXT,
  rating           INT         NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text      TEXT,
  original_text    TEXT,
  relative_time    TEXT,
  published_at     TIMESTAMPTZ,
  google_maps_url  TEXT,
  display_order    INT         NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(location_id, google_review_id)
);

CREATE INDEX idx_google_reviews_location_id ON public.google_reviews(location_id);
CREATE INDEX idx_google_reviews_org_id      ON public.google_reviews(org_id);

ALTER TABLE public.google_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.google_reviews
  FOR ALL
  TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

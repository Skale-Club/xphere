-- =============================================================================
-- Migration 1315: Google Business Profile — connection, official reviews,
-- reply drafts, posts, performance, profile snapshots, change ledger
-- =============================================================================
-- Phases 3 and 4 of .planning/local-seo/SPEC.md.
--
--   gbp_connections         one Google account (OAuth, business.manage) per
--                           org and email; tokens encrypted with crypto.ts
--   gbp_reply_settings      per-org reply tone and the optional auto-reply
--                           for 4-5 star reviews (<= 3 stars always waits for
--                           a person)
--   gbp_reviews             reviews from the Business Profile API
--   gbp_reply_drafts        AI or human reply drafts awaiting approval
--   gbp_posts               local posts, drafts and scheduled
--   gbp_performance_daily   Performance API daily metrics
--   gbp_search_keywords_monthly  search terms that showed the profile
--   gbp_profile_snapshots   daily copy of the profile, to detect edits made
--                           by Google ("Google updated your profile")
--   gbp_change_requests     every write to Google: reply, profile edit, post
--   gbp_change_events       append-only history of those requests
--
-- Write model: everything is written by the server (service role) after the
-- application checked local_seo.* permissions, except gbp_reply_settings,
-- which is plain operator configuration. Authenticated users read their org.
--
-- Idempotent: IF NOT EXISTS / DROP ... IF EXISTS throughout.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- gbp_connections
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gbp_connections (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  google_email      TEXT,
  -- crypto.ts blob of {access_token, refresh_token}. Never exposed to clients.
  encrypted_tokens  TEXT        NOT NULL,
  scopes            TEXT[]      NOT NULL DEFAULT '{}',
  status            TEXT        NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'revoked')),
  connection_error  TEXT,
  token_expires_at  TIMESTAMPTZ,
  last_verified_at  TIMESTAMPTZ,
  connected_by      UUID,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS gbp_connections_org_email
  ON public.gbp_connections (org_id, coalesce(google_email, ''));

ALTER TABLE public.gbp_connections ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.gbp_connections;
CREATE POLICY "org_read" ON public.gbp_connections
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- The token blob is server-only even inside the org. A column REVOKE does not
-- override a table-level grant, so drop the table grant and re-grant the
-- readable columns.
REVOKE SELECT ON public.gbp_connections FROM authenticated, anon;
GRANT SELECT (id, org_id, google_email, scopes, status, connection_error, token_expires_at,
              last_verified_at, connected_by, created_at, updated_at)
  ON public.gbp_connections TO authenticated;

DROP TRIGGER IF EXISTS gbp_connections_updated_at ON public.gbp_connections;
CREATE TRIGGER gbp_connections_updated_at
  BEFORE UPDATE ON public.gbp_connections
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

-- Location <-> GBP link (columns reserved in 1312).
ALTER TABLE public.local_seo_locations
  ADD COLUMN IF NOT EXISTS gbp_account_name     TEXT,
  ADD COLUMN IF NOT EXISTS gbp_reviews_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gbp_profile_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gbp_perf_synced_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS gbp_sync_error        TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'local_seo_locations_gbp_connection_fk') THEN
    ALTER TABLE public.local_seo_locations
      ADD CONSTRAINT local_seo_locations_gbp_connection_fk
      FOREIGN KEY (gbp_connection_id) REFERENCES public.gbp_connections(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS local_seo_locations_gbp
  ON public.local_seo_locations (gbp_reviews_synced_at NULLS FIRST)
  WHERE gbp_location_name IS NOT NULL;

-- -----------------------------------------------------------------------------
-- gbp_reply_settings (operator config)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gbp_reply_settings (
  org_id               UUID        PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  tone                 TEXT        NOT NULL DEFAULT 'warm and professional',
  signature            TEXT,
  instructions         TEXT,
  auto_reply_positive  BOOLEAN     NOT NULL DEFAULT false,
  -- Auto-reply never applies below 4 stars, whatever is stored here.
  auto_reply_min_rating INTEGER    NOT NULL DEFAULT 5 CHECK (auto_reply_min_rating BETWEEN 4 AND 5),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.gbp_reply_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_gbp_reply_settings" ON public.gbp_reply_settings;
CREATE POLICY "org_gbp_reply_settings" ON public.gbp_reply_settings
  FOR ALL TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- gbp_reviews
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gbp_reviews (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id         UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  -- "accounts/{a}/locations/{l}/reviews/{r}"
  review_name         TEXT        NOT NULL UNIQUE,
  reviewer_name       TEXT,
  reviewer_photo_url  TEXT,
  rating              INTEGER     CHECK (rating BETWEEN 1 AND 5),
  comment             TEXT,
  create_time         TIMESTAMPTZ,
  update_time         TIMESTAMPTZ,
  reply_comment       TEXT,
  reply_update_time   TIMESTAMPTZ,
  reply_state         TEXT        NOT NULL DEFAULT 'none' CHECK (reply_state IN ('none', 'pending', 'replied')),
  raw                 JSONB       NOT NULL DEFAULT '{}'::jsonb,
  first_seen_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gbp_reviews_location
  ON public.gbp_reviews (location_id, create_time DESC);
CREATE INDEX IF NOT EXISTS gbp_reviews_unreplied
  ON public.gbp_reviews (org_id, location_id) WHERE reply_state = 'none';

ALTER TABLE public.gbp_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.gbp_reviews;
CREATE POLICY "org_read" ON public.gbp_reviews
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- gbp_reply_drafts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gbp_reply_drafts (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  review_id    UUID        NOT NULL REFERENCES public.gbp_reviews(id) ON DELETE CASCADE,
  draft        TEXT        NOT NULL,
  model        TEXT,
  source       TEXT        NOT NULL DEFAULT 'ai' CHECK (source IN ('ai', 'human')),
  status       TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'sent', 'rejected', 'failed')),
  change_request_id UUID,
  error        TEXT,
  created_by   UUID,
  approved_by  UUID,
  approved_at  TIMESTAMPTZ,
  sent_at      TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gbp_reply_drafts_review ON public.gbp_reply_drafts (review_id, created_at DESC);

ALTER TABLE public.gbp_reply_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.gbp_reply_drafts;
CREATE POLICY "org_read" ON public.gbp_reply_drafts
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- gbp_posts
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gbp_posts (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id    UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  -- "accounts/{a}/locations/{l}/localPosts/{p}" once live.
  post_name      TEXT,
  topic_type     TEXT        NOT NULL DEFAULT 'STANDARD' CHECK (topic_type IN ('STANDARD', 'EVENT', 'OFFER', 'ALERT')),
  summary        TEXT        NOT NULL CHECK (char_length(summary) BETWEEN 1 AND 1500),
  media_url      TEXT,
  cta_type       TEXT        CHECK (cta_type IN ('BOOK', 'ORDER', 'SHOP', 'LEARN_MORE', 'SIGN_UP', 'CALL')),
  cta_url        TEXT,
  event          JSONB,
  offer          JSONB,
  recurrence     TEXT        NOT NULL DEFAULT 'none' CHECK (recurrence IN ('none', 'weekly', 'monthly')),
  status         TEXT        NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'publishing', 'live', 'failed', 'deleted')),
  scheduled_for  TIMESTAMPTZ,
  published_at   TIMESTAMPTZ,
  search_url     TEXT,
  error          TEXT,
  created_by     UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gbp_posts_location ON public.gbp_posts (location_id, coalesce(scheduled_for, created_at) DESC);
CREATE INDEX IF NOT EXISTS gbp_posts_due ON public.gbp_posts (scheduled_for) WHERE status = 'scheduled';

ALTER TABLE public.gbp_posts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.gbp_posts;
CREATE POLICY "org_read" ON public.gbp_posts
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- Performance
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gbp_performance_daily (
  org_id       UUID    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id  UUID    NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  date         DATE    NOT NULL,
  metric       TEXT    NOT NULL,
  value        BIGINT  NOT NULL DEFAULT 0,
  PRIMARY KEY (location_id, date, metric)
);

ALTER TABLE public.gbp_performance_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.gbp_performance_daily;
CREATE POLICY "org_read" ON public.gbp_performance_daily
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

CREATE TABLE IF NOT EXISTS public.gbp_search_keywords_monthly (
  org_id       UUID    NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id  UUID    NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  month        DATE    NOT NULL,
  keyword      TEXT    NOT NULL,
  -- Google reports small counts only as "< threshold"; impressions is NULL then.
  impressions  BIGINT,
  threshold    BIGINT,
  PRIMARY KEY (location_id, month, keyword)
);

ALTER TABLE public.gbp_search_keywords_monthly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.gbp_search_keywords_monthly;
CREATE POLICY "org_read" ON public.gbp_search_keywords_monthly
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- gbp_profile_snapshots
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gbp_profile_snapshots (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id     UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  taken_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data            JSONB       NOT NULL,
  data_hash       TEXT        NOT NULL,
  -- Fields Google changed itself (getGoogleUpdated), when it flagged any.
  google_updated  JSONB,
  -- Field-level diff against the previous snapshot.
  diff            JSONB       NOT NULL DEFAULT '[]'::jsonb,
  acknowledged_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS gbp_profile_snapshots_location
  ON public.gbp_profile_snapshots (location_id, taken_at DESC);

ALTER TABLE public.gbp_profile_snapshots ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.gbp_profile_snapshots;
CREATE POLICY "org_read" ON public.gbp_profile_snapshots
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- -----------------------------------------------------------------------------
-- gbp_change_requests / gbp_change_events (the write ledger)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.gbp_change_requests (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id        UUID        NOT NULL REFERENCES public.local_seo_locations(id) ON DELETE CASCADE,
  command_type       TEXT        NOT NULL CHECK (command_type IN (
                       'review.reply', 'review.delete_reply', 'profile.update', 'post.create', 'post.delete')),
  -- Reply target, post or profile field set this request is about.
  target_ref         TEXT,
  payload            JSONB       NOT NULL,
  before_state       JSONB,
  intended_state     JSONB,
  diff               JSONB       NOT NULL DEFAULT '[]'::jsonb,
  risk_level         SMALLINT    NOT NULL CHECK (risk_level BETWEEN 1 AND 4),
  status             TEXT        NOT NULL DEFAULT 'awaiting_approval' CHECK (status IN (
                       'awaiting_approval', 'queued', 'executing', 'succeeded', 'failed',
                       'drifted', 'cancelled', 'rejected')),
  actor_type         TEXT        NOT NULL CHECK (actor_type IN ('user', 'ai', 'workflow', 'system')),
  actor_id           UUID,
  actor_label        TEXT,
  idempotency_key    TEXT        NOT NULL,
  approval_required  BOOLEAN     NOT NULL DEFAULT true,
  approved_by        UUID,
  approved_at        TIMESTAMPTZ,
  attempt_count      INTEGER     NOT NULL DEFAULT 0,
  provider_result    JSONB,
  error_message      TEXT,
  verification       JSONB,
  rollback_of        UUID        REFERENCES public.gbp_change_requests(id) ON DELETE SET NULL,
  executed_at        TIMESTAMPTZ,
  completed_at       TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS gbp_change_requests_idempotency
  ON public.gbp_change_requests (org_id, idempotency_key);
CREATE INDEX IF NOT EXISTS gbp_change_requests_location
  ON public.gbp_change_requests (location_id, created_at DESC);
CREATE INDEX IF NOT EXISTS gbp_change_requests_pending
  ON public.gbp_change_requests (org_id) WHERE status = 'awaiting_approval';
CREATE INDEX IF NOT EXISTS gbp_change_requests_queue
  ON public.gbp_change_requests (created_at) WHERE status = 'queued';

ALTER TABLE public.gbp_change_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.gbp_change_requests;
CREATE POLICY "org_read" ON public.gbp_change_requests
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

DROP TRIGGER IF EXISTS gbp_change_requests_updated_at ON public.gbp_change_requests;
CREATE TRIGGER gbp_change_requests_updated_at
  BEFORE UPDATE ON public.gbp_change_requests
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gbp_reply_drafts_change_fk') THEN
    ALTER TABLE public.gbp_reply_drafts
      ADD CONSTRAINT gbp_reply_drafts_change_fk
      FOREIGN KEY (change_request_id) REFERENCES public.gbp_change_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.gbp_change_events (
  id                 UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id             UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  change_request_id  UUID        NOT NULL REFERENCES public.gbp_change_requests(id) ON DELETE CASCADE,
  event_type         TEXT        NOT NULL,
  from_status        TEXT,
  to_status          TEXT,
  actor_type         TEXT        NOT NULL CHECK (actor_type IN ('user', 'ai', 'workflow', 'system')),
  actor_id           UUID,
  actor_label        TEXT,
  detail             JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS gbp_change_events_request
  ON public.gbp_change_events (change_request_id, created_at);

ALTER TABLE public.gbp_change_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_read" ON public.gbp_change_events;
CREATE POLICY "org_read" ON public.gbp_change_events
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

CREATE OR REPLACE FUNCTION public.gbp_change_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  -- Cascades from a deleted request/org still work: the parent row is gone.
  IF TG_OP = 'DELETE' AND NOT EXISTS (
    SELECT 1 FROM public.gbp_change_requests WHERE id = OLD.change_request_id
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'gbp_change_events is append-only (% rejected)', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS gbp_change_events_no_update ON public.gbp_change_events;
CREATE TRIGGER gbp_change_events_no_update
  BEFORE UPDATE OR DELETE ON public.gbp_change_events
  FOR EACH ROW EXECUTE FUNCTION public.gbp_change_events_append_only();

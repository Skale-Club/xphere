-- =============================================================================
-- Migration 1322: Google Business Profile in the guarded mutation plane
-- =============================================================================
-- Google Business Profile is not an ad network, but its public listing writes
-- use the same connection health, preview, approval, audit and verification
-- primitives as Google/Meta campaign changes. `ad_account_id` is an opaque
-- target key for this platform: accounts/{account_id}/locations/{location_id}.
--
-- One login, one ledger:
--   * The OAuth tokens live only in gbp_connections (Local SEO connect flow).
--     An engine target (ads_connections, platform google_business) is created
--     when a Local SEO location is linked to a profile; gbp_connection_id says
--     which login it uses and removes the target with the login.
--   * Every Business Profile write goes through ads_change_requests. Local
--     SEO's own ledger from 1318 (gbp_change_requests / gbp_change_events) is
--     dropped; it never held a row in production. Reply drafts and posts now
--     point at the engine ledger.
--
-- Idempotent.
-- =============================================================================

ALTER TABLE public.ads_connections
  DROP CONSTRAINT IF EXISTS ads_connections_platform_check;

ALTER TABLE public.ads_connections
  ADD CONSTRAINT ads_connections_platform_check
  CHECK (platform IN ('meta', 'google', 'google_business', 'tiktok', 'linkedin', 'microsoft'));

ALTER TABLE public.ads_change_requests
  DROP CONSTRAINT IF EXISTS ads_change_requests_platform_check;

ALTER TABLE public.ads_change_requests
  ADD CONSTRAINT ads_change_requests_platform_check
  CHECK (platform IN ('meta', 'google', 'google_business'));

ALTER TABLE public.ads_account_policies
  DROP CONSTRAINT IF EXISTS ads_account_policies_platform_check;

ALTER TABLE public.ads_account_policies
  ADD CONSTRAINT ads_account_policies_platform_check
  CHECK (platform IN ('meta', 'google', 'google_business'));

COMMENT ON COLUMN public.ads_connections.ad_account_id IS
  'Provider target id. Meta: act_*. Google Ads: customer id. Google Business: accounts/{account}/locations/{location}.';

-- -----------------------------------------------------------------------------
-- Engine targets reference the Local SEO login
-- -----------------------------------------------------------------------------
ALTER TABLE public.ads_connections
  ADD COLUMN IF NOT EXISTS gbp_connection_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ads_connections_gbp_connection_fk') THEN
    ALTER TABLE public.ads_connections
      ADD CONSTRAINT ads_connections_gbp_connection_fk
      FOREIGN KEY (gbp_connection_id) REFERENCES public.gbp_connections(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ads_connections_gbp_connection_check') THEN
    ALTER TABLE public.ads_connections
      ADD CONSTRAINT ads_connections_gbp_connection_check
      CHECK ((platform = 'google_business') = (gbp_connection_id IS NOT NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ads_connections_gbp_connection
  ON public.ads_connections (gbp_connection_id)
  WHERE gbp_connection_id IS NOT NULL;

COMMENT ON COLUMN public.ads_connections.gbp_connection_id IS
  'google_business only: the gbp_connections login whose tokens this target uses. encrypted_access_token then holds a reference to it, never a token.';

-- -----------------------------------------------------------------------------
-- Local SEO rows point at the engine ledger
-- -----------------------------------------------------------------------------
ALTER TABLE public.gbp_reply_drafts
  DROP CONSTRAINT IF EXISTS gbp_reply_drafts_change_fk;

ALTER TABLE public.gbp_posts
  ADD COLUMN IF NOT EXISTS change_request_id UUID;

-- Drop the 1318 ledger. Refuse rather than lose history if it was ever used.
DO $$
DECLARE
  has_rows BOOLEAN;
BEGIN
  -- Dynamic: on a re-run the table is gone and a static reference would not plan.
  IF to_regclass('public.gbp_change_requests') IS NOT NULL THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.gbp_change_requests)' INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'gbp_change_requests has rows; migrate them to ads_change_requests before dropping it';
    END IF;
  END IF;
END $$;

-- A stale change id from that ledger would block the new FK below.
UPDATE public.gbp_reply_drafts d
   SET change_request_id = NULL
 WHERE change_request_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.ads_change_requests c WHERE c.id = d.change_request_id);

DROP TABLE IF EXISTS public.gbp_change_events;
DROP TABLE IF EXISTS public.gbp_change_requests;
DROP FUNCTION IF EXISTS public.gbp_change_events_append_only();

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gbp_reply_drafts_ads_change_fk') THEN
    ALTER TABLE public.gbp_reply_drafts
      ADD CONSTRAINT gbp_reply_drafts_ads_change_fk
      FOREIGN KEY (change_request_id) REFERENCES public.ads_change_requests(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'gbp_posts_ads_change_fk') THEN
    ALTER TABLE public.gbp_posts
      ADD CONSTRAINT gbp_posts_ads_change_fk
      FOREIGN KEY (change_request_id) REFERENCES public.ads_change_requests(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS gbp_reply_drafts_change ON public.gbp_reply_drafts (change_request_id) WHERE change_request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS gbp_posts_change ON public.gbp_posts (change_request_id) WHERE change_request_id IS NOT NULL;

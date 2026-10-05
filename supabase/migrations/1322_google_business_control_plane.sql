-- =============================================================================
-- Migration 1322: Google Business Profile in the guarded mutation plane
-- =============================================================================
-- Google Business Profile is not an ad network, but its public listing writes
-- use the same connection health, preview, approval, audit and verification
-- primitives as Google/Meta campaign changes. `ad_account_id` is an opaque
-- target key for this platform: accounts/{account_id}/locations/{location_id}.
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

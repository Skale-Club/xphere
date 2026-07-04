-- Migration 1240: Platform tracking config table
-- Stores platform-level GTM container ID + Facebook Pixel ID (super admin only)
-- No RLS needed: accessed exclusively via service role key in platform admin actions
-- and the root layout's cached getter. IDs are public (embedded in client-side
-- scripts anyway), so unlike platform_email_settings there's nothing to encrypt.

CREATE TABLE IF NOT EXISTS platform_tracking_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gtm_container_id text,
  facebook_pixel_id text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Only one row allowed (singleton table for platform config)
-- Access is controlled at the application layer: only PLATFORM_ADMIN_EMAIL may read/write
-- via server actions that use the service role client

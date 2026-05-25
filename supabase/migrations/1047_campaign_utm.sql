-- =============================================================================
-- Migration 1047: UTM fields for campaigns
-- Adds optional UTM attribution and landing page URL to outbound campaigns
-- so tracked links can be generated for SMS/email follow-ups.
-- =============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS landing_page_url  TEXT,
  ADD COLUMN IF NOT EXISTS utm_source        TEXT,
  ADD COLUMN IF NOT EXISTS utm_medium        TEXT,
  ADD COLUMN IF NOT EXISTS utm_campaign_tag  TEXT,
  ADD COLUMN IF NOT EXISTS utm_content       TEXT,
  ADD COLUMN IF NOT EXISTS utm_term          TEXT;

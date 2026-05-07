-- =============================================================================
-- Migration: 028_google_contacts_foundation
-- Phase: v1.7 Google Contacts Integration — Phase 27 OAuth + DB Foundation
-- Extends: integration_provider enum with 'google_contacts'
-- Note: No new tables required — Google OAuth tokens are stored in the
--       existing `integrations` table using encrypted_api_key to hold a
--       JSON bundle: { access_token, refresh_token, token_expiry, google_email }
-- Note: UNIQUE(org_id, provider) is already enforced by the integrations table
--       so one Google account per org is guaranteed at the DB layer.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Extend integration_provider enum
--    NOTE: PostgreSQL enum ADD VALUE cannot run inside a BEGIN/COMMIT block.
--    Supabase migrations execute each file with implicit DDL handling that
--    accepts ADD VALUE IF NOT EXISTS — same pattern as 006_api_key_admin.sql
--    and 026_manychat_foundation.sql.
-- -----------------------------------------------------------------------------
ALTER TYPE public.integration_provider ADD VALUE IF NOT EXISTS 'google_contacts';

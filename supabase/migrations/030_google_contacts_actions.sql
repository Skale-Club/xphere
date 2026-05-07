-- =============================================================================
-- Migration: 030_google_contacts_actions
-- Phase: v1.7 Google Contacts Integration — Phase 28 Action Executors
-- Extends: action_type enum with 4 google_contacts_* values
-- NOTE: PostgreSQL enum ADD VALUE cannot run inside a BEGIN/COMMIT block.
-- =============================================================================

ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'google_contacts_create';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'google_contacts_update';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'google_contacts_find';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'google_contacts_delete';

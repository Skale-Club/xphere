-- Add settings JSONB column to organizations for feature flags and admin notes.
-- Default '{}'::jsonb ensures all existing rows are valid immediately.
-- Used by the super-admin panel to store per-org feature flags and admin notes.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb;

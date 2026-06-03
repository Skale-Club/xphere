-- Migration 1141: user scheduling preferences
-- Adds sync_mode (calendar event sync behaviour) and default_location_type
-- (default meeting location shown when creating event types).

ALTER TABLE public.scheduling_profiles
  ADD COLUMN IF NOT EXISTS sync_mode TEXT NOT NULL DEFAULT 'one_way'
    CHECK (sync_mode IN ('one_way', 'two_way')),
  ADD COLUMN IF NOT EXISTS default_location_type TEXT NOT NULL DEFAULT 'google_meet'
    CHECK (default_location_type IN ('google_meet', 'my_address', 'client_address', 'phone'));

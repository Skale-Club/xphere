-- Migration 1142: store conflict calendar IDs on scheduling_profiles
ALTER TABLE public.scheduling_profiles
  ADD COLUMN IF NOT EXISTS conflict_calendar_ids TEXT[] NOT NULL DEFAULT '{}';

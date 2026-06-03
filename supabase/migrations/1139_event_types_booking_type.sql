-- Migration 1139: add booking_type to event_types
-- Distinguishes personal (1-on-1) from round-robin (distributed) event types.

ALTER TABLE public.event_types
  ADD COLUMN IF NOT EXISTS booking_type TEXT NOT NULL DEFAULT 'personal'
  CHECK (booking_type IN ('personal', 'round_robin'));

-- =============================================================================
-- Migration 1212: Xkedule Booking Mirror
--
-- Adds the columns needed to mirror Xkedule bookings into the native bookings
-- table — so they surface in the calendar, the contact timeline, and drive the
-- meeting.* workflow events — without colliding with the native double-booking
-- guard.
--
--   external_source / external_id  — provenance + idempotency key for the mirror
--   external_updated_at            — source event time, for last-write-wins ordering
--
-- The double-booking unique index (migration 073) is recreated to EXEMPT mirror
-- rows. Xkedule is the source of truth for its own availability — it allows
-- several bookings at the same start_at for different staff — so the native
-- guard must only apply to native bookings (external_source IS NULL). Behavior
-- for native bookings is unchanged (external_source IS NULL evaluates true).
--
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS external_source     text,
  ADD COLUMN IF NOT EXISTS external_id         text,
  ADD COLUMN IF NOT EXISTS external_updated_at timestamptz;

-- Idempotency: one mirror row per (org, source, external id).
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_external_unique
  ON public.bookings (org_id, external_source, external_id)
  WHERE external_id IS NOT NULL;

-- Fast lookup of mirror rows (webhook upserts, reconciliation).
CREATE INDEX IF NOT EXISTS idx_bookings_external_source
  ON public.bookings (org_id, external_source)
  WHERE external_source IS NOT NULL;

-- Recreate the double-booking guard (migration 073) to exempt mirror rows.
DROP INDEX IF EXISTS public.idx_bookings_event_slot_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_event_slot_unique
  ON public.bookings (event_type_id, start_at)
  WHERE status = 'confirmed' AND external_source IS NULL;

-- =============================================================================
-- Footer
--   bookings.external_source = 'xkedule' marks a read-only mirror row.
--   The webhook receiver (/api/xkedule/webhook) upserts by
--   (org_id, external_source, external_id) and applies last-write-wins via
--   external_updated_at vs the incoming event's occurred_at.
-- =============================================================================

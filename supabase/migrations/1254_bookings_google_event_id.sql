-- =============================================================================
-- Migration 1254: bookings.google_event_id (SYNC-01)
--
-- Stores the Google Calendar event id returned by createCalendarEvent at
-- booking-creation time, so a future cancel/reschedule can propagate to the
-- synced Google event (CAL-F02, not built here — this migration only adds the
-- storage foundation). Deliberately NOT stored in location_data (already
-- clobbered wholesale by the google_meet flow in transition.ts::confirmBooking)
-- or external_source/external_id (which mean "this row mirrors an externally-
-- originated booking" — the opposite direction).
--
-- Nullable, no backfill: most historical bookings were never synced to Google,
-- and the id cannot be recovered retroactively from Xphere's own data (Google's
-- Events API was never queried at creation time to record it) — a documented
-- known gap for pre-existing rows, not something this migration attempts.
--
-- Idempotent: safe to re-run.
-- =============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;

COMMENT ON COLUMN public.bookings.google_event_id IS
  'Google Calendar event id returned by createCalendarEvent at booking-creation time. NULL for bookings never synced to Google or created before this column existed. Foundation for future cancel/reschedule propagation (CAL-F02, not implemented here).';

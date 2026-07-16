-- =============================================================================
-- Migration 1249: Booking Organizer Overlap Guard (CAL-02)
--
-- Adds a database-level guarantee that no organizer can have two overlapping
-- CONFIRMED, native (external_source IS NULL) bookings — even across
-- different event types. Complements the existing per-event-type partial
-- unique index (idx_bookings_event_slot_unique, migrations 073/1212), which
-- only catches exact-start collisions within the SAME event_type_id.
--
-- Also adds a CHECK constraint rejecting malformed intervals
-- (start_at >= end_at), which did not exist anywhere in the schema before.
--
-- PRE-FLIGHT REQUIRED BEFORE APPLYING TO PRODUCTION (see Plan 126-06):
-- Postgres exclusion constraints have no NOT VALID / VALIDATE CONSTRAINT
-- deferred-validation path -- ADD CONSTRAINT ... EXCLUDE scans and enforces
-- immediately. If any two existing confirmed, native bookings for the same
-- organizer already overlap, this migration fails outright. Audit BEFORE
-- applying with:
--
--   SELECT b1.id AS booking_1, b2.id AS booking_2, et1.user_id AS organizer
--   FROM public.bookings b1
--   JOIN public.event_types et1 ON et1.id = b1.event_type_id
--   JOIN public.bookings b2 ON b2.id > b1.id
--   JOIN public.event_types et2 ON et2.id = b2.event_type_id AND et2.user_id = et1.user_id
--   WHERE b1.status = 'confirmed' AND b1.external_source IS NULL
--     AND b2.status = 'confirmed' AND b2.external_source IS NULL
--     AND tstzrange(b1.start_at, b1.end_at, '[)') && tstzrange(b2.start_at, b2.end_at, '[)');
--
-- If this returns any rows, resolve them (cancel/reschedule) before applying
-- this migration.
--
-- Idempotent: safe to re-run.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- 1. Denormalized organizer column (bookings has no user_id today -- only via
--    the event_types FK). Exclusion constraints cannot reference other
--    tables, so this column must exist on the row itself.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS organizer_user_id uuid REFERENCES auth.users(id);

-- 2. Backfill existing rows from event_types.user_id.
UPDATE public.bookings b
  SET organizer_user_id = et.user_id
  FROM public.event_types et
  WHERE b.event_type_id = et.id AND b.organizer_user_id IS NULL;

-- 3. Trigger to auto-populate on future inserts/updates -- defense in depth,
--    does not rely on every write path (native, MCP, Xkedule, dashboard)
--    remembering to set it explicitly.
CREATE OR REPLACE FUNCTION public.set_booking_organizer()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organizer_user_id IS NULL THEN
    SELECT user_id INTO NEW.organizer_user_id
    FROM public.event_types WHERE id = NEW.event_type_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_set_organizer ON public.bookings;
CREATE TRIGGER trg_bookings_set_organizer
  BEFORE INSERT OR UPDATE OF event_type_id ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.set_booking_organizer();

-- 4. Malformed-interval guard -- did not exist anywhere in the schema before.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_valid_interval;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_valid_interval CHECK (start_at < end_at);

-- 5. The exclusion constraint itself.
--    CRITICAL: '[)' (half-open), NOT '[]'. src/lib/calendar/slots.ts's own
--    overlaps() (isBefore(aStart,bEnd) && isAfter(aEnd,bStart)) already
--    treats touching endpoints as NON-overlapping so back-to-back bookings
--    are allowed. Using '[]' here would reject every legitimate
--    back-to-back booking.
--    WHERE clause carries forward external_source IS NULL from migration
--    1212 -- Xkedule mirror rows intentionally allow multiple staff at the
--    same start_at and must stay exempt from this native-booking guard.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_no_organizer_overlap;
ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_no_organizer_overlap
  EXCLUDE USING gist (
    organizer_user_id WITH =,
    tstzrange(start_at, end_at, '[)') WITH &&
  )
  WHERE (status = 'confirmed' AND external_source IS NULL);

CREATE INDEX IF NOT EXISTS idx_bookings_organizer_user_id
  ON public.bookings (organizer_user_id);

-- =============================================================================
-- Footer
--   organizer_user_id -- denormalized from event_types.user_id, auto-populated
--     by trg_bookings_set_organizer on INSERT/UPDATE OF event_type_id.
--   bookings_valid_interval -- CHECK (start_at < end_at), all bookings.
--   bookings_no_organizer_overlap -- EXCLUDE USING gist, rejects overlapping
--     [start_at, end_at) ranges for the same organizer_user_id, scoped to
--     status='confirmed' AND external_source IS NULL (native bookings only).
-- =============================================================================

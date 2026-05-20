-- =============================================================================
-- Migration 090: Bookings Location Fields (SEED-028 Phase B)
-- =============================================================================
-- Adds structured location fields to bookings so the resolver (Phase D)
-- can compute {{meeting.link}}, {{meeting.location.*}} deterministically.
--
-- The existing event_types.location_type ('video' | 'phone' | 'in_person')
-- + event_types.location_value remain as legacy fallback during transition;
-- the new fields are authoritative once populated.
-- =============================================================================

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS location_kind  text,
  ADD COLUMN IF NOT EXISTS location_data  jsonb       NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS meeting_url    text,
  ADD COLUMN IF NOT EXISTS meeting_phone  text;

-- Validate location_kind against the central lookup so adding a new kind
-- is a single INSERT into _location_kinds (declared in migration 089).
CREATE OR REPLACE FUNCTION public.validate_booking_location_kind()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.location_kind IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public._location_kinds WHERE kind = NEW.location_kind
  ) THEN
    RAISE EXCEPTION 'Unknown booking location kind: %', NEW.location_kind;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bookings_validate_location_kind ON public.bookings;
CREATE TRIGGER trg_bookings_validate_location_kind
  BEFORE INSERT OR UPDATE OF location_kind ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.validate_booking_location_kind();

CREATE INDEX IF NOT EXISTS idx_bookings_location_kind
  ON public.bookings (location_kind)
  WHERE location_kind IS NOT NULL;

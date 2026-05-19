-- =============================================================================
-- Migration 071: Scheduling Foundation — Calendly-like booking system
--
-- Creates tables for user scheduling profiles, event types, availability slots,
-- and bookings. Supports public booking pages (anon reads) alongside
-- org-scoped authenticated access.
--
-- Idempotent: safe to re-run. Pure Postgres, no Vercel-specific constructs.
-- =============================================================================

-- ----- Table: public.scheduling_profiles -------------------------------------
-- One row per user. Stores the public booking slug and timezone.

CREATE TABLE IF NOT EXISTS public.scheduling_profiles (
  user_id     uuid        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slug        text        NOT NULL UNIQUE,
  timezone    text        NOT NULL DEFAULT 'UTC',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ----- Indexes ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_scheduling_profiles_org_id
  ON public.scheduling_profiles (org_id);

CREATE INDEX IF NOT EXISTS idx_scheduling_profiles_slug
  ON public.scheduling_profiles (slug);

-- ----- RLS -------------------------------------------------------------------

ALTER TABLE public.scheduling_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scheduling_profiles_org_isolation ON public.scheduling_profiles;
CREATE POLICY scheduling_profiles_org_isolation ON public.scheduling_profiles
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ----- updated_at trigger ----------------------------------------------------

DROP TRIGGER IF EXISTS trg_scheduling_profiles_set_updated_at ON public.scheduling_profiles;
CREATE TRIGGER trg_scheduling_profiles_set_updated_at
  BEFORE UPDATE ON public.scheduling_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- =============================================================================

-- ----- Table: public.event_types ---------------------------------------------
-- Meeting types per user (e.g. "30-min-call", "discovery").

CREATE TABLE IF NOT EXISTS public.event_types (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id           uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id          uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title            text        NOT NULL,
  slug             text        NOT NULL,
  description      text,
  duration_minutes integer     NOT NULL DEFAULT 30,
  color            text        NOT NULL DEFAULT '#6366F1',
  location_type    text        NOT NULL DEFAULT 'video'
                               CHECK (location_type IN ('video', 'phone', 'in_person')),
  location_value   text,
  active           boolean     NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, slug)
);

-- ----- Indexes ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_event_types_org_id
  ON public.event_types (org_id);

CREATE INDEX IF NOT EXISTS idx_event_types_user_id
  ON public.event_types (user_id);

CREATE INDEX IF NOT EXISTS idx_event_types_active
  ON public.event_types (user_id, active)
  WHERE active = true;

-- ----- RLS -------------------------------------------------------------------

ALTER TABLE public.event_types ENABLE ROW LEVEL SECURITY;

-- Authenticated org-scoped access (SELECT/INSERT/UPDATE/DELETE) plus public
-- visibility of active event types for the booking page.
DROP POLICY IF EXISTS event_types_org_isolation ON public.event_types;
CREATE POLICY event_types_org_isolation ON public.event_types
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- Allow anonymous SELECT for active event types (public booking page).
-- The USING expression is combined with the above using OR-semantics when the
-- session has no org context (anon role).
DROP POLICY IF EXISTS event_types_public_select ON public.event_types;
CREATE POLICY event_types_public_select ON public.event_types
  FOR SELECT
  USING (active = true OR org_id = (SELECT public.get_current_org_id()));

-- ----- updated_at trigger ----------------------------------------------------

DROP TRIGGER IF EXISTS trg_event_types_set_updated_at ON public.event_types;
CREATE TRIGGER trg_event_types_set_updated_at
  BEFORE UPDATE ON public.event_types
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- =============================================================================

-- ----- Table: public.user_availability ---------------------------------------
-- Weekly recurring availability slots (0=Sun … 6=Sat).

CREATE TABLE IF NOT EXISTS public.user_availability (
  id           uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id       uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id      uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day_of_week  integer     NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time   time        NOT NULL,
  end_time     time        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, day_of_week)
);

-- ----- Indexes ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_user_availability_org_id
  ON public.user_availability (org_id);

CREATE INDEX IF NOT EXISTS idx_user_availability_user_id
  ON public.user_availability (user_id);

-- ----- RLS -------------------------------------------------------------------

ALTER TABLE public.user_availability ENABLE ROW LEVEL SECURITY;

-- Public SELECT — required for slot generation on the booking page.
DROP POLICY IF EXISTS user_availability_public_select ON public.user_availability;
CREATE POLICY user_availability_public_select ON public.user_availability
  FOR SELECT
  USING (true);

-- Org-scoped write access.
DROP POLICY IF EXISTS user_availability_org_write ON public.user_availability;
CREATE POLICY user_availability_org_write ON public.user_availability
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- =============================================================================

-- ----- Table: public.bookings ------------------------------------------------
-- Confirmed appointments. Anon users can INSERT (book); org members can
-- SELECT/UPDATE/DELETE.

CREATE TABLE IF NOT EXISTS public.bookings (
  id                 uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  org_id             uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  event_type_id      uuid        NOT NULL REFERENCES public.event_types(id) ON DELETE CASCADE,
  booker_name        text        NOT NULL,
  booker_email       text        NOT NULL,
  booker_phone       text,
  booker_timezone    text        NOT NULL DEFAULT 'UTC',
  start_at           timestamptz NOT NULL,
  end_at             timestamptz NOT NULL,
  notes              text,
  status             text        NOT NULL DEFAULT 'confirmed'
                                 CHECK (status IN ('confirmed', 'cancelled', 'no_show')),
  linked_contact_id  uuid        REFERENCES public.contacts(id) ON DELETE SET NULL,
  cancel_token       uuid        NOT NULL DEFAULT gen_random_uuid(),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ----- Indexes ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_bookings_org_id
  ON public.bookings (org_id);

CREATE INDEX IF NOT EXISTS idx_bookings_event_type_id
  ON public.bookings (event_type_id);

CREATE INDEX IF NOT EXISTS idx_bookings_start_at
  ON public.bookings (org_id, start_at);

CREATE INDEX IF NOT EXISTS idx_bookings_status
  ON public.bookings (org_id, status);

CREATE INDEX IF NOT EXISTS idx_bookings_booker_email
  ON public.bookings (booker_email);

CREATE INDEX IF NOT EXISTS idx_bookings_cancel_token
  ON public.bookings (cancel_token);

CREATE INDEX IF NOT EXISTS idx_bookings_linked_contact
  ON public.bookings (linked_contact_id)
  WHERE linked_contact_id IS NOT NULL;

-- ----- RLS -------------------------------------------------------------------

ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Org members can read, update, and delete their org's bookings.
DROP POLICY IF EXISTS bookings_org_isolation ON public.bookings;
CREATE POLICY bookings_org_isolation ON public.bookings
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- Anyone (anon) can INSERT a booking (public booking page submission).
DROP POLICY IF EXISTS bookings_public_insert ON public.bookings;
CREATE POLICY bookings_public_insert ON public.bookings
  FOR INSERT
  WITH CHECK (true);

-- ----- updated_at trigger ----------------------------------------------------

DROP TRIGGER IF EXISTS trg_bookings_set_updated_at ON public.bookings;
CREATE TRIGGER trg_bookings_set_updated_at
  BEFORE UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- =============================================================================
-- Footer
--
-- Tables created:
--   scheduling_profiles  — one per user, slug + timezone
--   event_types          — meeting types per user, supports public booking view
--   user_availability    — weekly recurring slots, publicly readable
--   bookings             — confirmed appointments, publicly insertable
--
-- All tables have RLS enabled. Service role bypasses all policies.
-- get_current_org_id() provides org-scoping for authenticated sessions.
-- =============================================================================

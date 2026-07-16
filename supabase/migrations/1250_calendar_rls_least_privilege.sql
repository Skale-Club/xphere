-- =============================================================================
-- Migration 1250: Calendar RLS Least Privilege (CAL-04)
--
-- Removes three anon-broad RLS policies written for an architecture (direct
-- anon-key client-side booking) this codebase no longer uses. Confirmed via
-- grep across src/ that every read/write to bookings, user_availability, and
-- event_types from the public booking surface, the dashboard, the MCP tools,
-- and the Xkedule webhook goes through either createServiceRoleClient()
-- (bypasses RLS by design) or the authenticated org-scoped client -- never a
-- browser/anon Supabase client. Removing these policies does not require any
-- client-side code change.
--
-- Regression-safe: authenticated org-scoped access to all three tables is
-- preserved by the existing FOR ALL policies (bookings_org_isolation,
-- user_availability_org_write, event_types_org_isolation), none of which are
-- touched by this migration.
--
-- Idempotent: safe to re-run.
-- =============================================================================

-- Anon could previously INSERT an arbitrary booking row directly (any org_id,
-- any status), bypassing all server-side validation, rate limiting, and the
-- CAL-01 slot-validation helper. No legitimate code path uses this --
-- createBooking/createBookingInternal/bookings_create all use the service
-- role client.
DROP POLICY IF EXISTS bookings_public_insert ON public.bookings;

-- Anon could previously SELECT every org's weekly availability. Public
-- booking pages already fetch this via the service-role client
-- (src/app/book/[slug]/[eventType]/page.tsx).
DROP POLICY IF EXISTS user_availability_public_select ON public.user_availability;

-- Anon could previously enumerate every active event type across every
-- tenant (title, description, duration, pricing-adjacent fields). Public
-- pages already use service-role reads.
DROP POLICY IF EXISTS event_types_public_select ON public.event_types;

-- =============================================================================
-- Footer
--   After this migration, the anon key can no longer read or write bookings,
--   user_availability, or event_types directly. All public booking flows
--   continue to work unchanged because they already exclusively use
--   createServiceRoleClient() (src/app/book/**, calendar server actions).
--   Authenticated org members are unaffected (org-scoped FOR ALL policies
--   remain in place).
-- =============================================================================

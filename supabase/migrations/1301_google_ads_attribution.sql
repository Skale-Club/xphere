-- =============================================================================
-- Migration 1301: Google Ads click-id capture + booking attribution
-- =============================================================================
-- Phase E (.planning/clients/o-bigode-portugues/PHASE-E-SPEC.md) — click ->
-- visit -> booking -> offline conversion, as a platform capability (every
-- tenant/org), first exercised end-to-end for Bigode.
--
-- E1: analytics_sessions gains gclid/gbraid/wbraid, mirroring the existing
-- fbclid column -- same nullable text, same "captured once on session_start"
-- lifecycle. Only gclid gets a lookup index: it is the overwhelmingly common
-- case (Search/PMax) and the only one any current or planned query filters
-- on; gbraid/wbraid (app/web-to-app flows) are stored for completeness and
-- upload but not yet queried standalone.
--
-- E3: bookings gains a jsonb `attribution` column so the mirrored Xkedule
-- booking can carry the full click/UTM bundle the fixed data contract in
-- PHASE-E-SPEC.md defines (gclid/gbraid/wbraid/fbclid/utm_*/landing_page/
-- referrer/captured_at/xphere_visitor_id), for attribution reporting and as
-- the input to E4's offline-conversion upload. Nullable: most bookings
-- (created directly in the admin, or from a tenant with no Xphere analytics
-- script installed) carry no attribution at all -- see
-- src/lib/xkedule/attribution.ts's tolerant parser.
--
-- Idempotent: safe to re-run against a database that already has these
-- columns (e.g. a fresh `supabase db reset` replaying this file, or a retry
-- after a partial apply).
-- =============================================================================

BEGIN;

ALTER TABLE public.analytics_sessions
  ADD COLUMN IF NOT EXISTS gclid TEXT,
  ADD COLUMN IF NOT EXISTS gbraid TEXT,
  ADD COLUMN IF NOT EXISTS wbraid TEXT;

CREATE INDEX IF NOT EXISTS idx_analytics_sessions_gclid
  ON public.analytics_sessions (gclid)
  WHERE gclid IS NOT NULL;

COMMENT ON COLUMN public.analytics_sessions.gclid IS
  'Google Ads click id captured from the landing URL by the analytics script (90-day client-side validity, newest wins) -- mirrors fbclid. Migration 1301.';
COMMENT ON COLUMN public.analytics_sessions.gbraid IS
  'Google Ads web-to-app click id, same capture/validity rule as gclid. Migration 1301.';
COMMENT ON COLUMN public.analytics_sessions.wbraid IS
  'Google Ads app-to-web click id, same capture/validity rule as gclid. Migration 1301.';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS attribution JSONB;

COMMENT ON COLUMN public.bookings.attribution IS
  'Click/UTM attribution bundle from the fixed Xkedule<->Xphere webhook contract (PHASE-E-SPEC.md E3): { xphere_visitor_id, gclid, gbraid, wbraid, fbclid, utm_source, utm_medium, utm_campaign, utm_term, utm_content, landing_page, referrer, captured_at }. Null when the booking carried no attribution (e.g. created in the admin). Migration 1301.';

COMMIT;

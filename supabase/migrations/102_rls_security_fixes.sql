-- =============================================================================
-- Migration 102: RLS Security Fixes
-- =============================================================================
-- Enable Row Level Security on two tables that were left unprotected:
--
-- 1. _location_kinds  — static lookup table; authenticated users read-only.
--    No client writes needed — values are managed via migrations only.
--
-- 2. scheduled_workflow_ticks — internal scheduler idempotency table.
--    Only the service role (cron/Edge Functions) should access it.
--    No client policy = no authenticated/anon access via PostgREST.
-- =============================================================================

-- ── _location_kinds ──────────────────────────────────────────────────────────

ALTER TABLE public._location_kinds ENABLE ROW LEVEL SECURITY;

-- Authenticated users can read location kinds (needed for UI dropdowns).
CREATE POLICY "location_kinds_authenticated_read"
  ON public._location_kinds
  FOR SELECT
  TO authenticated
  USING (true);

-- ── scheduled_workflow_ticks ──────────────────────────────────────────────────

ALTER TABLE public.scheduled_workflow_ticks ENABLE ROW LEVEL SECURITY;

-- No policies = no access for anon or authenticated roles.
-- Service role bypasses RLS and retains full access for the cron tick handler.

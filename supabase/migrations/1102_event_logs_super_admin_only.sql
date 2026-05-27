-- =============================================================================
-- Migration 1102: Event logs are platform-admin only
--
-- event_logs is an operational observability table for the platform control
-- plane. Tenant users should not read it directly, including org_id IS NULL
-- platform events. Super-admin UI reads it through trusted service-role server
-- actions only.
-- =============================================================================

DROP POLICY IF EXISTS "org members read own logs" ON public.event_logs;
DROP POLICY IF EXISTS "service role insert" ON public.event_logs;

-- Defense in depth: RLS blocks reads, and table privileges are removed from
-- browser-facing roles. The service role still bypasses RLS for trusted server
-- paths such as logging ingestion and /admin/logs.
REVOKE SELECT, INSERT, UPDATE, DELETE ON public.event_logs FROM anon, authenticated;

CREATE POLICY "service role insert"
  ON public.event_logs
  FOR INSERT
  TO service_role
  WITH CHECK (true);

COMMENT ON TABLE public.event_logs IS
  'Structured operational event log. Ingested via service-role only. '
  'Readable only through trusted platform-admin server paths. '
  'Tenant users must not read this table directly.';

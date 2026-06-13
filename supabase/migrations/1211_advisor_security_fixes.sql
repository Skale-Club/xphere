-- Migration 1211: advisor security fixes (rls_disabled_in_public, security_definer_view)
-- Applied to prod 2026-06-13 via Supabase MCP. Idempotent — safe to re-run.
--
-- 1) platform_email_settings is a platform singleton (no org_id) accessed only by
--    the service-role client behind a PLATFORM_ADMIN_EMAIL gate (see
--    src/app/(admin)/admin/settings/email-actions.ts + src/lib/email/resend.ts).
--    Enabling RLS with no policy locks it to service-role (which bypasses RLS),
--    closing it to anon/authenticated. No app path uses the authenticated client.
ALTER TABLE public.platform_email_settings ENABLE ROW LEVEL SECURITY;

-- 2) agent_tools_resolved is a plain view owned by postgres; with the default
--    (definer) behaviour it bypasses RLS on its base tables. Nothing in app code
--    or any SQL function queries it, so switching to security_invoker is a no-op
--    for callers while satisfying the linter (base-table RLS now applies).
ALTER VIEW public.agent_tools_resolved SET (security_invoker = on);

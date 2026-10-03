-- 1308_org_from_request_header.sql
--
-- Per-tab active organization.
--
-- Until now the active org was per USER (public.user_active_org), so an agency
-- with client A in one browser tab and client B in another got whichever org
-- was switched to last in BOTH tabs on the next refresh.
--
-- The dashboard now pins the org in the URL (`/o/<org-id>/...`) and the server
-- forwards it to PostgREST in the `x-xphere-org` request header (see
-- src/lib/org/request-org.ts). get_current_org_id() — the resolver every RLS
-- policy uses — now prefers that header, but ONLY when the caller is a member
-- of the requested org. The header is a selector, never an authorization: a
-- forged value can only pick one of the caller's own orgs, and anything else
-- (non-member, malformed, absent) falls through to the previous behaviour.
--
-- Contexts without request headers (Realtime, pg_cron, service role, direct
-- SQL) keep resolving exactly as before.
--
-- Idempotent: CREATE OR REPLACE with an unchanged signature, so grants and
-- every policy that references the function are preserved.

CREATE OR REPLACE FUNCTION public.get_current_org_id()
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  WITH requested AS (
    SELECT CASE
      WHEN h.v ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        THEN h.v::uuid
    END AS org_id
    FROM (
      SELECT NULLIF(current_setting('request.headers', true), '')::json ->> 'x-xphere-org' AS v
    ) h
  )
  SELECT COALESCE(
    (SELECT m.organization_id
       FROM public.org_members m, requested r
      WHERE m.user_id = (SELECT auth.uid())
        AND m.organization_id = r.org_id
      LIMIT 1),
    (SELECT organization_id FROM public.user_active_org WHERE user_id = (SELECT auth.uid())),
    (SELECT organization_id FROM public.org_members WHERE user_id = (SELECT auth.uid()) LIMIT 1)
  );
$$;

COMMENT ON FUNCTION public.get_current_org_id() IS
  'Active org for the caller: the x-xphere-org request header when the caller is a member of that org (per-tab org pinned in the URL), else user_active_org, else the first membership.';

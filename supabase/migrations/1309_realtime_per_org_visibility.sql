-- 1309_realtime_per_org_visibility.sql
--
-- Realtime for per-tab orgs (follow-up to 1308).
--
-- 1308 lets every browser tab pin its own org via the x-xphere-org request
-- header. Supabase Realtime cannot carry it: postgres_changes authorizes each
-- change by re-reading the row as the subscriber (realtime.apply_rls sets the
-- role and request.jwt.claims, nothing else), so get_current_org_id() fell
-- back to user_active_org and a tab pinned to org B stopped receiving org B
-- events whenever another tab made org A the default.
--
-- Fix: inside that Realtime RLS check, the org-scoped tables below accept rows
-- from ANY org the subscriber is a member of. Each tab picks its own org with
-- its subscription filter (org_id=eq.<tab org>, or the id of a conversation,
-- import or call that belongs to it). Everywhere else the policies are exactly
-- what they were — see "Why IMMUTABLE" below.
--
-- Realtime context = connection application_name 'realtime%' (the
-- `realtime_rls` connection runs apply_rls) AND no request.headers. PostgREST
-- sets request.headers on every request, so API traffic can never match. A
-- false positive could only widen reads to the caller's OWN orgs — never to an
-- org they are not a member of.
--
-- Writes (WITH CHECK) stay pinned to get_current_org_id(). The RBAC
-- "assigned only" seal on conversations is evaluated against the row's org in
-- the Realtime path (the caller's role can differ per org).
--
-- Why IMMUTABLE: is_realtime_rls_check() reads session settings, so strictly
-- it is STABLE. It is declared IMMUTABLE on purpose so the planner evaluates it
-- once at plan time and folds each policy's CASE away: an API query plans
-- against `org_id = get_current_org_id()` exactly as before (same index
-- conditions, same row estimates), and only Realtime's own statement plans
-- against the member-orgs branch. A STABLE version (or a `= ANY(array)` form)
-- left the branch to run time and degraded plans on conversation_messages.
-- This is sound because the answer is fixed for the life of a connection's
-- statements: PostgREST connections never become Realtime ones and vice
-- versa, so a cached plan is never reused across the two contexts.
--
-- Idempotent: CREATE OR REPLACE functions, DROP POLICY IF EXISTS + CREATE.

CREATE OR REPLACE FUNCTION public.is_realtime_rls_check()
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
BEGIN
  RETURN COALESCE(current_setting('application_name', true), '') LIKE 'realtime%'
     AND COALESCE(current_setting('request.headers', true), '') = '';
END;
$$;

-- Every org the caller belongs to (Realtime branch only).
CREATE OR REPLACE FUNCTION public.member_org_ids()
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ARRAY(
    SELECT m.organization_id FROM public.org_members m WHERE m.user_id = (SELECT auth.uid())
  );
$$;

-- rbac_seal_active(p_group) for an explicit org instead of the active one.
CREATE OR REPLACE FUNCTION public.rbac_seal_active_in(p_org uuid, p_group text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH r AS (
    SELECT m.role::text AS role
    FROM public.org_members m
    WHERE m.user_id = (SELECT auth.uid()) AND m.organization_id = p_org
    LIMIT 1
  )
  SELECT CASE
    WHEN public.is_platform_admin() THEN false
    WHEN (SELECT role FROM r) = 'owner' THEN false
    WHEN (SELECT role FROM r) = 'admin'
         AND p_group = ANY (ARRAY['contacts', 'pipeline', 'tasks']) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.role_settings rs
      WHERE rs.organization_id = p_org
        AND rs.role = (SELECT role FROM r)
        AND rs.restrict_to_assigned = true
    )
  END;
$$;

REVOKE EXECUTE ON FUNCTION public.member_org_ids() FROM anon;
REVOKE EXECUTE ON FUNCTION public.rbac_seal_active_in(uuid, text) FROM anon;

-- ---------------------------------------------------------------------------
-- Org isolation on the tables published to supabase_realtime that are scoped
-- by the active org. Same names, commands, roles and (ELSE branch) the exact
-- previous expressions.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS org_isolation ON public.conversations;
CREATE POLICY org_isolation ON public.conversations
  FOR ALL TO authenticated
  USING (CASE WHEN public.is_realtime_rls_check()
    THEN org_id = ANY (public.member_org_ids())
    ELSE org_id = public.get_current_org_id() END)
  WITH CHECK (org_id = public.get_current_org_id());

DROP POLICY IF EXISTS conversations_assigned_seal ON public.conversations;
CREATE POLICY conversations_assigned_seal ON public.conversations
  AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (CASE WHEN public.is_realtime_rls_check()
    THEN NOT public.rbac_seal_active_in(org_id, 'chat')
         OR assigned_user_id = (SELECT auth.uid())
    ELSE NOT (SELECT public.rbac_seal_active('chat'))
         OR assigned_user_id = (SELECT auth.uid()) END);

DROP POLICY IF EXISTS org_isolation ON public.conversation_messages;
CREATE POLICY org_isolation ON public.conversation_messages
  FOR ALL TO authenticated
  USING (CASE WHEN public.is_realtime_rls_check()
    THEN org_id = ANY (public.member_org_ids())
    ELSE org_id = public.get_current_org_id() END)
  WITH CHECK (org_id = public.get_current_org_id());

DROP POLICY IF EXISTS call_logs_org_isolation ON public.call_logs;
CREATE POLICY call_logs_org_isolation ON public.call_logs
  FOR ALL TO public
  USING (CASE WHEN public.is_realtime_rls_check()
    THEN org_id = ANY (public.member_org_ids())
    ELSE org_id = (SELECT public.get_current_org_id()) END)
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS contact_imports_org_isolation ON public.contact_imports;
CREATE POLICY contact_imports_org_isolation ON public.contact_imports
  FOR ALL TO public
  USING (CASE WHEN public.is_realtime_rls_check()
    THEN org_id = ANY (public.member_org_ids())
    ELSE org_id = (SELECT public.get_current_org_id()) END)
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

DROP POLICY IF EXISTS copilot_credit_balances_org_read ON public.copilot_credit_balances;
CREATE POLICY copilot_credit_balances_org_read ON public.copilot_credit_balances
  FOR SELECT TO authenticated
  USING (CASE WHEN public.is_realtime_rls_check()
    THEN org_id = ANY (public.member_org_ids())
    ELSE org_id = (SELECT public.get_current_org_id()) END);

DROP POLICY IF EXISTS notifications_owner ON public.notifications;
CREATE POLICY notifications_owner ON public.notifications
  FOR ALL TO public
  USING (user_id = auth.uid() AND CASE WHEN public.is_realtime_rls_check()
    THEN org_id = ANY (public.member_org_ids())
    ELSE org_id = (SELECT public.get_current_org_id()) END)
  WITH CHECK (user_id = auth.uid() AND org_id = (SELECT public.get_current_org_id()));

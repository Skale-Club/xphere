-- =============================================================================
-- Migration 1114: RBAC data-layer sealing ("Restrict data visibility to only
-- assigned data") + owner backfill.
-- Project: Xphere / Active Projects / Roles, Permissions & Access Control
-- Depends on: 1113_rbac_foundation.sql (user_role 'owner', role_settings,
--             current_org_role(), is_platform_admin()).
--
-- DESIGN: the seal NARROWS row visibility without rewriting the existing
-- *_org_isolation policies. We add an `AS RESTRICTIVE FOR SELECT` policy per
-- sealed table — Postgres AND's restrictive policies with the permissive ones,
-- so org isolation and all write paths are untouched. Fully additive/reversible.
--
-- SEAL RULES (from the GHL reference + Final Spec):
--   * Owner + platform staff: never sealed.
--   * Admin: sealed ONLY on non-exempt groups. Admins ALWAYS keep full
--     visibility into contacts / pipeline / tasks (the exempt set).
--   * User (member): sealed on every sealed group when its role toggle is on.
-- Sealed here: contacts, conversations (chat), opportunities (pipeline), tasks.
-- Scheduling (bookings) is deferred — it has no assignee column and uses
-- public-insert semantics that need separate design.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Section 1: Owner backfill (idempotent)
-- Each org needs an owner. Promote the earliest admin (the de-facto creator)
-- to 'owner' — but ONLY for orgs that don't already have one. Safe to re-run.
-- 'owner' is usable here because it was committed by migration 1113.
-- ---------------------------------------------------------------------------
WITH orgs_without_owner AS (
  SELECT o.id AS org_id
  FROM public.organizations o
  WHERE NOT EXISTS (
    SELECT 1 FROM public.org_members m
    WHERE m.organization_id = o.id AND m.role::text = 'owner'
  )
),
first_admin AS (
  SELECT DISTINCT ON (m.organization_id) m.id
  FROM public.org_members m
  JOIN orgs_without_owner ow ON ow.org_id = m.organization_id
  WHERE m.role::text = 'admin'
  ORDER BY m.organization_id, m.created_at ASC
)
UPDATE public.org_members m
SET role = 'owner'
FROM first_admin fa
WHERE m.id = fa.id;

-- ---------------------------------------------------------------------------
-- Section 2: contacts.assigned_to (missing — opportunities/tasks/conversations
-- already have an assignee). NULL = unassigned -> not visible to a sealed user.
-- ---------------------------------------------------------------------------
ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_org_assigned_to
  ON public.contacts (org_id, assigned_to)
  WHERE assigned_to IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Section 3: rbac_seal_active(group) — is the assigned-only seal in effect for
-- the current caller on this group? Constant argument + STABLE + SECURITY
-- DEFINER => evaluated ONCE per query (cached), not per row. The per-row check
-- in each policy is then just `assigned = uid`.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rbac_seal_active(p_group TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.is_platform_admin() THEN false
    WHEN public.current_org_role()::text = 'owner' THEN false
    -- Admins keep full visibility into the exempt set regardless of the toggle.
    WHEN public.current_org_role()::text = 'admin'
         AND p_group = ANY (ARRAY['contacts', 'pipeline', 'tasks']) THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.role_settings rs
      WHERE rs.organization_id = public.get_current_org_id()
        AND rs.role = public.current_org_role()::text
        AND rs.restrict_to_assigned = true
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.rbac_seal_active(TEXT) TO authenticated;

-- ---------------------------------------------------------------------------
-- Section 4: restrictive SELECT seal per table.
-- Visible when sealing is off for this caller, OR the row is assigned to them.
-- ---------------------------------------------------------------------------

-- contacts (exempt for admins)
DROP POLICY IF EXISTS contacts_assigned_seal ON public.contacts;
CREATE POLICY contacts_assigned_seal ON public.contacts
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT (SELECT public.rbac_seal_active('contacts'))
    OR assigned_to = (SELECT auth.uid())
  );

-- opportunities / pipeline (exempt for admins)
DROP POLICY IF EXISTS opportunities_assigned_seal ON public.opportunities;
CREATE POLICY opportunities_assigned_seal ON public.opportunities
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT (SELECT public.rbac_seal_active('pipeline'))
    OR assigned_to = (SELECT auth.uid())
  );

-- tasks (exempt for admins)
DROP POLICY IF EXISTS tasks_assigned_seal ON public.tasks;
CREATE POLICY tasks_assigned_seal ON public.tasks
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT (SELECT public.rbac_seal_active('tasks'))
    OR assigned_to = (SELECT auth.uid())
  );

-- conversations / chat (NOT exempt — admins are sealed too when the toggle is on)
DROP POLICY IF EXISTS conversations_assigned_seal ON public.conversations;
CREATE POLICY conversations_assigned_seal ON public.conversations
  AS RESTRICTIVE FOR SELECT TO authenticated
  USING (
    NOT (SELECT public.rbac_seal_active('chat'))
    OR assigned_user_id = (SELECT auth.uid())
  );

-- =============================================================================
-- FOLLOW-UP (separate migration / decision, NOT here):
--   * Scheduling (bookings) sealing — needs an assignee column + handling of
--     public/anon booking inserts.
--   * Whether to extend the seal to UPDATE/DELETE (currently SELECT-only =
--     "data visibility", matching the GHL toggle). A sealed user already cannot
--     read unowned rows; blind-write hardening is a separate decision.
--   * Default `assigned_to` to the creator on contact/opportunity/task INSERT
--     so a sealed user sees what they create.
-- =============================================================================

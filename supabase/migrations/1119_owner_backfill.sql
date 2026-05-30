-- =============================================================================
-- Migration 1119: Owner backfill — promote each org's earliest admin to 'owner'.
-- Project: Xphere / Active Projects / Roles, Permissions & Access Control
-- Depends on: 1116 (user_role 'owner'), 1118 (legacy RLS broadened to owner).
--
-- ⚠️ DEPLOY-COUPLED: this changes live behavior. The app's requireAdmin()/isAdmin
-- must already accept 'owner' (shipped on feat/leila/hierarchy-project). Apply
-- this in lockstep with deploying that code, or promoted owners temporarily lose
-- admin-gated abilities in the old code. Idempotent — only acts on orgs that
-- don't already have an owner.
-- =============================================================================
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

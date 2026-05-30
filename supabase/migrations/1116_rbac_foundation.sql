-- =============================================================================
-- Migration 1116: RBAC Foundation (Roles, Permissions & Access Control)
-- Project: Xphere / Active Projects / Roles, Permissions & Access Control
--
-- Adds the 4-tier role model on top of the existing org/RLS foundation:
--   Super Admin (Skale Club / platform) -> Owner (org) -> Admin -> User(member)
--
-- ISOLATION IS NON-NEGOTIABLE: this migration NEVER relaxes tenant isolation.
-- Each org's data stays sealed by the existing get_current_org_id() RLS. The
-- Super Admin "sees everything" only through the platform/admin surface
-- (service-role / platform queries) — not by weakening tenant RLS here.
--
-- NOTE ON ENUM SAFETY: 'owner' is added to public.user_role but is NEVER used
-- as an enum literal in this same migration (Postgres forbids using a freshly
-- added enum value in the same transaction). All role comparisons cast to text
-- (role::text = 'owner'), so 'owner' is only ever a text literal here.
-- Backfilling existing org creators to 'owner' is a SEPARATE follow-up step.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Section 1: Extend the org role enum with 'owner'
-- ---------------------------------------------------------------------------
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'owner';

-- ---------------------------------------------------------------------------
-- Section 2: platform_admins — the Super Admin (Skale Club) tier
-- Multi-employee platform operator. Generalizes the single PLATFORM_ADMIN_EMAIL
-- env check into a real table so Skale Club can have its own Admin/User staff.
-- ---------------------------------------------------------------------------
CREATE TABLE public.platform_admins (
  user_id    UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role       TEXT        NOT NULL DEFAULT 'platform_admin'
                         CHECK (role IN ('platform_admin', 'platform_member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- is_platform_admin(): true if the caller is any platform staff.
-- SECURITY DEFINER bypasses RLS on platform_admins (avoids recursive RLS).
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.platform_admins
    WHERE user_id = (SELECT auth.uid())
  );
$$;

-- Only platform staff can read the platform roster. Writes are service-role only
-- (no INSERT/UPDATE/DELETE policy -> denied for `authenticated`; service_role
-- bypasses RLS). Bootstrap the first platform admin via a trusted server action.
CREATE POLICY "platform_admins_select" ON public.platform_admins
  FOR SELECT TO authenticated
  USING (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Section 3: current_org_role() — caller's role in their active org
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_org_role()
RETURNS public.user_role
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT role
  FROM public.org_members
  WHERE user_id = (SELECT auth.uid())
    AND organization_id = public.get_current_org_id()
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Section 4: role_permissions — per-org, per-configurable-role grant matrix
-- Only 'admin' and 'member' are configured here. 'owner' and platform staff get
-- implicit full access in has_permission() and are never stored as rows.
-- ---------------------------------------------------------------------------
CREATE TABLE public.role_permissions (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role            TEXT        NOT NULL CHECK (role IN ('admin', 'member')),
  permission_key  TEXT        NOT NULL,
  enabled         BOOLEAN     NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, role, permission_key)
);

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_role_permissions_org ON public.role_permissions(organization_id);

-- ---------------------------------------------------------------------------
-- Section 5: role_settings — per-org, per-configurable-role flags
-- Holds the "Restrict data visibility to only assigned data" seal toggle.
-- ---------------------------------------------------------------------------
CREATE TABLE public.role_settings (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  role                 TEXT        NOT NULL CHECK (role IN ('admin', 'member')),
  restrict_to_assigned BOOLEAN     NOT NULL DEFAULT false,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, role)
);

ALTER TABLE public.role_settings ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- Section 6: has_permission(key) — authoritative server-side permission check
-- Used by server helpers and (later) by data-table RLS. Owner + platform staff
-- always pass; admin/member resolved against the grant matrix.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT CASE
    WHEN public.is_platform_admin() THEN true
    WHEN public.current_org_role()::text = 'owner' THEN true
    ELSE EXISTS (
      SELECT 1
      FROM public.role_permissions rp
      WHERE rp.organization_id = public.get_current_org_id()
        AND rp.role = public.current_org_role()::text
        AND rp.permission_key = p_key
        AND rp.enabled = true
    )
  END;
$$;

-- ---------------------------------------------------------------------------
-- Section 7: RLS for role_permissions and role_settings
-- Read: any member of the org (so the app can resolve its own permissions).
-- Write: org Owner only (the panel is an Owner-level surface). Platform staff
--        configure their own org as its Owner; cross-org platform admin config
--        goes through service-role.
-- ---------------------------------------------------------------------------
CREATE POLICY "role_permissions_select" ON public.role_permissions
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

CREATE POLICY "role_permissions_write" ON public.role_permissions
  FOR ALL TO authenticated
  USING (
    organization_id = (SELECT public.get_current_org_id())
    AND (SELECT public.current_org_role())::text = 'owner'
  )
  WITH CHECK (
    organization_id = (SELECT public.get_current_org_id())
    AND (SELECT public.current_org_role())::text = 'owner'
  );

CREATE POLICY "role_settings_select" ON public.role_settings
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

CREATE POLICY "role_settings_write" ON public.role_settings
  FOR ALL TO authenticated
  USING (
    organization_id = (SELECT public.get_current_org_id())
    AND (SELECT public.current_org_role())::text = 'owner'
  )
  WITH CHECK (
    organization_id = (SELECT public.get_current_org_id())
    AND (SELECT public.current_org_role())::text = 'owner'
  );

-- ---------------------------------------------------------------------------
-- Section 8: grants
-- ---------------------------------------------------------------------------
GRANT SELECT ON public.platform_admins  TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_settings    TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_platform_admin()        TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_role()         TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_permission(TEXT)       TO authenticated;

-- =============================================================================
-- FOLLOW-UP (separate migration, NOT in this file):
--   * Backfill: set each org's creator/earliest admin to role 'owner'.
--   * Add assigned_to_user_id to sealed tables (contacts, conversations,
--     opportunities/pipeline, tasks, scheduling) and extend their RLS for the
--     "restrict_to_assigned" seal — with the Admin partial-exemption
--     (contacts/pipeline/tasks always fully visible to admins).
-- These touch existing data/tables and are done per-table with verification.
-- =============================================================================

-- =============================================================================
-- Migration 1146: Custom roles
--
-- Adds org_custom_roles and custom_role_permissions tables so org owners can
-- define named roles beyond the built-in admin / member pair.
-- Extends org_members and org_invites with custom_role_id (nullable).
-- Updates has_permission() to resolve grants from the custom role first.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- org_custom_roles — named role definitions per org
-- ---------------------------------------------------------------------------
CREATE TABLE public.org_custom_roles (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            TEXT        NOT NULL,
  description     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE public.org_custom_roles ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_custom_roles_org ON public.org_custom_roles(organization_id);

-- ---------------------------------------------------------------------------
-- custom_role_permissions — permission grants for each custom role
-- ---------------------------------------------------------------------------
CREATE TABLE public.custom_role_permissions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  custom_role_id UUID        NOT NULL REFERENCES public.org_custom_roles(id) ON DELETE CASCADE,
  permission_key TEXT        NOT NULL,
  enabled        BOOLEAN     NOT NULL DEFAULT false,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (custom_role_id, permission_key)
);

ALTER TABLE public.custom_role_permissions ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_custom_role_perms_role ON public.custom_role_permissions(custom_role_id);

-- ---------------------------------------------------------------------------
-- Extend org_members and org_invites with optional custom_role_id
-- ---------------------------------------------------------------------------
ALTER TABLE public.org_members
  ADD COLUMN custom_role_id UUID REFERENCES public.org_custom_roles(id) ON DELETE SET NULL;

ALTER TABLE public.org_invites
  ADD COLUMN custom_role_id UUID REFERENCES public.org_custom_roles(id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- RLS: org_custom_roles
-- Any org member can read; only owners can write.
-- ---------------------------------------------------------------------------
CREATE POLICY "org_custom_roles_select" ON public.org_custom_roles
  FOR SELECT TO authenticated
  USING (organization_id = (SELECT public.get_current_org_id()));

CREATE POLICY "org_custom_roles_write" ON public.org_custom_roles
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
-- RLS: custom_role_permissions
-- Any org member can read; only owners can write.
-- ---------------------------------------------------------------------------
CREATE POLICY "custom_role_permissions_select" ON public.custom_role_permissions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_custom_roles ocr
      WHERE ocr.id = custom_role_id
        AND ocr.organization_id = (SELECT public.get_current_org_id())
    )
  );

CREATE POLICY "custom_role_permissions_write" ON public.custom_role_permissions
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.org_custom_roles ocr
      WHERE ocr.id = custom_role_id
        AND ocr.organization_id = (SELECT public.get_current_org_id())
    )
    AND (SELECT public.current_org_role())::text = 'owner'
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.org_custom_roles ocr
      WHERE ocr.id = custom_role_id
        AND ocr.organization_id = (SELECT public.get_current_org_id())
    )
    AND (SELECT public.current_org_role())::text = 'owner'
  );

-- ---------------------------------------------------------------------------
-- Update has_permission() to resolve custom role grants first
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_permission(p_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  _role           public.user_role;
  _custom_role_id UUID;
  _org_id         UUID;
  _enabled        BOOLEAN;
BEGIN
  IF public.is_platform_admin() THEN RETURN TRUE; END IF;

  _role := public.current_org_role();
  IF _role IS NULL THEN RETURN FALSE; END IF;
  IF _role::text = 'owner' THEN RETURN TRUE; END IF;

  _org_id := public.get_current_org_id();

  -- If the member has a custom role, resolve permissions from it exclusively.
  SELECT custom_role_id INTO _custom_role_id
  FROM public.org_members
  WHERE user_id = (SELECT auth.uid())
    AND organization_id = _org_id;

  IF _custom_role_id IS NOT NULL THEN
    SELECT enabled INTO _enabled
    FROM public.custom_role_permissions
    WHERE custom_role_id = _custom_role_id
      AND permission_key = p_key;
    RETURN COALESCE(_enabled, FALSE);
  END IF;

  -- Fall back to the built-in role permissions matrix.
  RETURN EXISTS (
    SELECT 1
    FROM public.role_permissions rp
    WHERE rp.organization_id = _org_id
      AND rp.role             = _role::text
      AND rp.permission_key   = p_key
      AND rp.enabled          = true
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON public.org_custom_roles        TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.custom_role_permissions TO authenticated;

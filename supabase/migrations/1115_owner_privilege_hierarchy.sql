-- =============================================================================
-- Migration 1115: Privilege hierarchy — treat 'owner' as >= 'admin' in legacy
-- RLS policies that predate the RBAC role model.
-- Project: Xphere / Active Projects / Roles, Permissions & Access Control
-- Depends on: 1113 (adds 'owner' to public.user_role).
--
-- WHY: migration 1114 promotes each org's creator to 'owner'. Several older
-- policies hardcode `role = 'admin'` for management actions (invites, contact
-- merge exclusions, contact verifications). Without this, a freshly-promoted
-- Owner would LOSE those abilities. We broaden each to `role IN ('admin','owner')`.
-- 'owner' is used only as a literal here — safe, since 1113 committed the value.
-- Policy bodies are reproduced verbatim except for the broadened role check.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- org_invites (046) — admin/owner can manage invites
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "org_invites_select" ON public.org_invites;
CREATE POLICY "org_invites_select" ON public.org_invites
  FOR SELECT TO authenticated
  USING (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
        AND organization_id = (SELECT public.get_current_org_id())
        AND role IN ('admin', 'owner')
    )
  );

DROP POLICY IF EXISTS "org_invites_insert" ON public.org_invites;
CREATE POLICY "org_invites_insert" ON public.org_invites
  FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
        AND organization_id = (SELECT public.get_current_org_id())
        AND role IN ('admin', 'owner')
    )
  );

DROP POLICY IF EXISTS "org_invites_update" ON public.org_invites;
CREATE POLICY "org_invites_update" ON public.org_invites
  FOR UPDATE TO authenticated
  USING (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
        AND organization_id = (SELECT public.get_current_org_id())
        AND role IN ('admin', 'owner')
    )
  )
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
  );

DROP POLICY IF EXISTS "org_invites_delete" ON public.org_invites;
CREATE POLICY "org_invites_delete" ON public.org_invites
  FOR DELETE TO authenticated
  USING (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
      WHERE user_id = (SELECT auth.uid())
        AND organization_id = (SELECT public.get_current_org_id())
        AND role IN ('admin', 'owner')
    )
  );

-- ---------------------------------------------------------------------------
-- contact_merge_exclusions (1057) — admin/owner can INSERT
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS contact_merge_exclusions_insert ON public.contact_merge_exclusions;
CREATE POLICY contact_merge_exclusions_insert
  ON public.contact_merge_exclusions FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_merge_exclusions.org_id
         AND role IN ('admin', 'owner')
    )
  );

-- ---------------------------------------------------------------------------
-- contact_verifications (1062) — admin/owner can INSERT/UPDATE/DELETE
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS contact_verifications_insert ON public.contact_verifications;
CREATE POLICY contact_verifications_insert
  ON public.contact_verifications FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_verifications.org_id
         AND role IN ('admin', 'owner')
    )
  );

DROP POLICY IF EXISTS contact_verifications_update ON public.contact_verifications;
CREATE POLICY contact_verifications_update
  ON public.contact_verifications FOR UPDATE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_verifications.org_id
         AND role IN ('admin', 'owner')
    )
  );

DROP POLICY IF EXISTS contact_verifications_delete ON public.contact_verifications;
CREATE POLICY contact_verifications_delete
  ON public.contact_verifications FOR DELETE TO authenticated
  USING (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_verifications.org_id
         AND role IN ('admin', 'owner')
    )
  );

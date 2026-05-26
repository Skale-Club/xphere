-- =============================================================================
-- Migration 1062: Contact Verifications (CID-14)
--
-- Phase 110 of v3.0 Contact Identity workstream. Adds verification audit log
-- and enables the manual "Mark verified" admin path. Future SMS/email-click
-- triggers write to the same table without schema change.
--
-- Depends on:
--   * 1056 (identity_status enum on contacts)
--   * 1057 (RLS template + org_members admin-gating pattern)
--   * 1060/1061 (no functional dep; ordering only)
--
-- Scope (CID-14):
--   * contact_verifications table
--   * UNIQUE (org_id, contact_id, identifier_type, identifier_value)
--   * INDEX (contact_id) for reverse lookup (badge "is this contact verified?")
--   * CHECK enums on identifier_type ('phone','email') and method
--     ('manual','sms_reply','email_click','oauth') -- wide enum to avoid
--     future ALTER (D-05a)
--   * RLS enabled with 4 policies: SELECT for org members, INSERT/UPDATE/DELETE
--     gated by org_members.role='admin' (mirrors 1057 template)
--
-- NOT in scope: SMS/email triggers (deferred), source column drop (deferred).
-- =============================================================================

-- ----- Section 1: contact_verifications table -------------------------------

CREATE TABLE IF NOT EXISTS public.contact_verifications (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id        uuid NOT NULL REFERENCES public.contacts(id)       ON DELETE CASCADE,
  identifier_type   text NOT NULL CHECK (identifier_type IN ('phone', 'email')),
  identifier_value  text NOT NULL,
  method            text NOT NULL CHECK (method IN ('manual', 'sms_reply', 'email_click', 'oauth')),
  verified_at       timestamptz NOT NULL DEFAULT now(),
  verified_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  UNIQUE (org_id, contact_id, identifier_type, identifier_value)
);

-- Reverse-lookup index: contact_id -> verifications (badge logic reads this
-- direction to determine "verified" state and which identifiers are verified).
CREATE INDEX IF NOT EXISTS idx_contact_verifications_contact_id
  ON public.contact_verifications (contact_id);

COMMENT ON TABLE public.contact_verifications IS
  'Audit log of contact identity verifications. One row per verified '
  '(contact, identifier) pair. UNIQUE on (org_id, contact_id, identifier_type, '
  'identifier_value) makes re-verification idempotent (23505 -> no-op).';

COMMENT ON COLUMN public.contact_verifications.method IS
  'Verification mechanism (Phase 110 D-05a wide enum). Phase 110 writes '
  'only ''manual''; sms_reply/email_click/oauth are reserved for follow-up '
  'milestones and avoid future ALTER CONSTRAINT.';

-- ----- Section 2: RLS enable + 4 policies (mirrors 1057 template) -----------

ALTER TABLE public.contact_verifications ENABLE ROW LEVEL SECURITY;

-- Authenticated members can SELECT within their active org.
CREATE POLICY contact_verifications_select
  ON public.contact_verifications FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- Only org admins (org_members.role = 'admin') can INSERT.
CREATE POLICY contact_verifications_insert
  ON public.contact_verifications FOR INSERT TO authenticated
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_verifications.org_id
         AND role            = 'admin'
    )
  );

-- Only org admins can UPDATE (rare -- re-method correction).
CREATE POLICY contact_verifications_update
  ON public.contact_verifications FOR UPDATE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_verifications.org_id
         AND role            = 'admin'
    )
  );

-- Only org admins can DELETE (revoke verification).
CREATE POLICY contact_verifications_delete
  ON public.contact_verifications FOR DELETE TO authenticated
  USING (
    org_id = (SELECT public.get_current_org_id())
    AND EXISTS (
      SELECT 1 FROM public.org_members
       WHERE user_id         = auth.uid()
         AND organization_id = contact_verifications.org_id
         AND role            = 'admin'
    )
  );

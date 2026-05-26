-- =============================================================================
-- Migration 1060: Contact Channel Identities (CID-09, CID-10)
--
-- Phase 108 of v3.0 Contact Identity workstream. Introduces the polymorphic
-- channel identity table so contacts can be reached on multiple providers
-- (whatsapp, evolution, telegram, instagram, messenger, facebook, webchat,
-- vapi) without duplicating contact rows.
--
-- Depends on:
--   * 1056 (contact_identity_audit) — identity_status, generated columns
--   * 1057 (contact_merge_tool) — RLS template (FOR SELECT/INSERT/UPDATE/DELETE
--     TO authenticated USING/WITH CHECK (org_id = (SELECT get_current_org_id())))
--   * 1059 (contacts_unique_constraints) — phone/email partial UNIQUEs
--
-- Scope (CID-09, CID-10):
--   * contact_channel_identities table + UNIQUE (org_id, provider, external_id)
--   * INDEX (contact_id) for reverse lookup (contact_id → identities)
--   * CHECK on provider enum (D-01 wide enum)
--   * RLS enabled with 4 policies scoped to get_current_org_id()
--   * Backfill INSERT...SELECT from contacts (idempotent ON CONFLICT DO NOTHING)
--   * COMMENT ON COLUMN contacts.source deprecation note (D-05)
--
-- NOT in scope: identity invariant trigger (Phase 109), source column drop
-- (Phase 110), verified state (Phase 110).
-- =============================================================================

-- ----- Section 1: contact_channel_identities table --------------------------

CREATE TABLE IF NOT EXISTS public.contact_channel_identities (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  contact_id   uuid NOT NULL REFERENCES public.contacts(id)       ON DELETE CASCADE,
  provider     text NOT NULL CHECK (provider IN (
    'whatsapp',
    'evolution',
    'telegram',
    'instagram',
    'messenger',
    'facebook',
    'webchat',
    'vapi'
  )),
  external_id  text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, provider, external_id)
);

-- Reverse-lookup index: contact_id → identities (Phase 109 invariant trigger,
-- Phase 110 UI surfacing, and the link-on-match path all read this direction).
CREATE INDEX IF NOT EXISTS idx_cci_contact_id
  ON public.contact_channel_identities (contact_id);

COMMENT ON TABLE public.contact_channel_identities IS
  'Channel-keyed identity for contacts. One contact can have many rows '
  '(one per provider + external_id). UNIQUE (org_id, provider, external_id) '
  'enforces no two contacts share the same channel identity within an org.';

COMMENT ON COLUMN public.contact_channel_identities.provider IS
  'Channel provider enum (Phase 108 D-01 wide enum). Adding a new provider '
  'requires DROP CONSTRAINT + ADD CONSTRAINT — keep ordering stable.';

COMMENT ON COLUMN public.contact_channel_identities.external_id IS
  'Provider-specific identifier. Shape varies: WhatsApp wa_id (digits, no +), '
  'Evolution remoteJid (e.g. "5511...@s.whatsapp.net"), Telegram chat_id '
  '(signed integer as string), Instagram/Messenger PSID, Vapi caller phone.';

-- ----- Section 2: RLS enable + 4 policies (mirrors 1057 template) -----------

ALTER TABLE public.contact_channel_identities ENABLE ROW LEVEL SECURITY;

CREATE POLICY contact_channel_identities_select
  ON public.contact_channel_identities
  FOR SELECT TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

CREATE POLICY contact_channel_identities_insert
  ON public.contact_channel_identities
  FOR INSERT TO authenticated
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

CREATE POLICY contact_channel_identities_update
  ON public.contact_channel_identities
  FOR UPDATE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

CREATE POLICY contact_channel_identities_delete
  ON public.contact_channel_identities
  FOR DELETE TO authenticated
  USING (org_id = (SELECT public.get_current_org_id()));

-- ----- Section 3: Backfill (D-06 idempotent, prod no-op) --------------------
-- Maps contacts.source values to provider values. Only the four channel-style
-- sources qualify; 'manual', 'sms', 'csv_import', 'ghl_sync' have no channel
-- identity. Cast source::text because ContactSource is a TS enum but stored
-- as text in SQL (no native pg enum). All four legal source values are also
-- valid provider values, so the cast is identity-preserving.

INSERT INTO public.contact_channel_identities
  (org_id, contact_id, provider, external_id, created_at)
SELECT
  c.org_id,
  c.id,
  c.source::text,
  c.external_id,
  c.created_at
FROM public.contacts c
WHERE c.source IN ('instagram','whatsapp','facebook','messenger')
  AND c.external_id IS NOT NULL
ON CONFLICT (org_id, provider, external_id) DO NOTHING;

-- ----- Section 4: contacts.source deprecation comment (D-05) ----------------

COMMENT ON COLUMN public.contacts.source IS
  'DEPRECATED Phase 108 — channel attribution lives in contact_channel_identities. '
  'Column retained through Phase 109 for back-compat; will be dropped in Phase 110. '
  'Continue writing on insert for now; new app code SHOULD lookup via '
  'contact_channel_identities instead.';

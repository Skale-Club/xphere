-- =============================================================================
-- Migration 050: Contacts — CRM foundation (SEED-006 / v2.1)
--
-- Introduces the `contacts` entity as the basis of the in-platform CRM.
-- Operator replaces external CRMs (GHL, Evo CRM); contacts live here.
--
-- Highlights:
--   * Multi-tenant (org_id FK + RLS via get_current_org_id())
--   * Phone/email indexes for inbound lookup (org-scoped)
--   * GIN index on tags for tag filtering
--   * conversations.contact_id FK for linking inbound conversations to people
--   * source enum-like CHECK to track contact origin
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.contacts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name          text,
  phone         text,
  email         text,
  company       text,
  notes         text,
  tags          text[] NOT NULL DEFAULT '{}',
  custom_fields jsonb  NOT NULL DEFAULT '{}'::jsonb,
  source        text   NOT NULL DEFAULT 'manual'
                CHECK (source IN ('manual','whatsapp','sms','instagram','csv_import','ghl_sync')),
  external_id   text,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ----- Indices ---------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_contacts_phone      ON public.contacts (org_id, phone);
CREATE INDEX IF NOT EXISTS idx_contacts_email      ON public.contacts (org_id, email);
CREATE INDEX IF NOT EXISTS idx_contacts_tags       ON public.contacts USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_contacts_created_at ON public.contacts (org_id, created_at DESC);

-- ----- RLS -------------------------------------------------------------------

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contacts_org_isolation ON public.contacts;
CREATE POLICY contacts_org_isolation ON public.contacts
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

-- ----- updated_at trigger ----------------------------------------------------

DROP TRIGGER IF EXISTS trg_contacts_set_updated_at ON public.contacts;
CREATE TRIGGER trg_contacts_set_updated_at
  BEFORE UPDATE ON public.contacts
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at();

-- ----- Conversation linkage --------------------------------------------------
-- Allow conversations to be vinculated to a contact. Nullable: legacy rows and
-- anonymous web-widget conversations may never resolve a contact.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_contact_id
  ON public.conversations (contact_id)
  WHERE contact_id IS NOT NULL;

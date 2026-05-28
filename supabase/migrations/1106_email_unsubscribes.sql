-- 1106_email_unsubscribes.sql
-- Email suppression list (CAN-SPAM / LGPD). One row per (org, email) that has
-- opted out of marketing email. Marketing sends check this list and skip
-- suppressed recipients; the public /unsubscribe/<token> route inserts here.
--
-- Keyed by email (not contact_id) so it works even when the recipient isn't a
-- contact yet, and remains the canonical suppression source regardless of
-- contact merges. contact_id is a best-effort backlink for UI.

CREATE TABLE IF NOT EXISTS public.email_unsubscribes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email           text NOT NULL,
  contact_id      uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  unsubscribed_at timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL DEFAULT 'link',  -- 'link' | 'one_click' | 'manual' | 'import'
  UNIQUE (org_id, email)
);

CREATE INDEX IF NOT EXISTS idx_email_unsubscribes_org_email
  ON public.email_unsubscribes (org_id, email);

COMMENT ON TABLE public.email_unsubscribes IS
  'Email suppression list. Marketing email sends skip recipients listed here.';

ALTER TABLE public.email_unsubscribes ENABLE ROW LEVEL SECURITY;

-- Org members can read their org''s suppression list (future settings UI).
-- Writes come from the public unsubscribe route via the service role, which
-- bypasses RLS — no INSERT policy needed for authenticated users.
DROP POLICY IF EXISTS "email_unsubscribes_org_read" ON public.email_unsubscribes;
CREATE POLICY "email_unsubscribes_org_read"
  ON public.email_unsubscribes
  FOR SELECT
  TO authenticated
  USING (org_id = public.get_current_org_id());

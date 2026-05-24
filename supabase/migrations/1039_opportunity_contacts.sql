-- =============================================================================
-- Migration 1039: Opportunity-Contacts Junction Table (N:N)
-- Enables multiple contacts per deal/opportunity.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.opportunity_contacts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  opportunity_id uuid NOT NULL REFERENCES public.opportunities(id) ON DELETE CASCADE,
  contact_id     uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  is_primary     boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_opportunity_contacts_opp
  ON public.opportunity_contacts (opportunity_id);
CREATE INDEX IF NOT EXISTS idx_opportunity_contacts_contact
  ON public.opportunity_contacts (contact_id);

ALTER TABLE public.opportunity_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS opportunity_contacts_org_isolation ON public.opportunity_contacts;
CREATE POLICY opportunity_contacts_org_isolation ON public.opportunity_contacts
  FOR ALL
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

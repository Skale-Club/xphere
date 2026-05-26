-- =============================================================================
-- Migration 1091: campaign_recipients table
-- A unified recipients table for multi-channel campaigns. Voice campaigns
-- continue to use campaign_contacts for engine compatibility; this table
-- is used by SMS, email, and WhatsApp campaigns.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.campaign_recipients (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   UUID        NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  contact_id    UUID        REFERENCES public.contacts(id) ON DELETE SET NULL,
  status        TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','sent','delivered','failed','skipped','unsubscribed')),
  sent_at       TIMESTAMPTZ,
  result        JSONB       NOT NULL DEFAULT '{}',
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "campaign_recipients_via_campaign"
  ON public.campaign_recipients
  FOR SELECT TO authenticated
  USING (
    campaign_id IN (
      SELECT id FROM public.campaigns
      WHERE organization_id = (SELECT public.get_current_org_id())
    )
  );

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_campaign_id
  ON public.campaign_recipients (campaign_id);

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_contact_id
  ON public.campaign_recipients (contact_id)
  WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_campaign_recipients_status
  ON public.campaign_recipients (campaign_id, status);

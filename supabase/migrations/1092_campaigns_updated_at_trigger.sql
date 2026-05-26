-- =============================================================================
-- Migration 1092: updated_at trigger for campaign_recipients
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Trigger for campaign_recipients
DROP TRIGGER IF EXISTS set_campaign_recipients_updated_at ON public.campaign_recipients;
CREATE TRIGGER set_campaign_recipients_updated_at
  BEFORE UPDATE ON public.campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =============================================================================
-- Migration: 032_ghl_reengagement_sent
-- Phase: v1.9 GHL Lost-Lead Reengagement (SMS) — Phase 32
-- Creates: ghl_reengagement_sent (anti-loop — one row per contact ever messaged)
-- RLS:     org-scoped, mirrors public.manychat_rules pattern (027:28-32)
-- Index:   UNIQUE (org_id, ghl_contact_id) provides the backing index — no extra needed
-- Pattern source: 32-RESEARCH.md Pattern 5
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.ghl_reengagement_sent (
  id               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           UUID         NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id      TEXT         NOT NULL,
  ghl_contact_id   TEXT         NOT NULL,
  sent_at          TIMESTAMPTZ  NOT NULL DEFAULT now(),
  CONSTRAINT uniq_ghl_reeng_org_contact UNIQUE (org_id, ghl_contact_id)
);

ALTER TABLE public.ghl_reengagement_sent ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.ghl_reengagement_sent
  FOR ALL
  TO authenticated
  USING      (org_id = (SELECT public.get_current_org_id()))
  WITH CHECK (org_id = (SELECT public.get_current_org_id()));

COMMENT ON TABLE public.ghl_reengagement_sent IS
  'Phase 32 (v1.9): anti-loop record — every contact this org has ever sent a reengagement SMS to. UNIQUE prevents duplicate messages.';

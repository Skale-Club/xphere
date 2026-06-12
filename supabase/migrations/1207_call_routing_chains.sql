-- Migration 1207: Call routing chains (simultaneous-ring + ordered fallback)
--
-- One ordered chain of "stages" per org. Each stage rings 1+ targets in parallel
-- (first to answer wins); when a stage isn't answered within its timeout the
-- Twilio <Dial action> callback advances to the next ENABLED stage. The last
-- unanswered stage falls through to voicemail/hangup.
--
-- This generalises the old single `call_settings.routing_mode` (browser | sip |
-- phone_forward) into an org-level priority list, so the same engine serves:
--   * "browser + PWA ring together, else forward"  (default)
--   * "reception forwards everything"               (single forward stage)
--   * any other ordered mix per org.
--
-- `stages` jsonb shape (array, in priority order):
-- [
--   {
--     "enabled": true,
--     "timeout_seconds": 25,          -- ~5 rings
--     "targets": [
--       { "type": "browser", "user_id": "<uuid>" },  -- Twilio Voice SDK client
--       { "type": "pwa",     "user_id": "<uuid>" },  -- client + web-push wake
--       { "type": "cell",    "number": "+5511..." }, -- PSTN ring in parallel
--       { "type": "sip",     "user_id": "<uuid>" },
--       { "type": "forward", "number": "+5511..." }
--     ]
--   }
-- ]
--
-- When no chain row exists (or is_active = false) the webhook falls back to the
-- legacy single-mode resolver, so existing orgs keep working untouched.

CREATE TABLE IF NOT EXISTS public.call_routing_chains (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  is_active   boolean     NOT NULL DEFAULT true,
  stages      jsonb       NOT NULL DEFAULT '[]'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id)
);

CREATE INDEX IF NOT EXISTS call_routing_chains_org_idx
  ON public.call_routing_chains (org_id);

-- RLS (the service-role webhook clients bypass this; policy is defense-in-depth
-- for the authenticated settings UI).
ALTER TABLE public.call_routing_chains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS call_routing_chains_org ON public.call_routing_chains;
CREATE POLICY call_routing_chains_org
  ON public.call_routing_chains
  FOR ALL
  USING (org_id = (SELECT get_current_org_id()))
  WITH CHECK (org_id = (SELECT get_current_org_id()));

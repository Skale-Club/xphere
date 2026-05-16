-- =============================================================================
-- Migration 041: GHL Inbound Messaging — push-pull architecture
-- Phase: GHL Push-Pull v2.0
-- =============================================================================
-- Adds:
--   ghl_channels  — per-org GHL sub-account config (credentials + webhook secret)
--   ghl_events    — append-only inbound event log (mirrors manychat_events pattern)
--   conversations.channel   — extends CHECK to include 'ghl_sms' | 'ghl_whatsapp'
--   conversations.assigned_user_id — optional human operator assigned to handle conversation
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. ghl_channels — one row per connected GHL sub-account per org
-- ---------------------------------------------------------------------------
-- webhook_secret: random secret the admin sets as X-Operator-Secret header
--   in their GHL workflow webhook action. Validated on every inbound request.
-- encrypted_api_key: AES-256-GCM, same pattern as integrations.encrypted_api_key
-- location_id: GHL sub-account locationId (used for routing inbound → org)
-- agent_id: optional — which agent handles AI responses on this channel
-- ---------------------------------------------------------------------------

CREATE TABLE public.ghl_channels (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id         TEXT        NOT NULL,
  display_name        TEXT,
  encrypted_api_key   TEXT        NOT NULL,
  webhook_secret      TEXT        NOT NULL,
  is_active           BOOLEAN     NOT NULL DEFAULT true,
  agent_id            UUID        REFERENCES public.agents(id) ON DELETE SET NULL,
  automation_id       UUID        REFERENCES public.tool_configs(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, location_id)
);

CREATE INDEX idx_ghl_channels_org_id      ON public.ghl_channels(org_id);
CREATE INDEX idx_ghl_channels_location_id ON public.ghl_channels(location_id);

ALTER TABLE public.ghl_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.ghl_channels
  FOR ALL TO authenticated
  USING  (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

-- ---------------------------------------------------------------------------
-- 2. ghl_events — append-only inbound event log
-- ---------------------------------------------------------------------------
-- Mirrors manychat_events: one insert per inbound webhook call, raw payload
-- preserved for debugging. Processing happens asynchronously from this table.
-- ---------------------------------------------------------------------------

CREATE TABLE public.ghl_events (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  location_id     TEXT        NOT NULL,
  contact_id      TEXT,
  conversation_id TEXT,         -- GHL's own conversationId (external reference)
  message_type    TEXT,         -- 'SMS' | 'WhatsApp' | 'IG' | 'FB' | etc.
  direction       TEXT,         -- 'inbound' | 'outbound'
  body            TEXT,
  phone           TEXT,
  first_name      TEXT,
  last_name       TEXT,
  email           TEXT,
  raw_payload     JSONB       NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ghl_events_org_id      ON public.ghl_events(org_id);
CREATE INDEX idx_ghl_events_location_id ON public.ghl_events(location_id);
CREATE INDEX idx_ghl_events_contact_id  ON public.ghl_events(contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE public.ghl_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.ghl_events
  FOR ALL TO authenticated
  USING  (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

-- ---------------------------------------------------------------------------
-- 3. conversations.channel — extend CHECK to include GHL channels
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_check;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_channel_check
    CHECK (channel IN ('widget', 'messenger', 'instagram', 'ghl_sms', 'ghl_whatsapp'));

-- ---------------------------------------------------------------------------
-- 4. conversations.assigned_user_id — optional human operator assignment
-- ---------------------------------------------------------------------------
-- NULL  = unassigned (bot or any admin can respond)
-- UUID  = the org member assigned to handle this conversation
-- On delete: SET NULL so removing a user doesn't orphan the conversation
-- ---------------------------------------------------------------------------

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS assigned_user_id UUID
    REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX idx_conversations_assigned_user
  ON public.conversations(assigned_user_id)
  WHERE assigned_user_id IS NOT NULL;

-- =============================================================================
-- Migration 019: Meta Channels — meta_channels table
-- Phase: 07-db-foundation (v1.3)
-- =============================================================================
-- One row per connected Facebook Page per channel_type per org.
-- Both Messenger and Instagram use Facebook Page tokens — Instagram DMs
-- flow through the Facebook Page connection infrastructure.
--
-- encrypted_page_access_token: AES-256-GCM encrypted, same pattern as integrations.encrypted_api_key
-- token_expires_at: NULL for Page Access Tokens (non-expiring); set only for user tokens
-- automation_id: optional link to a tool_configs row (the automation that fires on inbound DM)
-- =============================================================================

CREATE TABLE public.meta_channels (
  id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id                      UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_type                TEXT        NOT NULL CHECK (channel_type IN ('messenger', 'instagram')),
  page_id                     TEXT        NOT NULL,
  page_name                   TEXT,
  ig_account_id               TEXT,
  ig_username                 TEXT,
  encrypted_page_access_token TEXT        NOT NULL,
  token_expires_at            TIMESTAMPTZ,
  is_active                   BOOLEAN     NOT NULL DEFAULT true,
  webhook_verified            BOOLEAN     NOT NULL DEFAULT false,
  last_synced_at              TIMESTAMPTZ,
  connection_error            TEXT,
  automation_id               UUID        REFERENCES public.tool_configs(id) ON DELETE SET NULL,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(org_id, page_id, channel_type)
);

CREATE INDEX idx_meta_channels_org_id  ON public.meta_channels(org_id);
CREATE INDEX idx_meta_channels_page_id ON public.meta_channels(page_id);

ALTER TABLE public.meta_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.meta_channels
  FOR ALL
  TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

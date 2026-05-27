-- =============================================================================
-- Migration 1090: Multi-channel campaigns — extend campaigns table
-- Adds channel, campaign_type, description, audience_filter, template_config,
-- metrics, created_by, started_at, completed_at to the existing campaigns table.
-- Voice call campaigns use channel='calls'. New channels: 'sms', 'email', 'whatsapp'.
-- =============================================================================

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS channel          TEXT NOT NULL DEFAULT 'calls'
    CHECK (channel IN ('calls','sms','email','whatsapp')),
  ADD COLUMN IF NOT EXISTS campaign_type    TEXT NOT NULL DEFAULT 'one_time'
    CHECK (campaign_type IN ('one_time','flow')),
  ADD COLUMN IF NOT EXISTS description      TEXT,
  ADD COLUMN IF NOT EXISTS audience_filter  JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS template_config  JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS metrics          JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS created_by       UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS started_at       TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at     TIMESTAMPTZ;

-- Drop the old status CHECK and add the new one with the unified status set.
-- New statuses: 'draft','scheduled','running','paused','completed','failed','stopped'
-- 'running' aliases 'in_progress' for multi-channel parity; both are accepted.
ALTER TABLE public.campaigns
  DROP CONSTRAINT IF EXISTS campaigns_status_check;

ALTER TABLE public.campaigns
  ADD CONSTRAINT campaigns_status_check
  CHECK (status IN ('draft','scheduled','in_progress','running','paused','completed','failed','stopped'));

-- vapi_assistant_id and vapi_phone_number_id are now optional (SMS/email campaigns don't use them)
ALTER TABLE public.campaigns
  ALTER COLUMN vapi_assistant_id DROP NOT NULL,
  ALTER COLUMN vapi_phone_number_id DROP NOT NULL;

-- Index for channel filtering
CREATE INDEX IF NOT EXISTS idx_campaigns_channel
  ON public.campaigns (organization_id, channel);

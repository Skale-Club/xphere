-- =============================================================================
-- Migration 050: SMS channel — Twilio inbound omnichannel completion (SEED-005)
-- Phase: v2.1 SMS Inbound
-- =============================================================================
-- Adds:
--   1. 'sms' value to the agent_channel enum (so agents can declare allowed_channels
--      ARRAY['sms'] and agent_channel_defaults rows can be created for channel='sms')
--   2. Extends conversations.channel CHECK constraint to allow 'sms'
--
-- Why a separate channel from 'ghl_sms':
--   - 'ghl_sms' is SMS proxied through GoHighLevel — we never touch Twilio directly.
--   - 'sms' is direct Twilio integration via the org's Twilio credentials.
--   - Different webhook contracts, different signature validation, different from-number
--     resolution. Keeping them as distinct channel values matches existing conventions.
--
-- Idempotent: re-running this migration is safe.
-- =============================================================================

-- 1. Extend agent_channel enum with 'sms'
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'agent_channel'
      AND e.enumlabel = 'sms'
  ) THEN
    ALTER TYPE public.agent_channel ADD VALUE 'sms';
  END IF;
END $$;

-- 2. Extend conversations.channel CHECK to include 'sms'
ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_check;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_channel_check
    CHECK (channel IN ('widget', 'messenger', 'instagram', 'ghl_sms', 'ghl_whatsapp', 'sms'));

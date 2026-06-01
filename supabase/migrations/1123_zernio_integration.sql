-- Migration 1123: Zernio social inbox integration
-- Adds 'zernio' channel to conversations / conversation_messages / contact_channel_identities.
-- Adds 'zernio' to the integration_provider enum.
-- Disables all existing Meta channels (soft-disable: webhook checks is_active=true).

-- 1. conversations.channel
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;
ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN (
    'widget', 'messenger', 'instagram', 'sms', 'voice',
    'whatsapp', 'telegram', 'manual', 'email',
    'ghl_sms', 'ghl_whatsapp', 'zernio'
  ));

-- 2. conversation_messages.channel
ALTER TABLE conversation_messages DROP CONSTRAINT IF EXISTS conversation_messages_channel_check;
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_channel_check
  CHECK (channel IS NULL OR channel IN (
    'widget', 'messenger', 'instagram', 'sms', 'voice',
    'whatsapp', 'telegram', 'ghl_sms', 'ghl_whatsapp', 'zernio'
  ));

-- 3. contact_channel_identities.provider
ALTER TABLE contact_channel_identities DROP CONSTRAINT IF EXISTS contact_channel_identities_provider_check;
ALTER TABLE contact_channel_identities ADD CONSTRAINT contact_channel_identities_provider_check
  CHECK (provider IN (
    'whatsapp', 'evolution', 'telegram', 'instagram', 'messenger',
    'facebook', 'webchat', 'vapi', 'zernio'
  ));

-- 4. integration_provider enum: add 'zernio'
ALTER TYPE integration_provider ADD VALUE IF NOT EXISTS 'zernio';

-- 5. Soft-disable all existing Meta channels.
--    Webhook processor already checks is_active=true before processing events.
--    Existing conversations / messages are untouched.
UPDATE meta_channels SET is_active = false WHERE is_active = true;

-- 1103_conversations_manual_channel.sql
-- Extend conversations.channel CHECK constraint to allow 'manual' — a
-- placeholder channel used when a contact is created from the CRM form
-- before any real channel (WhatsApp, SMS, etc.) is attached. Lets the
-- Inbox show a "Direct" card for the new contact immediately.
--
-- Pattern mirrors 096_telegram_bots.sql which added 'telegram'.

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_channel_check;

ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_channel_check
    CHECK (channel IN (
      'widget',
      'messenger',
      'instagram',
      'sms',
      'voice',
      'whatsapp',
      'telegram',
      'manual',
      -- Preserve legacy GHL-proxied channels still referenced in older orgs
      'ghl_sms',
      'ghl_whatsapp'
    ));

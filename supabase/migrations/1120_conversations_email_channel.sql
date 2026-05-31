-- 1120_conversations_email_channel.sql
-- Extend conversations.channel CHECK constraint to allow 'email'.
--
-- The Resend inbound webhook (src/app/api/resend/inbound/route.ts) already
-- inserts conversations with channel='email', and the inbox can now start an
-- email conversation for a contact. 'email' was missing from the constraint
-- (last set in 1103_conversations_manual_channel.sql), so those inserts would
-- fail the CHECK. This adds it.
--
-- Pattern mirrors 1103_conversations_manual_channel.sql.

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
      'email',
      -- Preserve legacy GHL-proxied channels still referenced in older orgs
      'ghl_sms',
      'ghl_whatsapp'
    ));

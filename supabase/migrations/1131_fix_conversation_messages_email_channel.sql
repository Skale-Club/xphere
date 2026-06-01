-- Migration 1131: restore 'email' (and 'manual') to conversation_messages.channel.
-- Regression fix: migration 1125 recreated conversation_messages_channel_check from
-- an older value list and dropped 'email', so outbound email replies were sent by
-- Resend but failed to persist ("provider accepted the message, but Xphere could
-- not save it in the conversation history"). Restore the full set.

ALTER TABLE conversation_messages DROP CONSTRAINT IF EXISTS conversation_messages_channel_check;
ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_channel_check
  CHECK (channel IS NULL OR channel IN (
    'widget', 'messenger', 'instagram', 'sms', 'voice', 'whatsapp', 'telegram',
    'manual', 'email', 'ghl_sms', 'ghl_whatsapp', 'zernio',
    'zernio_instagram', 'zernio_facebook', 'zernio_telegram', 'zernio_whatsapp',
    'zernio_linkedin', 'zernio_tiktok', 'zernio_twitter', 'zernio_threads', 'zernio_youtube'
  ));

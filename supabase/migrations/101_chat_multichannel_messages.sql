-- SEED-039: Multi-channel chat thread support.
--
-- Adds a per-message channel column to conversation_messages so a single
-- conversation thread can intermix messages from different transports
-- (e.g. a customer who replied first on WhatsApp and later on Instagram).
--
-- The column is nullable for backwards-compat with rows written before this
-- migration. When NULL, the UI falls back to the parent conversation.channel.

ALTER TABLE public.conversation_messages
  ADD COLUMN IF NOT EXISTS channel text;

-- Constrain allowed values. We don't use an enum so the platform can add new
-- channels without a migration just for the type. Legacy NULL rows are
-- allowed; only non-NULL writes are checked.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM   pg_constraint
    WHERE  conname = 'conversation_messages_channel_check'
  ) THEN
    ALTER TABLE public.conversation_messages
      ADD CONSTRAINT conversation_messages_channel_check
      CHECK (
        channel IS NULL
        OR channel IN (
          'widget',
          'messenger',
          'instagram',
          'sms',
          'voice',
          'whatsapp',
          'telegram',
          'ghl_sms',
          'ghl_whatsapp'
        )
      );
  END IF;
END $$;

-- Backfill: for existing messages, copy the conversation's channel down so
-- the per-message indicator works without re-ingesting history. Cheap on
-- average orgs (< 1M rows); skipped on the index path because we're filtering
-- by NULL channel only.
UPDATE public.conversation_messages cm
SET    channel = c.channel
FROM   public.conversations c
WHERE  cm.conversation_id = c.id
  AND  cm.channel IS NULL;

-- Composite index supports the per-conversation channel filter in the UI:
--   SELECT * FROM conversation_messages
--   WHERE conversation_id = $1 AND channel = ANY($2)
CREATE INDEX IF NOT EXISTS idx_conversation_messages_conv_channel
  ON public.conversation_messages (conversation_id, channel)
  WHERE channel IS NOT NULL;

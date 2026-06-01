-- Migration 1125: Zernio per-platform channels
-- Split the single 'zernio' channel into per-platform channels (zernio_instagram,
-- zernio_facebook, …) so each Zernio platform shows as its own inbox channel.
-- Existing 'zernio' rows are migrated using channel_metadata/metadata ->> 'platform'.
-- Generic 'zernio' is kept as a fallback for unknown platforms.

-- 1. conversations
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_channel_check;

UPDATE conversations
  SET channel = 'zernio_' || (channel_metadata->>'platform')
  WHERE channel = 'zernio'
    AND channel_metadata->>'platform' IN (
      'instagram','facebook','telegram','whatsapp','linkedin','tiktok','twitter','threads','youtube'
    );

ALTER TABLE conversations ADD CONSTRAINT conversations_channel_check
  CHECK (channel IN (
    'widget','messenger','instagram','sms','voice','whatsapp','telegram','manual','email',
    'ghl_sms','ghl_whatsapp','zernio',
    'zernio_instagram','zernio_facebook','zernio_telegram','zernio_whatsapp',
    'zernio_linkedin','zernio_tiktok','zernio_twitter','zernio_threads','zernio_youtube'
  ));

-- 2. conversation_messages
ALTER TABLE conversation_messages DROP CONSTRAINT IF EXISTS conversation_messages_channel_check;

UPDATE conversation_messages
  SET channel = 'zernio_' || (metadata->>'platform')
  WHERE channel = 'zernio'
    AND metadata->>'platform' IN (
      'instagram','facebook','telegram','whatsapp','linkedin','tiktok','twitter','threads','youtube'
    );

ALTER TABLE conversation_messages ADD CONSTRAINT conversation_messages_channel_check
  CHECK (channel IS NULL OR channel IN (
    'widget','messenger','instagram','sms','voice','whatsapp','telegram','ghl_sms','ghl_whatsapp','zernio',
    'zernio_instagram','zernio_facebook','zernio_telegram','zernio_whatsapp',
    'zernio_linkedin','zernio_tiktok','zernio_twitter','zernio_threads','zernio_youtube'
  ));

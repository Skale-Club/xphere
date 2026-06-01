-- 1127_zernio_thread_identity_repair.sql
-- Repair existing Zernio DM thread/contact splits and add a database guard so
-- concurrent webhooks cannot create multiple Xphere conversations for one
-- Zernio inbox conversation.

-- Keep legacy generic Zernio rows canonical when the platform is known.
UPDATE public.conversations
   SET channel = 'zernio_' || (channel_metadata->>'platform')
 WHERE channel = 'zernio'
   AND channel_metadata->>'platform' IN (
     'instagram','facebook','telegram','whatsapp','linkedin','tiktok','twitter','threads','youtube'
   );

UPDATE public.conversation_messages
   SET channel = 'zernio_' || (metadata->>'platform')
 WHERE channel = 'zernio'
   AND metadata->>'platform' IN (
     'instagram','facebook','telegram','whatsapp','linkedin','tiktok','twitter','threads','youtube'
   );

CREATE TEMP TABLE tmp_zernio_duplicate_conversations ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    first_value(id) OVER (
      PARTITION BY
        org_id,
        channel,
        channel_metadata->>'account_id',
        channel_metadata->>'zernio_conversation_id'
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC
    ) AS survivor_id,
    channel AS canonical_channel,
    row_number() OVER (
      PARTITION BY
        org_id,
        channel,
        channel_metadata->>'account_id',
        channel_metadata->>'zernio_conversation_id'
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM public.conversations
  WHERE channel LIKE 'zernio%'
    AND channel_metadata->>'thread_type' = 'dm'
    AND channel_metadata->>'account_id' IS NOT NULL
    AND channel_metadata->>'zernio_conversation_id' IS NOT NULL
)
SELECT id AS duplicate_id, survivor_id, canonical_channel
  FROM ranked
 WHERE rn > 1;

UPDATE public.conversation_messages AS m
   SET conversation_id = d.survivor_id,
       channel = COALESCE(NULLIF(m.channel, 'zernio'), d.canonical_channel)
  FROM tmp_zernio_duplicate_conversations AS d
 WHERE m.conversation_id = d.duplicate_id;

DELETE FROM public.conversations AS c
 USING tmp_zernio_duplicate_conversations AS d
 WHERE c.id = d.duplicate_id;

WITH touched AS (
  SELECT DISTINCT survivor_id FROM tmp_zernio_duplicate_conversations
),
latest AS (
  SELECT DISTINCT ON (m.conversation_id)
    m.conversation_id,
    m.content,
    m.message_type,
    m.created_at
  FROM public.conversation_messages AS m
  JOIN touched AS t ON t.survivor_id = m.conversation_id
  ORDER BY m.conversation_id, m.created_at DESC
)
UPDATE public.conversations AS c
   SET last_message = CASE
         WHEN NULLIF(latest.content, '') IS NOT NULL THEN latest.content
         WHEN latest.message_type = 'audio' THEN 'Audio'
         WHEN latest.message_type = 'image' THEN 'Image'
         WHEN latest.message_type = 'video' THEN 'Video'
         ELSE 'File'
       END,
       last_message_at = latest.created_at,
       last_inbound_at = GREATEST(COALESCE(c.last_inbound_at, latest.created_at), latest.created_at),
       updated_at = now()
  FROM latest
 WHERE c.id = latest.conversation_id;

-- Merge Zernio channel-only contacts into existing identified contacts when
-- the inbound WhatsApp phone matches a live CRM contact.
CREATE TEMP TABLE tmp_zernio_contact_merges ON COMMIT DROP AS
SELECT DISTINCT ON (old_contact.id)
  old_contact.id AS duplicate_contact_id,
  live_contact.id AS survivor_contact_id
FROM public.conversations AS conv
JOIN public.contacts AS old_contact
  ON old_contact.id = conv.contact_id
JOIN public.contacts AS live_contact
  ON live_contact.org_id = old_contact.org_id
 AND live_contact.phone_e164 = public.normalize_phone(conv.visitor_phone)
 AND live_contact.id <> old_contact.id
WHERE conv.channel LIKE 'zernio%'
  AND conv.visitor_phone IS NOT NULL
  AND old_contact.identity_status = 'channel_only'
  AND live_contact.identity_status <> 'archived_duplicate'
ORDER BY
  old_contact.id,
  CASE live_contact.identity_status
    WHEN 'verified' THEN 0
    WHEN 'identified' THEN 1
    ELSE 2
  END,
  live_contact.updated_at DESC NULLS LAST;

UPDATE public.contacts AS c
   SET identity_status = 'archived_duplicate',
       merged_into_contact_id = m.survivor_contact_id,
       updated_at = now()
  FROM tmp_zernio_contact_merges AS m
 WHERE c.id = m.duplicate_contact_id;

DELETE FROM public.contact_channel_identities AS old_ci
 USING tmp_zernio_contact_merges AS m
 WHERE old_ci.contact_id = m.duplicate_contact_id
   AND EXISTS (
     SELECT 1
       FROM public.contact_channel_identities AS survivor_ci
      WHERE survivor_ci.org_id = old_ci.org_id
        AND survivor_ci.provider = old_ci.provider
        AND survivor_ci.external_id = old_ci.external_id
        AND survivor_ci.contact_id = m.survivor_contact_id
   );

UPDATE public.contact_channel_identities AS ci
   SET contact_id = m.survivor_contact_id
  FROM tmp_zernio_contact_merges AS m
 WHERE ci.contact_id = m.duplicate_contact_id;

UPDATE public.conversations AS c
   SET contact_id = m.survivor_contact_id,
       updated_at = now()
  FROM tmp_zernio_contact_merges AS m
 WHERE c.contact_id = m.duplicate_contact_id;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_zernio_dm_thread_unique
  ON public.conversations (
    org_id,
    channel,
    ((channel_metadata->>'account_id')),
    ((channel_metadata->>'zernio_conversation_id'))
  )
  WHERE channel LIKE 'zernio%'
    AND channel_metadata->>'thread_type' = 'dm'
    AND channel_metadata->>'account_id' IS NOT NULL
    AND channel_metadata->>'zernio_conversation_id' IS NOT NULL;

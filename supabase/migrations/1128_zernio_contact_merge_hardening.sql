-- 1128_zernio_contact_merge_hardening.sql
-- Move the Zernio channel-only -> identified contact merge into Postgres so
-- the webhook path cannot partially archive a contact without moving its
-- identities/conversations.

CREATE OR REPLACE FUNCTION public.merge_zernio_channel_only_contact(
  p_org_id uuid,
  p_duplicate_contact_id uuid,
  p_survivor_contact_id uuid,
  p_zernio_external_ids text[] DEFAULT ARRAY[]::text[]
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  duplicate_status text;
  survivor_status text;
BEGIN
  IF p_duplicate_contact_id = p_survivor_contact_id THEN
    RETURN;
  END IF;

  SELECT identity_status
    INTO duplicate_status
    FROM public.contacts
   WHERE id = p_duplicate_contact_id
     AND org_id = p_org_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'duplicate contact % not found in org %', p_duplicate_contact_id, p_org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  SELECT identity_status
    INTO survivor_status
    FROM public.contacts
   WHERE id = p_survivor_contact_id
     AND org_id = p_org_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'survivor contact % not found in org %', p_survivor_contact_id, p_org_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  IF duplicate_status <> 'channel_only' THEN
    RAISE EXCEPTION 'contact % is %, not channel_only', p_duplicate_contact_id, duplicate_status
      USING ERRCODE = 'check_violation';
  END IF;

  IF survivor_status = 'archived_duplicate' THEN
    RAISE EXCEPTION 'survivor contact % is archived_duplicate', p_survivor_contact_id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Archive first so the "last channel identity" trigger permits moving all
  -- identities off the channel-only contact inside this transaction.
  UPDATE public.contacts
     SET identity_status = 'archived_duplicate',
         merged_into_contact_id = p_survivor_contact_id,
         updated_at = now()
   WHERE id = p_duplicate_contact_id
     AND org_id = p_org_id;

  DELETE FROM public.contact_channel_identities AS old_ci
   WHERE old_ci.org_id = p_org_id
     AND old_ci.contact_id = p_duplicate_contact_id
     AND EXISTS (
       SELECT 1
         FROM public.contact_channel_identities AS survivor_ci
        WHERE survivor_ci.org_id = old_ci.org_id
          AND survivor_ci.provider = old_ci.provider
          AND survivor_ci.external_id = old_ci.external_id
          AND survivor_ci.contact_id = p_survivor_contact_id
     );

  UPDATE public.contact_channel_identities
     SET contact_id = p_survivor_contact_id
   WHERE org_id = p_org_id
     AND contact_id = p_duplicate_contact_id;

  INSERT INTO public.contact_channel_identities (org_id, contact_id, provider, external_id)
  SELECT p_org_id, p_survivor_contact_id, 'zernio', external_id
    FROM unnest(COALESCE(p_zernio_external_ids, ARRAY[]::text[])) AS ids(external_id)
   WHERE external_id IS NOT NULL
     AND btrim(external_id) <> ''
  ON CONFLICT (org_id, provider, external_id)
  DO UPDATE SET contact_id = EXCLUDED.contact_id;

  UPDATE public.conversations
     SET contact_id = p_survivor_contact_id,
         updated_at = now()
   WHERE org_id = p_org_id
     AND contact_id = p_duplicate_contact_id;
END;
$$;

COMMENT ON FUNCTION public.merge_zernio_channel_only_contact(uuid, uuid, uuid, text[]) IS
  'Atomically merges a Zernio channel_only contact into an identified survivor contact, moving channel identities and conversations.';

GRANT EXECUTE ON FUNCTION public.merge_zernio_channel_only_contact(uuid, uuid, uuid, text[]) TO authenticated, service_role;

-- If any duplicate Zernio threads still exist in environments where 1127 was
-- not applied manually, preserve auxiliary inbox state before consolidation.
CREATE TEMP TABLE tmp_zernio_duplicate_conversations_1128 ON COMMIT DROP AS
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
SELECT id AS duplicate_id, survivor_id
  FROM ranked
 WHERE rn > 1;

INSERT INTO public.conversation_label_assignments (conversation_id, label_id, created_at)
SELECT DISTINCT d.survivor_id, cla.label_id, min(cla.created_at)
  FROM public.conversation_label_assignments AS cla
  JOIN tmp_zernio_duplicate_conversations_1128 AS d
    ON d.duplicate_id = cla.conversation_id
 GROUP BY d.survivor_id, cla.label_id
ON CONFLICT (conversation_id, label_id) DO NOTHING;

INSERT INTO public.conversation_reads (conversation_id, user_id, read_at)
SELECT d.survivor_id, cr.user_id, max(cr.read_at)
  FROM public.conversation_reads AS cr
  JOIN tmp_zernio_duplicate_conversations_1128 AS d
    ON d.duplicate_id = cr.conversation_id
 GROUP BY d.survivor_id, cr.user_id
ON CONFLICT (conversation_id, user_id)
DO UPDATE SET read_at = GREATEST(public.conversation_reads.read_at, EXCLUDED.read_at);

UPDATE public.opportunity_activities AS oa
   SET conversation_id = d.survivor_id
  FROM tmp_zernio_duplicate_conversations_1128 AS d
 WHERE oa.conversation_id = d.duplicate_id;

UPDATE public.conversation_messages AS m
   SET conversation_id = d.survivor_id
  FROM tmp_zernio_duplicate_conversations_1128 AS d
 WHERE m.conversation_id = d.duplicate_id;

DELETE FROM public.conversations AS c
 USING tmp_zernio_duplicate_conversations_1128 AS d
 WHERE c.id = d.duplicate_id;

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

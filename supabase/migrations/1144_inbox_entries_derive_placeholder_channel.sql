-- Migration 1144: inbox_entries derives the placeholder channel from reachability.
--
-- Root fix for the "Direct" mislabeling: every CRM-created contact gets a
-- placeholder conversation stored as channel='manual'. The inbox badge reads
-- this frozen value, so a contact WITH a phone showed "Direct" instead of SMS —
-- and the composer (which resolves reachability live) showed SMS for the same
-- contact. The frozen value also went stale if a phone/email was added later.
--
-- Fix: compute an EFFECTIVE channel for message-less 'manual' placeholders from
-- the contact's reachability (phone → sms, else email → email, else manual) and
-- use it everywhere — the representative channel (badge), the channel set, and
-- the p_channels filter (+ count). Storage stays 'manual' (honest: no real
-- thread yet); the display is always live. Real threads (last_message_at set or
-- any non-'manual' channel) are never re-derived.
--
-- inbox_entries gains a `representative_channel` output column, so it must be
-- dropped/recreated (CREATE OR REPLACE cannot change the return type).

DROP FUNCTION IF EXISTS public.inbox_entries(
  uuid, text, text, text[], boolean, boolean, text, text, uuid, boolean, int, int);

CREATE FUNCTION public.inbox_entries(
  p_user uuid,
  p_status text DEFAULT NULL,
  p_assigned text DEFAULT NULL,
  p_channels text[] DEFAULT NULL,
  p_starred boolean DEFAULT false,
  p_verified boolean DEFAULT false,
  p_priority text DEFAULT NULL,
  p_bot_status text DEFAULT NULL,
  p_phone_number_id uuid DEFAULT NULL,
  p_pinned boolean DEFAULT NULL,
  p_limit int DEFAULT 30,
  p_offset int DEFAULT 0
)
RETURNS TABLE (
  representative_conversation_id uuid,
  contact_id uuid,
  representative_channel text,
  channels text[],
  pinned boolean,
  activity_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  WITH filtered AS (
    SELECT c.id, c.contact_id, c.pinned, c.last_message_at,
           -- Effective (displayed) channel: re-derive only message-less 'manual'
           -- placeholders from the contact's reachability; everything else is
           -- the stored channel verbatim.
           CASE
             WHEN c.channel = 'manual' AND c.last_message_at IS NULL
                  AND COALESCE(ct.phone_e164, ct.phone) IS NOT NULL THEN 'sms'
             WHEN c.channel = 'manual' AND c.last_message_at IS NULL
                  AND ct.email IS NOT NULL THEN 'email'
             ELSE c.channel
           END AS eff_channel,
           COALESCE(c.last_message_at, c.updated_at, c.created_at) AS act,
           c.created_at,
           COALESCE(c.contact_id::text, 'conv:'||c.id::text) AS grp
    FROM conversations c
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE ((p_status IS NOT NULL AND c.status = p_status)
            OR (p_status IS NULL AND c.status <> 'closed'))
      AND (p_assigned IS DISTINCT FROM 'me' OR c.assigned_user_id = p_user)
      AND (p_channels IS NULL OR
           (CASE
              WHEN c.channel = 'manual' AND c.last_message_at IS NULL
                   AND COALESCE(ct.phone_e164, ct.phone) IS NOT NULL THEN 'sms'
              WHEN c.channel = 'manual' AND c.last_message_at IS NULL
                   AND ct.email IS NOT NULL THEN 'email'
              ELSE c.channel
            END) = ANY(p_channels))
      AND (NOT p_starred OR c.starred = true)
      AND (p_priority IS NULL OR c.priority = p_priority)
      AND (p_bot_status IS NULL OR c.bot_status = p_bot_status)
      AND (p_phone_number_id IS NULL OR c.phone_number_id = p_phone_number_id)
      AND (NOT p_verified OR EXISTS (
            SELECT 1 FROM contact_verifications v WHERE v.contact_id = c.contact_id))
  ),
  rep AS (
    -- Representative: prefer conversations WITH messages, then most recent message,
    -- then newest. Empty placeholders only win when the contact has no history.
    SELECT DISTINCT ON (grp) id, contact_id, grp, eff_channel
    FROM filtered
    ORDER BY grp,
             (last_message_at IS NULL) ASC,
             last_message_at DESC NULLS LAST,
             created_at DESC
  ),
  agg AS (
    SELECT grp,
           array_agg(DISTINCT eff_channel) AS channels,
           bool_or(pinned) AS any_pinned,
           max(act) AS max_act          -- list position = contact's overall recency
    FROM filtered GROUP BY grp
  )
  SELECT r.id, r.contact_id, r.eff_channel, a.channels, a.any_pinned, a.max_act
  FROM rep r JOIN agg a ON a.grp = r.grp
  WHERE (p_pinned IS NULL OR a.any_pinned = p_pinned)
  ORDER BY a.max_act DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset
$$;

-- Count must apply the same effective-channel filter so the total matches the list.
CREATE OR REPLACE FUNCTION public.inbox_entries_count(
  p_user uuid,
  p_status text DEFAULT NULL,
  p_assigned text DEFAULT NULL,
  p_channels text[] DEFAULT NULL,
  p_starred boolean DEFAULT false,
  p_verified boolean DEFAULT false,
  p_priority text DEFAULT NULL,
  p_bot_status text DEFAULT NULL,
  p_phone_number_id uuid DEFAULT NULL,
  p_pinned boolean DEFAULT NULL
)
RETURNS bigint
LANGUAGE sql
STABLE
AS $$
  WITH filtered AS (
    SELECT c.id, c.contact_id, c.pinned,
           COALESCE(c.contact_id::text, 'conv:'||c.id::text) AS grp
    FROM conversations c
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE ((p_status IS NOT NULL AND c.status = p_status)
            OR (p_status IS NULL AND c.status <> 'closed'))
      AND (p_assigned IS DISTINCT FROM 'me' OR c.assigned_user_id = p_user)
      AND (p_channels IS NULL OR
           (CASE
              WHEN c.channel = 'manual' AND c.last_message_at IS NULL
                   AND COALESCE(ct.phone_e164, ct.phone) IS NOT NULL THEN 'sms'
              WHEN c.channel = 'manual' AND c.last_message_at IS NULL
                   AND ct.email IS NOT NULL THEN 'email'
              ELSE c.channel
            END) = ANY(p_channels))
      AND (NOT p_starred OR c.starred = true)
      AND (p_priority IS NULL OR c.priority = p_priority)
      AND (p_bot_status IS NULL OR c.bot_status = p_bot_status)
      AND (p_phone_number_id IS NULL OR c.phone_number_id = p_phone_number_id)
      AND (NOT p_verified OR EXISTS (
            SELECT 1 FROM contact_verifications v WHERE v.contact_id = c.contact_id))
  )
  SELECT COUNT(*) FROM (
    SELECT grp FROM filtered GROUP BY grp
    HAVING (p_pinned IS NULL OR bool_or(pinned) = p_pinned)
  ) s
$$;

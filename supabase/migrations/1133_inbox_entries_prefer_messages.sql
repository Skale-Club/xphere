-- Migration 1133: inbox_entries representative prefers conversations WITH messages.
-- Bug: after a merge, a contact's empty placeholder conversation (recent updated_at)
-- outranked the real conversation with history (older last_message_at), because the
-- representative was chosen by COALESCE(last_message_at, updated_at, created_at). The
-- inbox then opened the empty conversation → looked like messages vanished (they were
-- intact on the other conversation).
--
-- Fix: representative = the contact's most-recent conversation that HAS messages
-- (last_message_at NOT NULL first). The ENTRY's list position still uses the contact's
-- max activity so an active contact doesn't sink because its history is older.

CREATE OR REPLACE FUNCTION public.inbox_entries(
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
  channels text[],
  pinned boolean,
  activity_at timestamptz
)
LANGUAGE sql
STABLE
AS $$
  WITH filtered AS (
    SELECT c.id, c.contact_id, c.channel, c.pinned, c.last_message_at,
           COALESCE(c.last_message_at, c.updated_at, c.created_at) AS act,
           c.created_at,
           COALESCE(c.contact_id::text, 'conv:'||c.id::text) AS grp
    FROM conversations c
    WHERE ((p_status IS NOT NULL AND c.status = p_status)
            OR (p_status IS NULL AND c.status <> 'closed'))
      AND (p_assigned IS DISTINCT FROM 'me' OR c.assigned_user_id = p_user)
      AND (p_channels IS NULL OR c.channel = ANY(p_channels))
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
    SELECT DISTINCT ON (grp) id, contact_id, grp
    FROM filtered
    ORDER BY grp,
             (last_message_at IS NULL) ASC,
             last_message_at DESC NULLS LAST,
             created_at DESC
  ),
  agg AS (
    SELECT grp,
           array_agg(DISTINCT channel) AS channels,
           bool_or(pinned) AS any_pinned,
           max(act) AS max_act          -- list position = contact's overall recency
    FROM filtered GROUP BY grp
  )
  SELECT r.id, r.contact_id, a.channels, a.any_pinned, a.max_act
  FROM rep r JOIN agg a ON a.grp = r.grp
  WHERE (p_pinned IS NULL OR a.any_pinned = p_pinned)
  ORDER BY a.max_act DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset
$$;

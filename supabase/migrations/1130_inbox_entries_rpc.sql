-- Migration 1130: contact-centric inbox RPCs.
-- inbox_entries returns ONE representative conversation per contact (anonymous
-- conversations are their own entry), with the contact's channel set + pinned
-- flag, ordered by activity. inbox_entries_count returns the distinct entry total
-- for pagination. SECURITY INVOKER so the conversations org_isolation RLS applies.

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
    SELECT c.id, c.contact_id, c.channel, c.pinned,
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
    SELECT DISTINCT ON (grp) id, contact_id, grp, act, created_at
    FROM filtered
    ORDER BY grp, act DESC NULLS LAST, created_at DESC
  ),
  agg AS (
    SELECT grp, array_agg(DISTINCT channel) AS channels, bool_or(pinned) AS any_pinned
    FROM filtered GROUP BY grp
  )
  SELECT r.id, r.contact_id, a.channels, a.any_pinned, r.act
  FROM rep r JOIN agg a ON a.grp = r.grp
  WHERE (p_pinned IS NULL OR a.any_pinned = p_pinned)
  ORDER BY r.act DESC NULLS LAST, r.created_at DESC
  LIMIT p_limit OFFSET p_offset
$$;

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
  )
  SELECT COUNT(*) FROM (
    SELECT grp FROM filtered GROUP BY grp
    HAVING (p_pinned IS NULL OR bool_or(pinned) = p_pinned)
  ) s
$$;

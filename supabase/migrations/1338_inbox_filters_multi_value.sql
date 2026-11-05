-- Inbox filters that the panel offered but the database never applied.
--
-- The filter panel lets people pick several statuses, priorities, AI states and
-- numbers, an assignee, labels and "unread", but inbox_entries took one value per
-- filter and had no parameter at all for assignee, labels or unread. The app sent
-- only the first value of each list, and "Unread" became "status = open".
--
-- New list parameters are appended with defaults, so the old single-value calls
-- keep working while the previous app version is still running. The old
-- signatures are dropped first so no overload is ambiguous. inbox_entries_count
-- now counts inbox_entries itself, so the count and the list can never disagree
-- (including the unread filter, which only the entry query can compute).

DROP FUNCTION IF EXISTS public.inbox_entries_count(uuid, text, text, text[], boolean, boolean, text, text, uuid, boolean);
DROP FUNCTION IF EXISTS public.inbox_entries(uuid, text, text, text[], boolean, boolean, text, text, uuid, boolean, integer, integer);

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
  p_limit integer DEFAULT 30,
  p_offset integer DEFAULT 0,
  p_statuses text[] DEFAULT NULL,
  p_priorities text[] DEFAULT NULL,
  p_bot_statuses text[] DEFAULT NULL,
  p_phone_number_ids uuid[] DEFAULT NULL,
  p_assigned_user_ids uuid[] DEFAULT NULL,
  p_include_unassigned boolean DEFAULT false,
  p_label_ids uuid[] DEFAULT NULL,
  p_unread_only boolean DEFAULT false
)
RETURNS TABLE(
  representative_conversation_id uuid,
  contact_id uuid,
  representative_channel text,
  channels text[],
  pinned boolean,
  activity_at timestamp with time zone,
  is_unread boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  WITH filtered AS (
    SELECT c.id, c.contact_id, c.pinned, c.last_message_at, c.last_inbound_at,
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
    WHERE (CASE
             WHEN cardinality(p_statuses) > 0 THEN c.status = ANY(p_statuses)
             WHEN p_status IS NOT NULL THEN c.status = p_status
             -- No status picked: archived conversations stay out of the Inbox.
             ELSE c.status <> 'closed'
           END)
      AND (p_assigned IS DISTINCT FROM 'me' OR c.assigned_user_id = p_user)
      AND ((COALESCE(cardinality(p_assigned_user_ids), 0) = 0 AND NOT p_include_unassigned)
           OR c.assigned_user_id = ANY(COALESCE(p_assigned_user_ids, '{}'))
           OR (p_include_unassigned AND c.assigned_user_id IS NULL))
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
      AND (COALESCE(cardinality(p_priorities), 0) = 0 OR c.priority = ANY(p_priorities))
      AND (p_bot_status IS NULL OR c.bot_status = p_bot_status)
      AND (COALESCE(cardinality(p_bot_statuses), 0) = 0 OR c.bot_status = ANY(p_bot_statuses))
      AND (p_phone_number_id IS NULL OR c.phone_number_id = p_phone_number_id)
      AND (COALESCE(cardinality(p_phone_number_ids), 0) = 0 OR c.phone_number_id = ANY(p_phone_number_ids))
      AND (COALESCE(cardinality(p_label_ids), 0) = 0 OR EXISTS (
            SELECT 1 FROM conversation_label_assignments la
            WHERE la.conversation_id = c.id AND la.label_id = ANY(p_label_ids)))
      AND (NOT p_verified OR EXISTS (
            SELECT 1 FROM contact_verifications v WHERE v.contact_id = c.contact_id))
  ),
  rep AS (
    -- Representative: prefer conversations WITH messages, then most recent message,
    -- then newest. Empty placeholders only win when the contact has no history.
    SELECT DISTINCT ON (grp) id, contact_id, grp, eff_channel, last_inbound_at
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
  ),
  entries AS (
    SELECT r.id, r.contact_id, r.eff_channel, a.channels, a.any_pinned, a.max_act,
           -- Unread = the representative has an INBOUND message newer than this
           -- user's read marker (or no read marker). last_inbound_at is NOT advanced
           -- by outbound/bot replies, so answering a thread never re-flags it.
           (r.last_inbound_at IS NOT NULL
            AND (cr.read_at IS NULL OR r.last_inbound_at > cr.read_at)) AS is_unread
    FROM rep r
    JOIN agg a ON a.grp = r.grp
    LEFT JOIN conversation_reads cr
      ON cr.conversation_id = r.id AND cr.user_id = p_user
    WHERE (p_pinned IS NULL OR a.any_pinned = p_pinned)
  )
  SELECT e.id, e.contact_id, e.eff_channel, e.channels, e.any_pinned, e.max_act, e.is_unread
  FROM entries e
  WHERE (NOT p_unread_only OR e.is_unread)
  ORDER BY e.max_act DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset
$function$;

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
  p_pinned boolean DEFAULT NULL,
  p_statuses text[] DEFAULT NULL,
  p_priorities text[] DEFAULT NULL,
  p_bot_statuses text[] DEFAULT NULL,
  p_phone_number_ids uuid[] DEFAULT NULL,
  p_assigned_user_ids uuid[] DEFAULT NULL,
  p_include_unassigned boolean DEFAULT false,
  p_label_ids uuid[] DEFAULT NULL,
  p_unread_only boolean DEFAULT false
)
RETURNS bigint
LANGUAGE sql
STABLE
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT COUNT(*)
  FROM public.inbox_entries(
    p_user := p_user,
    p_status := p_status,
    p_assigned := p_assigned,
    p_channels := p_channels,
    p_starred := p_starred,
    p_verified := p_verified,
    p_priority := p_priority,
    p_bot_status := p_bot_status,
    p_phone_number_id := p_phone_number_id,
    p_pinned := p_pinned,
    p_limit := 2147483647,
    p_offset := 0,
    p_statuses := p_statuses,
    p_priorities := p_priorities,
    p_bot_statuses := p_bot_statuses,
    p_phone_number_ids := p_phone_number_ids,
    p_assigned_user_ids := p_assigned_user_ids,
    p_include_unassigned := p_include_unassigned,
    p_label_ids := p_label_ids,
    p_unread_only := p_unread_only
  )
$function$;

-- Same callers as before: signed-in users through PostgREST.
REVOKE ALL ON FUNCTION public.inbox_entries(uuid, text, text, text[], boolean, boolean, text, text, uuid, boolean, integer, integer, text[], text[], text[], uuid[], uuid[], boolean, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_entries(uuid, text, text, text[], boolean, boolean, text, text, uuid, boolean, integer, integer, text[], text[], text[], uuid[], uuid[], boolean, uuid[], boolean) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.inbox_entries_count(uuid, text, text, text[], boolean, boolean, text, text, uuid, boolean, text[], text[], text[], uuid[], uuid[], boolean, uuid[], boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.inbox_entries_count(uuid, text, text, text[], boolean, boolean, text, text, uuid, boolean, text[], text[], text[], uuid[], uuid[], boolean, uuid[], boolean) TO authenticated, service_role;

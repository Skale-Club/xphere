-- Migration 1161: make the sidebar "Chat" badge count match what the inbox shows.
--
-- THE BUG (phantom badge): the badge count (/api/chat/unread-count) counted RAW
-- conversation rows, but the inbox (inbox_entries, migrations 1130→1133→1144)
-- groups conversations by CONTACT and renders ONE representative per contact.
-- Two independent defects fell out of that mismatch:
--
--   1. GROUPING. A contact with conversations on multiple channels (e.g. one
--      WhatsApp + one SMS) has sibling rows the inbox never shows separately.
--      A buried sibling could satisfy the old per-row unread predicate while the
--      representative was read — so the badge showed "1" with NOTHING unread
--      visible in the inbox, and the user could never open/clear it.
--
--   2. OUTBOUND BUMP. The old predicate keyed unread on `last_message_at`, which
--      is advanced by EVERY message including the operator's own reply and the
--      bot's reply (trigger 1121 + the POST /messages route). So a thread you
--      just answered (read_at < your reply's timestamp) re-counted as "unread".
--      Migration 1159 only stopped INBOUND from clearing the read row; it did
--      nothing about outbound advancing last_message_at past read_at.
--
-- THE FIX (single source of truth):
--   * Extend inbox_entries to emit an `is_unread` flag computed ON THE SAME
--     representative the inbox renders/marks-read, keyed on `last_inbound_at`
--     (which outbound/bot replies do NOT advance) vs the caller's read marker.
--     The chat list now consumes this flag, so "answered" threads stop showing
--     unread and the list's definition can never drift from the badge's.
--   * Add inbox_unread_count(): count of inbox_entries rows whose representative
--     is unread. Because it CALLS inbox_entries, the badge counts EXACTLY the
--     entries the inbox shows with an unread dot — by construction, no duplicated
--     representative-selection logic to drift (the rep ordering already changed
--     twice across 1130/1133/1144).
--   * Status scope is inbox_entries' default (status <> 'closed', so 'resolved'
--     unread threads now count too — matching what the inbox lists), replacing
--     the old badge's open/pending/waiting-only filter.
--   * inbox_unread_count uses auth.uid() internally so a caller can only read
--     their OWN unread count.
--
-- Return-type change ⇒ inbox_entries must be dropped/recreated (the body below is
-- identical to 1144 except: `filtered`/`rep` carry last_inbound_at, and the final
-- SELECT adds the is_unread column via a LEFT JOIN to conversation_reads).

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
  activity_at timestamptz,
  is_unread boolean
)
LANGUAGE sql
STABLE
AS $$
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
  )
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
  ORDER BY a.max_act DESC NULLS LAST
  LIMIT p_limit OFFSET p_offset
$$;

-- Sidebar "Chat" badge: number of inbox entries whose representative is unread,
-- for the calling user, across the whole (unfiltered, non-closed) inbox. Counting
-- via inbox_entries guarantees the badge == the unread dots the inbox renders.
CREATE OR REPLACE FUNCTION public.inbox_unread_count()
RETURNS integer
LANGUAGE sql
STABLE
AS $$
  SELECT COUNT(*)::int
  FROM public.inbox_entries(
    p_user   := auth.uid(),
    p_pinned := NULL,
    p_limit  := 2147483647,
    p_offset := 0
  ) e
  WHERE e.is_unread
$$;

-- Match the EXECUTE grants the prior inbox_entries relied on (dropped with the
-- function) and expose the new count RPC to the authenticated client.
GRANT EXECUTE ON FUNCTION public.inbox_entries(
  uuid, text, text, text[], boolean, boolean, text, text, uuid, boolean, int, int)
  TO authenticated, anon, service_role;
GRANT EXECUTE ON FUNCTION public.inbox_unread_count() TO authenticated, anon, service_role;

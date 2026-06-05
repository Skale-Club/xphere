-- Migration 1159: make the chat "unread" Chat-badge correct and reactive.
--
-- Two fixes to the mark-as-read system (SEED-035 follow-up):
--
-- 1. Publish conversation_reads to supabase_realtime.
--    The sidebar Chat badge (useUnreadCount) already subscribes to
--    postgres_changes on conversation_reads to refresh the count whenever a
--    conversation is marked read/unread. But the table was never added to the
--    publication (migration 024 only added conversations + conversation_messages),
--    so that subscription never fired — the badge stayed stale until a full page
--    reload. Publishing the table activates the existing client code.
--    Replica identity stays default (PK = conversation_id,user_id), which is
--    enough for the `user_id=eq.X` realtime filter on INSERT/UPDATE/DELETE since
--    user_id is part of the primary key.
--
-- 2. Only invalidate reads on INBOUND messages.
--    invalidate_conversation_reads() deletes every user's read marker whenever
--    ANY message is inserted into conversation_messages — including the
--    operator's own outbound reply and the bot's replies. That re-flags a thread
--    you just answered (or are actively handling) as "unread". Restrict the
--    invalidation to inbound messages (role = 'user'); all inbound channel
--    adapters (widget, whatsapp, meta, ghl, twilio, zernio, evolution) insert
--    inbound as 'user', while outbound is 'assistant' / 'agent' / 'system'.
--    The trigger object itself is unchanged — only the function body.

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.conversation_reads;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION invalidate_conversation_reads()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Inbound (customer) messages mark the thread unread for every operator.
  -- Outbound / bot / system messages must NOT reset read state.
  IF NEW.role = 'user' THEN
    DELETE FROM conversation_reads
    WHERE conversation_id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

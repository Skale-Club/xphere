-- =============================================================================
-- Migration 1302: keyword-activated agents + automatic human takeover
-- =============================================================================
-- Platform capability for topic-scoped chat agents (first used by the Skale
-- Club NFC keychain agent, .planning/research/nfc-keychain-whatsapp-agent.md):
--
-- agents.activation_keywords
--   Non-empty -> the agent is keyword-activated: it only takes a conversation
--   when an inbound message contains one of these terms, and never answers
--   anything else. Empty (default) keeps today's behaviour.
--
-- agents.message_label
--   Optional line prepended to every outbound message the agent sends, so the
--   customer can tell a bot reply from a human one (e.g. "🤖 Ana (assistente
--   virtual)"). Null = no label.
--
-- conversations.engaged_agent_id / engaged_at
--   The keyword agent currently holding the conversation. Once engaged, follow
--   up messages without the keyword ("and 50?") keep going to it until the
--   engagement lapses, a human takes over, or the agent hands off.
--
-- conversations.bot_paused_until / bot_paused_reason
--   bot_status='paused' now carries why and until when. A pause caused by a
--   human reply lapses on its own (bot_paused_until); a manual or handoff pause
--   keeps bot_paused_until NULL and lasts until someone turns the bot back on.
--
-- notifications.type gains 'handoff_requested'.
--
-- Idempotent: safe to re-run.
-- =============================================================================

BEGIN;

ALTER TABLE public.agents
  ADD COLUMN IF NOT EXISTS activation_keywords text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS message_label text;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS engaged_agent_id uuid REFERENCES public.agents(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS engaged_at timestamptz,
  ADD COLUMN IF NOT EXISTS bot_paused_until timestamptz,
  ADD COLUMN IF NOT EXISTS bot_paused_reason text;

ALTER TABLE public.conversations
  DROP CONSTRAINT IF EXISTS conversations_bot_paused_reason_check;
ALTER TABLE public.conversations
  ADD CONSTRAINT conversations_bot_paused_reason_check
  CHECK (bot_paused_reason IS NULL OR bot_paused_reason IN ('human_reply', 'handoff', 'manual'));

-- Keyword agents are looked up per org on every inbound message.
CREATE INDEX IF NOT EXISTS agents_keyword_activated_idx
  ON public.agents (organization_id)
  WHERE is_active AND cardinality(activation_keywords) > 0;

ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'new_conversation', 'missed_call', 'flow_failed', 'new_message', 'incoming_call',
    'handoff_requested'
  ));

COMMIT;

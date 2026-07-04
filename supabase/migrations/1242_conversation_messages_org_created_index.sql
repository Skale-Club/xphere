-- =============================================================================
-- Migration 1242: Composite index on conversation_messages (SEED-048 Phase E)
--
-- conversation_messages already has separate idx_conversation_messages_org_id
-- and idx_conversation_messages_created_at indexes (migration 015/101), but the
-- dashboard activity feed and inbox queries filter by org (via RLS) AND sort by
-- created_at DESC together — a composite index avoids a separate sort step.
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_conversation_messages_org_created
  ON public.conversation_messages (org_id, created_at DESC);

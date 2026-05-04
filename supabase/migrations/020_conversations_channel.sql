-- =============================================================================
-- Migration 020: Multi-Channel Conversations — add channel + channel_metadata
-- Phase: 07-db-foundation (v1.3)
-- =============================================================================
-- Fully backward-compatible: DEFAULT 'widget' ensures ALL existing rows
-- get channel = 'widget' with zero data migration required.
--
-- channel_metadata JSONB carries channel-specific routing identifiers:
--   widget:    {} (empty — reply goes through SSE session)
--   messenger: { "page_id": "...", "psid": "..." }
--   instagram: { "page_id": "...", "igsid": "...", "ig_account_id": "..." }
--
-- No RLS policy change needed — existing org_isolation policy on conversations
-- already covers all rows (new rows inherit the same org_id scope).
-- =============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS channel
    TEXT NOT NULL DEFAULT 'widget'
    CONSTRAINT conversations_channel_check
    CHECK (channel IN ('widget', 'messenger', 'instagram')),
  ADD COLUMN IF NOT EXISTS channel_metadata
    JSONB NOT NULL DEFAULT '{}';

-- Partial index: only index non-widget channels (widget is the overwhelming majority)
-- This keeps index size small while making channel-filtered inbox queries fast
CREATE INDEX idx_conversations_channel
  ON public.conversations(channel)
  WHERE channel != 'widget';

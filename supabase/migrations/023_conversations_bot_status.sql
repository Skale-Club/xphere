-- =============================================================================
-- Migration 023: Multi-Channel Inbox — bot_status per conversation
-- Phase: 12-multi-channel-inbox-ui (v1.3)
-- =============================================================================
-- bot_status: controls whether the AI bot responds to inbound messages on this
--   conversation. 'active' = bot responds; 'paused' = bot is suppressed.
--   Defaults to 'active' for all existing and new rows.
-- METAINBOX-06: Admin can pause/resume bot per conversation across all channels.
-- =============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS bot_status
    TEXT NOT NULL DEFAULT 'active'
    CONSTRAINT conversations_bot_status_check
    CHECK (bot_status IN ('active', 'paused'));

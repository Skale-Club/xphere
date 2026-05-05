-- =============================================================================
-- Migration 022: Meta Webhook Schema — last_inbound_at + meta_channels.config
-- Phase: 11-meta-webhook (v1.3)
-- =============================================================================
-- last_inbound_at: tracks when the last inbound user message arrived, enabling
--   24h Meta messaging window enforcement (METAEV-05).
-- meta_channels.config: JSONB for per-channel settings, starting with
--   keyword_trigger (nullable string) for automation keyword filtering (METAEV-04).
-- =============================================================================

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS last_inbound_at TIMESTAMPTZ;

ALTER TABLE public.meta_channels
  ADD COLUMN IF NOT EXISTS config JSONB NOT NULL DEFAULT '{}';

-- Partial index: skip widget conversations (no 24h window applies to them)
CREATE INDEX IF NOT EXISTS idx_conversations_last_inbound_at
  ON public.conversations(last_inbound_at)
  WHERE channel != 'widget';

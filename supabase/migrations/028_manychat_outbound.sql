-- =============================================================================
-- Migration: 028_manychat_outbound
-- Phase: v1.6 ManyChat Integration — Phase 25 Outbound Actions
-- Adds:    4 enum values to public.action_type (set_field, add_tag, trigger_flow, send_message)
--          integrations.manychat_channel_id FK column (ON DELETE CASCADE)
--          partial unique index on integrations(organization_id) WHERE provider='manychat'
--          backfill: one bridge integration row per existing manychat_channels row
-- Note: ALTER TYPE ADD VALUE must run as standalone statements (no tx block).
--       Pattern proven by 026_manychat_foundation.sql:17.
-- =============================================================================

-- 1. Enum extension (must come first; each ADD VALUE is a standalone statement)
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'manychat_set_field';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'manychat_add_tag';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'manychat_trigger_flow';
ALTER TYPE public.action_type ADD VALUE IF NOT EXISTS 'manychat_send_message';

-- 2. FK column linking the bridge row to the canonical channel
ALTER TABLE public.integrations
  ADD COLUMN IF NOT EXISTS manychat_channel_id UUID
  REFERENCES public.manychat_channels(id) ON DELETE CASCADE;

-- 3. Partial unique index — one bridge row per org for provider='manychat'
CREATE UNIQUE INDEX IF NOT EXISTS idx_integrations_manychat_one_per_org
  ON public.integrations (organization_id)
  WHERE provider = 'manychat';

-- 4. Idempotent backfill — one bridge row per existing manychat_channels row.
--    Uses WHERE NOT EXISTS for replay safety (more portable than ON CONFLICT
--    against a partial index, which requires the predicate in the conflict_target).
INSERT INTO public.integrations (
  organization_id,
  provider,
  name,
  encrypted_api_key,
  key_hint,
  location_id,
  config,
  is_active,
  manychat_channel_id
)
SELECT
  mc.org_id,
  'manychat',
  mc.channel_name,
  mc.encrypted_api_key,
  mc.key_hint,
  NULL,
  '{}'::jsonb,
  mc.is_active,
  mc.id
FROM public.manychat_channels mc
WHERE NOT EXISTS (
  SELECT 1
  FROM public.integrations i
  WHERE i.provider = 'manychat'
    AND i.organization_id = mc.org_id
);

-- 5. Defensive index on the FK column for cascade-delete performance.
CREATE INDEX IF NOT EXISTS idx_integrations_manychat_channel_id
  ON public.integrations (manychat_channel_id)
  WHERE manychat_channel_id IS NOT NULL;

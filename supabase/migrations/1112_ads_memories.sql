-- =============================================================================
-- Migration 1112: Ads Memories — persistent story across conversations
-- =============================================================================

CREATE TABLE public.ads_memories (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         UUID        NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  journey_id     UUID        NOT NULL REFERENCES public.ads_journey(id) ON DELETE CASCADE,
  type           TEXT        NOT NULL CHECK (type IN ('insight', 'decision', 'plan', 'risk', 'observation', 'result', 'goal')),
  status         TEXT        NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active', 'archived', 'superseded', 'needs_review')),
  source         TEXT        NOT NULL CHECK (source IN ('chat', 'mcp', 'manual', 'audit')),
  platform       TEXT        CHECK (platform IN ('meta', 'google')),
  title          TEXT        NOT NULL,
  content        TEXT        NOT NULL,
  campaign_id    TEXT,
  campaign_name  TEXT,
  confidence     SMALLINT    NOT NULL DEFAULT 3 CHECK (confidence BETWEEN 1 AND 5),
  proposed       BOOLEAN     NOT NULL DEFAULT FALSE,
  metadata       JSONB       NOT NULL DEFAULT '{}',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ads_memories_org_id     ON public.ads_memories(org_id);
CREATE INDEX idx_ads_memories_journey_id ON public.ads_memories(journey_id);
CREATE INDEX idx_ads_memories_status     ON public.ads_memories(status);
CREATE INDEX idx_ads_memories_platform   ON public.ads_memories(platform);
CREATE INDEX idx_ads_memories_created_at ON public.ads_memories(created_at DESC);

ALTER TABLE public.ads_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "org_isolation" ON public.ads_memories
  FOR ALL TO authenticated
  USING (org_id = public.get_current_org_id())
  WITH CHECK (org_id = public.get_current_org_id());

CREATE TRIGGER ads_memories_updated_at
  BEFORE UPDATE ON public.ads_memories
  FOR EACH ROW EXECUTE FUNCTION trigger_update_updated_at();

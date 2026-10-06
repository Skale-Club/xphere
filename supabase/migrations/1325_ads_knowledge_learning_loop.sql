-- =============================================================================
-- Migration 1325: Ads knowledge learning loop
-- =============================================================================
-- Closes the loop between "what the AI knew", "what it changed" and "what
-- happened next":
--
--   1. ads_change_requests records WHY a change was proposed (rationale) and
--      WHICH knowledge grounded it (Global Knowledge sources, journey
--      memories). Before this the ledger kept before/after/diff/verification
--      but never the reasoning, so no one could tell whether advice worked.
--   2. The outcome reviewer (src/lib/ads/outcomes.ts) compares the campaign's
--      stored daily metrics before and after an applied change and files the
--      result as an ads_memories row of type 'result'. outcome_reviewed_at is
--      its work marker.
--   3. ads_memories gains an embedding so memories can be searched by meaning
--      instead of only by type/platform/campaign-name filters, plus explicit
--      links to the knowledge and the change they relate to.
--
-- Also drops match_ads_playbook, the rolling-rename alias from 1220 that no
-- runtime calls any more. The ads_playbook_sources compatibility VIEW is kept
-- until the deployed process-embeddings Edge Function is confirmed to use the
-- canonical table name.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. Rationale and knowledge references on the change ledger
-- ---------------------------------------------------------------------------
ALTER TABLE public.ads_change_requests
  ADD COLUMN IF NOT EXISTS rationale            TEXT,
  ADD COLUMN IF NOT EXISTS knowledge_refs       JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS memory_refs          JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS outcome_reviewed_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS outcome              JSONB;

-- The reviewer's scan: applied changes on a campaign that have not been
-- reviewed yet, oldest first.
CREATE INDEX IF NOT EXISTS ads_change_requests_outcome_queue
  ON public.ads_change_requests (executed_at)
  WHERE status = 'succeeded'
    AND outcome_reviewed_at IS NULL
    AND campaign_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Memories: semantic search + links
-- ---------------------------------------------------------------------------
ALTER TABLE public.ads_memories
  ADD COLUMN IF NOT EXISTS embedding          extensions.vector(1536),
  ADD COLUMN IF NOT EXISTS embedded_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS knowledge_refs     JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS change_request_id  UUID REFERENCES public.ads_change_requests(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS superseded_by      UUID REFERENCES public.ads_memories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_ads_memories_change_request
  ON public.ads_memories (change_request_id)
  WHERE change_request_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_ads_memories_embedding
  ON public.ads_memories
  USING hnsw (embedding extensions.vector_cosine_ops);

-- Org-scoped similarity search. SECURITY DEFINER with an explicit org filter:
-- callers are server-side (MCP, Copilot) running as service role and pass the
-- org they already authenticated. Not executable by clients.
DROP FUNCTION IF EXISTS public.match_ads_memories(UUID, extensions.vector, TEXT, TEXT[], INT);
CREATE FUNCTION public.match_ads_memories(
  p_org_id         UUID,
  query_embedding  extensions.vector(1536),
  platform_filter  TEXT   DEFAULT NULL,
  status_filter    TEXT[] DEFAULT ARRAY['active'],
  match_count      INT    DEFAULT 10
)
RETURNS TABLE (
  id          UUID,
  type        TEXT,
  status      TEXT,
  source      TEXT,
  platform    TEXT,
  title       TEXT,
  content     TEXT,
  campaign_id TEXT,
  campaign_name TEXT,
  confidence  SMALLINT,
  knowledge_refs JSONB,
  change_request_id UUID,
  created_at  TIMESTAMPTZ,
  similarity  FLOAT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT
    m.id, m.type, m.status, m.source, m.platform, m.title, m.content,
    m.campaign_id, m.campaign_name, m.confidence, m.knowledge_refs,
    m.change_request_id, m.created_at,
    1 - (m.embedding <=> query_embedding) AS similarity
  FROM public.ads_memories m
  WHERE m.org_id = p_org_id
    AND m.embedding IS NOT NULL
    AND m.status = ANY (status_filter)
    AND (platform_filter IS NULL OR m.platform = platform_filter OR m.platform IS NULL)
  ORDER BY m.embedding <=> query_embedding ASC
  LIMIT LEAST(GREATEST(match_count, 1), 50);
$$;

REVOKE EXECUTE ON FUNCTION public.match_ads_memories(UUID, extensions.vector, TEXT, TEXT[], INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_ads_memories(UUID, extensions.vector, TEXT, TEXT[], INT)
  TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Retire the unused rolling-rename alias
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.match_ads_playbook(extensions.vector, TEXT, INT);

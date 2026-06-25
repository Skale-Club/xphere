-- =============================================================================
-- Migration 1219: Ads Playbook — global, super-admin-curated knowledge base
-- =============================================================================
-- A PLATFORM-LEVEL (no org_id) knowledge base of ad-media fundamentals
-- (transcribed courses, market best-practices) segmented by media platform.
-- The super admin uploads files here; chunks land in the existing `documents`
-- vector table tagged with metadata { scope: 'ads_playbook', platform, ... }
-- and NO org_id, so they live outside any org's isolation and are globally
-- queryable by the ads journey (Copilot + MCP).
--
-- This is intentionally separate from per-org `knowledge_sources` / journey
-- memories: each org keeps its own story; this is the shared "fortress" of
-- curated fundamentals.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Step 1: source-tracking table (platform-level, no org_id)
-- ---------------------------------------------------------------------------
CREATE TABLE public.ads_playbook_sources (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  platform     TEXT        NOT NULL CHECK (platform IN ('meta', 'google', 'global')),
  name         TEXT        NOT NULL,
  source_type  TEXT        NOT NULL CHECK (source_type IN ('pdf', 'text', 'csv')),
  source_url   TEXT,                       -- storage path in the ads-playbook bucket (null for inline text)
  status       TEXT        NOT NULL DEFAULT 'processing' CHECK (status IN ('processing', 'ready', 'error')),
  error_detail TEXT,
  chunk_count  INTEGER     NOT NULL DEFAULT 0,
  created_by   UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_ads_playbook_sources_platform ON public.ads_playbook_sources (platform);

ALTER TABLE public.ads_playbook_sources ENABLE ROW LEVEL SECURITY;

-- Only platform admins (super admin) may read/write the global playbook.
-- Service role bypasses RLS for the background embedding pipeline + admin actions.
CREATE POLICY "platform_admins_manage_ads_playbook_sources"
  ON public.ads_playbook_sources
  FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

-- ---------------------------------------------------------------------------
-- Step 2: similarity search RPC over the global playbook chunks
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: bypasses RLS. The playbook chunks carry NO org_id, so this
-- function is the controlled, global entry point. A requested platform also
-- matches the 'global' bucket of platform-agnostic fundamentals.
CREATE OR REPLACE FUNCTION public.match_ads_playbook(
  query_embedding extensions.vector(1536),
  platform_filter TEXT  DEFAULT NULL,
  match_count     INT   DEFAULT 5
)
RETURNS TABLE (
  id         BIGINT,
  content    TEXT,
  metadata   JSONB,
  similarity FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM public.documents d
  WHERE d.metadata->>'scope' = 'ads_playbook'
    AND (
      platform_filter IS NULL
      OR d.metadata->>'platform' = platform_filter
      OR d.metadata->>'platform' = 'global'
    )
    AND d.embedding IS NOT NULL
  ORDER BY d.embedding <=> query_embedding ASC
  LIMIT match_count;
END;
$$;

-- ---------------------------------------------------------------------------
-- Step 3: private storage bucket for uploaded playbook files
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('ads-playbook', 'ads-playbook', false)
ON CONFLICT (id) DO NOTHING;

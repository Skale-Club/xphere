-- =============================================================================
-- Migration 1220: Global Knowledge naming + authoritative Notion synchronization
-- =============================================================================
-- Renames the legacy Ads Playbook storage model without rewriting migration
-- history, preserves existing vectors, and adds the durable state needed for
-- OAuth, roots, queued webhook work, reconciliation, and atomic revisions.
-- =============================================================================

ALTER TABLE public.ads_playbook_sources RENAME TO global_knowledge_sources;
ALTER INDEX IF EXISTS public.idx_ads_playbook_sources_platform
  RENAME TO idx_global_knowledge_sources_platform;

ALTER POLICY "platform_admins_manage_ads_playbook_sources"
  ON public.global_knowledge_sources
  RENAME TO "platform_admins_manage_global_knowledge_sources";

-- Auto-updatable compatibility view for rolling deployments. It can be
-- removed after every runtime and Edge Function uses the canonical name.
CREATE VIEW public.ads_playbook_sources
WITH (security_invoker = true)
AS SELECT * FROM public.global_knowledge_sources;

ALTER TABLE public.global_knowledge_sources
  DROP CONSTRAINT IF EXISTS ads_playbook_sources_source_type_check;

ALTER TABLE public.global_knowledge_sources
  ADD CONSTRAINT global_knowledge_sources_source_type_check
  CHECK (source_type IN ('pdf', 'text', 'csv', 'notion_page'));

ALTER TABLE public.global_knowledge_sources
  ADD COLUMN storage_bucket TEXT,
  ADD COLUMN external_id TEXT,
  ADD COLUMN content_hash TEXT,
  ADD COLUMN external_last_edited_at TIMESTAMPTZ,
  ADD COLUMN active_revision_id UUID,
  ADD COLUMN last_synced_at TIMESTAMPTZ,
  ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.global_knowledge_sources
SET storage_bucket = 'ads-playbook'
WHERE source_url IS NOT NULL;

CREATE UNIQUE INDEX idx_global_knowledge_sources_notion_page
  ON public.global_knowledge_sources (external_id)
  WHERE source_type = 'notion_page' AND external_id IS NOT NULL;

-- One row controls which source family participates in retrieval. Existing
-- installs start in manual mode and switch only after an initial Notion sync.
CREATE TABLE public.global_knowledge_config (
  id          TEXT PRIMARY KEY DEFAULT 'primary' CHECK (id = 'primary'),
  source_mode TEXT NOT NULL DEFAULT 'manual' CHECK (source_mode IN ('manual', 'notion')),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.global_knowledge_config (id, source_mode)
VALUES ('primary', 'manual')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.global_knowledge_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_admins_manage_global_knowledge_config"
  ON public.global_knowledge_config FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE TABLE public.global_knowledge_notion_connections (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id             TEXT NOT NULL UNIQUE,
  workspace_name           TEXT,
  workspace_icon           TEXT,
  bot_id                    TEXT NOT NULL,
  owner_user_id             TEXT,
  encrypted_access_token   TEXT NOT NULL,
  encrypted_refresh_token  TEXT,
  token_expires_at         TIMESTAMPTZ,
  status                   TEXT NOT NULL DEFAULT 'connected'
                           CHECK (status IN ('connected', 'syncing', 'error', 'revoked', 'disconnected')),
  error_detail             TEXT,
  last_synced_at           TIMESTAMPTZ,
  last_reconciled_at       TIMESTAMPTZ,
  created_by               UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.global_knowledge_notion_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_admins_manage_global_knowledge_notion_connections"
  ON public.global_knowledge_notion_connections FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

CREATE TABLE public.global_knowledge_notion_roots (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id       UUID NOT NULL REFERENCES public.global_knowledge_notion_connections(id) ON DELETE CASCADE,
  notion_page_id      TEXT NOT NULL,
  title               TEXT NOT NULL,
  platform            TEXT NOT NULL CHECK (platform IN ('meta', 'google', 'global')),
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'syncing', 'active', 'error', 'disconnected')),
  error_detail        TEXT,
  last_full_sync_at   TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connection_id, notion_page_id)
);

ALTER TABLE public.global_knowledge_notion_roots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_admins_manage_global_knowledge_notion_roots"
  ON public.global_knowledge_notion_roots FOR ALL
  USING (public.is_platform_admin())
  WITH CHECK (public.is_platform_admin());

ALTER TABLE public.global_knowledge_sources
  ADD COLUMN notion_root_id UUID
  REFERENCES public.global_knowledge_notion_roots(id) ON DELETE CASCADE;

CREATE INDEX idx_global_knowledge_sources_notion_root
  ON public.global_knowledge_sources (notion_root_id)
  WHERE notion_root_id IS NOT NULL;

CREATE TABLE public.global_knowledge_sync_jobs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id          TEXT UNIQUE,
  connection_id     UUID NOT NULL REFERENCES public.global_knowledge_notion_connections(id) ON DELETE CASCADE,
  root_id           UUID REFERENCES public.global_knowledge_notion_roots(id) ON DELETE CASCADE,
  notion_page_id    TEXT,
  job_type          TEXT NOT NULL
                    CHECK (job_type IN ('initial', 'page_upsert', 'page_delete', 'reconcile')),
  status            TEXT NOT NULL DEFAULT 'queued'
                    CHECK (status IN ('queued', 'processing', 'succeeded', 'failed')),
  attempts          INTEGER NOT NULL DEFAULT 0,
  next_attempt_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  error_detail      TEXT,
  payload           JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  started_at        TIMESTAMPTZ,
  completed_at      TIMESTAMPTZ
);

CREATE INDEX idx_global_knowledge_sync_jobs_claim
  ON public.global_knowledge_sync_jobs (status, next_attempt_at, created_at);

CREATE UNIQUE INDEX idx_global_knowledge_one_processing_job_per_connection
  ON public.global_knowledge_sync_jobs (connection_id)
  WHERE status = 'processing';

CREATE UNIQUE INDEX idx_global_knowledge_one_active_job_per_root
  ON public.global_knowledge_sync_jobs (root_id)
  WHERE root_id IS NOT NULL AND status IN ('queued', 'processing');

ALTER TABLE public.global_knowledge_sync_jobs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "platform_admins_read_global_knowledge_sync_jobs"
  ON public.global_knowledge_sync_jobs FOR SELECT
  USING (public.is_platform_admin());

CREATE OR REPLACE FUNCTION public.claim_global_knowledge_sync_job()
RETURNS SETOF public.global_knowledge_sync_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_id UUID;
BEGIN
  SELECT id INTO claimed_id
  FROM public.global_knowledge_sync_jobs
  WHERE status = 'queued'
    AND next_attempt_at <= now()
    AND NOT EXISTS (
      SELECT 1
      FROM public.global_knowledge_sync_jobs active
      WHERE active.connection_id = global_knowledge_sync_jobs.connection_id
        AND active.status = 'processing'
    )
  ORDER BY created_at
  FOR UPDATE SKIP LOCKED
  LIMIT 1;

  IF claimed_id IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  UPDATE public.global_knowledge_sync_jobs
  SET status = 'processing',
      attempts = attempts + 1,
      started_at = now(),
      error_detail = NULL
  WHERE id = claimed_id
  RETURNING *;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_global_knowledge_sync_job()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_global_knowledge_sync_job()
  TO service_role;

-- Existing vectors adopt the canonical metadata vocabulary.
UPDATE public.documents
SET metadata =
  (metadata - 'scope' - 'playbook_source_id')
  || jsonb_build_object(
    'scope', 'global_knowledge',
    'global_knowledge_source_id', metadata->>'playbook_source_id'
  )
WHERE metadata->>'scope' = 'ads_playbook';

-- Activate a fully-created revision in one statement. The previous revision
-- remains searchable until this update commits.
CREATE OR REPLACE FUNCTION public.activate_global_knowledge_revision(
  p_source_id UUID,
  p_revision_id UUID,
  p_content_hash TEXT,
  p_chunk_count INTEGER,
  p_external_last_edited_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.global_knowledge_sources
  SET active_revision_id = p_revision_id,
      content_hash = p_content_hash,
      chunk_count = p_chunk_count,
      external_last_edited_at = p_external_last_edited_at,
      last_synced_at = now(),
      status = 'ready',
      error_detail = NULL,
      is_active = TRUE,
      updated_at = now()
  WHERE id = p_source_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'global knowledge source % not found', p_source_id;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.activate_global_knowledge_revision(UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_global_knowledge_revision(UUID, UUID, TEXT, INTEGER, TIMESTAMPTZ)
  TO service_role;

CREATE OR REPLACE FUNCTION public.complete_global_knowledge_root_sync(
  p_root_id UUID,
  p_seen_external_ids TEXT[]
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.global_knowledge_sources
  SET is_active = FALSE, updated_at = now()
  WHERE notion_root_id = p_root_id
    AND source_type = 'notion_page'
    AND NOT (external_id = ANY (p_seen_external_ids));

  UPDATE public.global_knowledge_notion_roots
  SET status = 'active',
      error_detail = NULL,
      last_full_sync_at = now(),
      updated_at = now()
  WHERE id = p_root_id;

  UPDATE public.global_knowledge_notion_connections c
  SET status = 'connected',
      error_detail = NULL,
      last_synced_at = now(),
      last_reconciled_at = now(),
      updated_at = now()
  FROM public.global_knowledge_notion_roots r
  WHERE r.id = p_root_id AND c.id = r.connection_id;

  UPDATE public.global_knowledge_config
  SET source_mode = 'notion', updated_at = now()
  WHERE id = 'primary';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.complete_global_knowledge_root_sync(UUID, TEXT[])
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_global_knowledge_root_sync(UUID, TEXT[])
  TO service_role;

CREATE OR REPLACE FUNCTION public.match_global_knowledge(
  query_embedding extensions.vector(1536),
  platform_filter TEXT DEFAULT NULL,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  metadata JSONB,
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
  JOIN public.global_knowledge_sources s
    ON s.id::text = COALESCE(
      d.metadata->>'global_knowledge_source_id',
      d.metadata->>'playbook_source_id'
    )
  CROSS JOIN public.global_knowledge_config cfg
  WHERE d.metadata->>'scope' IN ('global_knowledge', 'ads_playbook')
    AND s.status = 'ready'
    AND s.is_active
    AND (
      (cfg.source_mode = 'manual' AND s.source_type <> 'notion_page')
      OR (cfg.source_mode = 'notion' AND s.source_type = 'notion_page')
    )
    AND (
      s.active_revision_id IS NULL
      OR d.metadata->>'global_knowledge_revision_id' = s.active_revision_id::text
    )
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

REVOKE EXECUTE ON FUNCTION public.match_global_knowledge(extensions.vector, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_global_knowledge(extensions.vector, TEXT, INT)
  TO service_role;

-- Compatibility alias for callers deployed during a rolling release. New code
-- uses match_global_knowledge exclusively.
CREATE OR REPLACE FUNCTION public.match_ads_playbook(
  query_embedding extensions.vector(1536),
  platform_filter TEXT DEFAULT NULL,
  match_count INT DEFAULT 5
)
RETURNS TABLE (
  id BIGINT,
  content TEXT,
  metadata JSONB,
  similarity FLOAT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT * FROM public.match_global_knowledge(query_embedding, platform_filter, match_count);
$$;

REVOKE EXECUTE ON FUNCTION public.match_ads_playbook(extensions.vector, TEXT, INT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.match_ads_playbook(extensions.vector, TEXT, INT)
  TO service_role;

INSERT INTO storage.buckets (id, name, public)
VALUES ('global-knowledge', 'global-knowledge', false)
ON CONFLICT (id) DO NOTHING;

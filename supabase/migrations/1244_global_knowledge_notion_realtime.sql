-- =============================================================================
-- Migration 1244: Enable Realtime for global knowledge Notion sync (SEED-048 Phase F)
--
-- The Knowledge Manager admin page (src/components/admin/global-knowledge/
-- knowledge-manager.tsx) previously polled with setInterval(router.refresh, 5000)
-- while a Notion sync was active. Replacing that with a Supabase realtime
-- subscription on global_knowledge_sync_jobs requires the table to be part of
-- the supabase_realtime publication, and REPLICA IDENTITY FULL so postgres_changes
-- payloads include full rows when filtered by connection_id (a non-PK column).
-- Idempotent: wraps the ALTER in a DO block that swallows duplicate_object errors.
-- =============================================================================

ALTER TABLE public.global_knowledge_sync_jobs REPLICA IDENTITY FULL;
ALTER TABLE public.global_knowledge_notion_roots REPLICA IDENTITY FULL;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.global_knowledge_sync_jobs;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.global_knowledge_notion_roots;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

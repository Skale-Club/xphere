-- Global Knowledge: mark Notion pages that are folders.
--
-- A synced Notion page that has child pages is a folder: its own text is
-- navigation for humans (Notion renders the children as link lines), so the
-- sync indexes no chunks for it. Without a flag, a folder looks exactly like a
-- page whose content failed to index (0 chunks) and the admin view reports it
-- as "thin". The sync sets this flag; the admin view lists folders as folders.

ALTER TABLE public.global_knowledge_sources
  ADD COLUMN IF NOT EXISTS is_container BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN public.global_knowledge_sources.is_container IS
  'Notion page with child pages. Indexed with zero chunks by design; not a thin page.';

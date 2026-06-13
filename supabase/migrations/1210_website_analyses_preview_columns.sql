-- Migration 1210 (reconstructed): website_analyses preview columns.
-- Applied to prod 2026-06-09 as version 20260609235647, but the .sql file was
-- never committed. Filed as 1210 (1207/1208 taken by in-flight billing). The
-- prod ledger tracks this by its timestamp version. Idempotent — safe to re-run.
--
-- preview_url + preview_token were defined in 1204_website_analyses.sql but
-- omitted when the table was first created via the MCP. The preview-generation
-- code (src/services/website-analyzer/index.ts) updates both; without them the
-- update silently fails and no preview link is ever persisted.
ALTER TABLE public.website_analyses ADD COLUMN IF NOT EXISTS preview_url   text;
ALTER TABLE public.website_analyses ADD COLUMN IF NOT EXISTS preview_token text;
